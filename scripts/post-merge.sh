#!/bin/bash
set -e

echo "==> Installing dependencies..."
pnpm install --frozen-lockfile

echo "==> Running migrations (drizzle-kit migrate)..."
pnpm --filter @workspace/db run migrate

echo "==> Syncing any remaining schema changes (drizzle-kit push)..."
pnpm --filter @workspace/db run push

echo "==> Verifying DB schema matches ORM definitions..."
pnpm --filter @workspace/scripts run schema-smoke-test
