#!/bin/bash
set -e

# _POST_MERGE_SKIP_INSTALL=1 skips the pnpm install step.
# Used only by automated tests to avoid a full install when exercising
# the db-migrate / smoke-test failure paths.
if [ -z "${_POST_MERGE_SKIP_INSTALL:-}" ]; then
  pnpm install --frozen-lockfile
fi

# DATABASE_URL is required for the migration and smoke test.
# In CI or fresh-clone build environments where no database is available,
# skip both steps and print a clear message.
if [ -z "${DATABASE_URL:-}" ]; then
  echo "post-merge: DATABASE_URL is not set — skipping migration and smoke test (no DB available)." >&2
  exit 0
fi

# Fast connectivity pre-flight using pg_isready.
# pg_isready is lightweight (no Node.js, no ORM) and gives an immediate, clear
# failure when the database host is unreachable — before any DDL is attempted.
echo "post-merge: checking database connectivity (pg_isready)..." >&2
if ! pg_isready --dbname="$DATABASE_URL" --timeout=10 --quiet; then
  echo "post-merge: database is not reachable (pg_isready failed) — aborting before migration." >&2
  exit 1
fi

# Run pending migrations via drizzle-kit migrate.
# Unlike drizzle-kit push, migrate is:
#   - non-interactive (no prompts, safe for CI/CD)
#   - versioned (tracks applied migrations in __drizzle_migrations table)
#   - repeatable (idempotent across identical environments)
#   - auditable (full migration history in the DB)
#
# To add a new migration: run `pnpm --filter @workspace/db run generate`
# to generate the SQL file, commit it, and this step will apply it on merge.
#
# NOTE: drizzle-kit migrate exits 0 on some PostgreSQL connection errors.
# The output scan below catches known silent-failure patterns.
echo "post-merge: running pending migrations..." >&2
set +e
migrate_log=$(pnpm --filter @workspace/db run migrate 2>&1)
migrate_exit=$?
set -e
printf '%s\n' "$migrate_log" >&2

if [ "$migrate_exit" -ne 0 ]; then
  echo "post-merge: migration failed (exit $migrate_exit) — aborting." >&2
  exit 1
fi

# Detect silent connection/auth failures that drizzle-kit may report but exit 0.
#
# Patterns covered:
#   password authentication failed / authentication failed — pg error 28P01/28000
#   no pg_hba.conf entry                                  — host not allowed (pg HBA)
#   role "..." does not exist                             — wrong DB user
#   SSL connection required                               — TLS mismatch
#   ECONNREFUSED / ETIMEDOUT / getaddrinfo ENOTFOUND      — network unreachable/DNS
if printf '%s\n' "$migrate_log" | grep -qiE \
  "password authentication failed|authentication failed|no pg_hba\.conf entry|role .* does not exist|SSL connection required|ECONNREFUSED|ETIMEDOUT|getaddrinfo"; then
  echo "post-merge: migration output indicates a connection or authentication error — aborting." >&2
  exit 1
fi

echo "post-merge: running post-migration smoke test..." >&2
pnpm --filter @workspace/scripts run schema-smoke-test
