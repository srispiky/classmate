#!/bin/bash
set -e

# _POST_MERGE_SKIP_INSTALL=1 skips the pnpm install step.
# Used only by automated tests to avoid a full install when exercising
# the db-push / smoke-test failure paths.
if [ -z "${_POST_MERGE_SKIP_INSTALL:-}" ]; then
  pnpm install --frozen-lockfile
fi

# DATABASE_URL is required for the schema push and smoke test.
# In CI or fresh-clone build environments where no database is available,
# skip both steps and print a clear message.  The smoke test itself also
# exits non-zero when DATABASE_URL is missing, so omitting this guard and
# letting the smoke test run would cause post-merge to fail instead of skip.
if [ -z "${DATABASE_URL:-}" ]; then
  echo "post-merge: DATABASE_URL is not set — skipping schema push and smoke test (no DB available)." >&2
  exit 0
fi

# Fast connectivity pre-flight using pg_isready.
# pg_isready is lightweight (no Node.js, no ORM) and gives an immediate, clear
# failure when the database host is unreachable — before any DDL is attempted.
# This replaces the heavier smoke-test pre-flight for connectivity checks only;
# the post-push smoke test still validates the full schema after the push.
echo "post-merge: checking database connectivity (pg_isready)..." >&2
if ! pg_isready --dbname="$DATABASE_URL" --timeout=10 --quiet; then
  echo "post-merge: database is not reachable (pg_isready failed) — aborting before schema push." >&2
  exit 1
fi

# Run the schema push.
# NOTE: drizzle-kit push exits 0 even when PostgreSQL rejects the connection at
# the application layer (e.g. pg error code 28P01 — password authentication
# failed, or 28000 — invalid authorization specification).  pg_isready above
# only checks TCP reachability, not credentials, so we must also capture the
# push output and explicitly scan it for known silent-failure patterns.
echo "post-merge: running schema push..." >&2
set +e
push_log=$(pnpm --filter @workspace/db run push 2>&1)
push_exit=$?
set -e
printf '%s\n' "$push_log" >&2

if [ "$push_exit" -ne 0 ]; then
  echo "post-merge: schema push failed (exit $push_exit) — aborting." >&2
  exit 1
fi

# Drizzle-kit exits 0 on several classes of PostgreSQL failure; detect them
# from the captured output and fail explicitly so CI is never silently green.
#
# Patterns covered:
#   password authentication failed / authentication failed — pg error 28P01/28000
#   no pg_hba.conf entry                                  — host not allowed (pg HBA)
#   role "..." does not exist                             — wrong DB user
#   SSL connection required                               — TLS mismatch
#   ECONNREFUSED / ETIMEDOUT / getaddrinfo ENOTFOUND      — network unreachable/DNS
if printf '%s\n' "$push_log" | grep -qiE \
  "password authentication failed|authentication failed|no pg_hba\.conf entry|role .* does not exist|SSL connection required|ECONNREFUSED|ETIMEDOUT|getaddrinfo"; then
  echo "post-merge: schema push output indicates a connection or authentication error — aborting." >&2
  exit 1
fi

echo "post-merge: running post-push smoke test..." >&2
pnpm --filter @workspace/scripts run schema-smoke-test
