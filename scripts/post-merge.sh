#!/bin/bash
set -e

pnpm install --frozen-lockfile

# DATABASE_URL is required for the next two steps (schema push and smoke test).
# In CI or fresh-clone build environments where DATABASE_URL is not set, the
# smoke test will detect the missing variable and exit 0 (skip mode) rather
# than hard-crashing with an uncaught exception.
pnpm --filter @workspace/db run push
pnpm --filter @workspace/scripts run schema-smoke-test
