#!/bin/bash
set -e

pnpm install --frozen-lockfile

# DATABASE_URL is required for the schema push and smoke test.
# In CI or fresh-clone build environments where no database is available,
# skip both steps and print a clear message.  The smoke test itself also
# exits non-zero when DATABASE_URL is missing, so omitting this guard and
# letting the smoke test run would cause post-merge to fail instead of skip.
if [ -z "${DATABASE_URL:-}" ]; then
  echo "post-merge: DATABASE_URL is not set — skipping schema push and smoke test (no DB available)." >&2
  exit 0
fi

pnpm --filter @workspace/db run push
pnpm --filter @workspace/scripts run schema-smoke-test
