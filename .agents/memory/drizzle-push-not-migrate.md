---
name: Drizzle push vs migrate
description: This project uses drizzle-kit push only — no migration files exist. Task agents keep adding drizzle-kit migrate which breaks post-merge.
---

# Drizzle: push only, no migrate

## The rule
`post-merge.sh` must use `drizzle-kit push` (schema push) — **never** `drizzle-kit migrate`.

```bash
pnpm --filter @workspace/db run push
```

Do NOT add `pnpm --filter @workspace/db run migrate` to any script.

**Why:** This project has no `lib/db/migrations/` directory and no `_journal.json`.
`drizzle-kit migrate` immediately fails with:
  Error: Can't find meta/_journal.json file

Task agents #36 and #37 both independently added the migrate step and broke post-merge.

## How to apply
- Whenever editing `scripts/post-merge.sh`, confirm it has `db push` and NOT `db migrate`
- The `migrate` npm script in `lib/db/package.json` exists but is vestigial — do not call it
- The smoke test (`pnpm --filter @workspace/scripts run schema-smoke-test`) is valid and should stay
- Correct final order: install → push → smoke-test
