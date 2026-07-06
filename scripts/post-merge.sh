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

# Run the schema push.
# NOTE: drizzle-kit push exits 0 even when PostgreSQL rejects authentication
# (pg error code 28P01).  Capture its combined output so we can detect auth
# failures explicitly and fail with exit 1 before the smoke test runs.
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

# Drizzle-kit exits 0 on pg auth failure; detect it from output.
if printf '%s\n' "$push_log" | grep -qiE "password authentication failed|authentication failed"; then
  echo "post-merge: schema push failed (database authentication error) — aborting." >&2
  exit 1
fi

echo "post-merge: running smoke test..." >&2
pnpm --filter @workspace/scripts run schema-smoke-test
