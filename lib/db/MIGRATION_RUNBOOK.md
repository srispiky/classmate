# Database Migration Runbook

**Target audience:** New engineer joining the project.  
**Last updated:** Sprint 13 / Migration Framework Certification.

---

## Overview

Classmate Connect uses **Drizzle ORM** with **versioned SQL migrations** for all schema changes. The migration framework was certified in Sprint 13 after transitioning from the original `drizzle-kit push` approach.

| Command | Purpose | When to use |
|---------|---------|-------------|
| `pnpm --filter @workspace/db run generate` | Generate a new SQL migration from schema diff | After editing a schema file |
| `pnpm --filter @workspace/db run migrate` | Apply pending migrations to the database | CI/CD, post-merge, fresh installs |
| `pnpm --filter @workspace/db run push` | **Development only** — direct schema sync (no history) | Quick local iteration only |

---

## Architecture

```
lib/db/
├── src/schema/          ← Drizzle ORM schema definitions (source of truth)
│   ├── index.ts         ← Barrel export (add new schema files here)
│   ├── users.ts
│   ├── students.ts
│   └── ...
├── migrations/          ← Versioned SQL migration files (committed to git)
│   ├── meta/
│   │   ├── _journal.json       ← Drizzle migration registry
│   │   └── 0000_snapshot.json  ← Schema snapshot for diff generation
│   └── 0000_colorful_george_stacy.sql  ← Baseline (all 15 tables)
├── drizzle.config.ts    ← Drizzle configuration
└── package.json         ← Migration scripts
```

**Migration tracking:** Drizzle stores applied migration hashes in the `__drizzle_migrations` table in PostgreSQL. Each migration is recorded exactly once; subsequent `migrate` calls skip already-applied files.

**Session table exclusion:** The `session` table (managed by `connect-pg-simple`) is excluded from Drizzle's scope via `tablesFilter: ["!session"]` in `drizzle.config.ts`.

---

## Migration Lifecycle

### 1. Make a schema change

Edit the relevant file in `lib/db/src/schema/`. Example — adding a `notes_count` column to `students`:

```typescript
// lib/db/src/schema/students.ts
export const studentsTable = pgTable("students", {
  // ... existing columns ...
  notesCount: integer("notes_count").notNull().default(0), // ← NEW
});
```

### 2. Generate the migration

```bash
pnpm --filter @workspace/db run generate
```

This creates a new SQL file in `lib/db/migrations/` and updates `meta/_journal.json`.  
**Commit both files** — the SQL migration and the updated journal.

### 3. Review the generated SQL

Open the generated `*.sql` file and verify:
- No unexpected `DROP TABLE` or `DROP COLUMN` statements
- FKs reference the correct tables
- For destructive changes: add a comment documenting why it is safe

### 4. Apply the migration

```bash
# Development
pnpm --filter @workspace/db run migrate

# Production (post-merge.sh handles this automatically)
# No manual action required — see Deployment section
```

### 5. Commit and push

```bash
git add lib/db/migrations/ lib/db/src/schema/
git commit -m "feat(db): add notes_count to students table"
git push origin main
```

---

## Deployment

`post-merge.sh` runs automatically after every merge and applies pending migrations:

```bash
pnpm install --frozen-lockfile
# pg_isready connectivity check
pnpm --filter @workspace/db run migrate   ← applies pending SQL files
pnpm --filter @workspace/scripts run schema-smoke-test  ← validates all 15 tables
```

**You do not need to run migrations manually in production.** Every merge triggers post-merge.sh automatically.

---

## Fresh Environment Provisioning

To set up a brand new database from scratch:

```bash
# 1. Set DATABASE_URL
export DATABASE_URL=postgres://user:pass@host:5432/dbname

# 2. Install dependencies
pnpm install --frozen-lockfile

# 3. Apply all migrations (creates tables, indexes, FKs from scratch)
pnpm --filter @workspace/db run migrate

# 4. Verify schema
pnpm --filter @workspace/scripts run schema-smoke-test

# Expected output: "schema-smoke-test: 15 passed, 0 failed"
```

**Scenario tested:** All 15 tables created correctly on a fresh PostgreSQL database.

---

## Rollback Strategy

### Additive migrations (new column, new index, new table)

These are safe and do not require rollback in most cases. If a rollback is needed:

1. Write a new migration that reverts the change:
   ```bash
   pnpm --filter @workspace/db run generate
   # Edit the generated SQL to revert (e.g., DROP COLUMN IF EXISTS ...)
   ```
2. Apply the rollback migration
3. Revert the schema file change in code

### Data migrations

Drizzle does not run data migrations automatically. For data migrations:
1. Write a standalone TypeScript script in `scripts/src/`
2. Run it manually before or after the schema migration
3. Document it in the PR

### Destructive migrations (DROP TABLE, DROP COLUMN)

**These cannot be automatically rolled back.**

Before merging:
- Confirm no live code reads the dropped column/table
- Take a database backup: `pg_dump $DATABASE_URL > backup_$(date +%Y%m%d).sql`
- Deploy code changes first (to stop reading the column), then run the migration

Recovery: restore from backup.

### Limitations

- Drizzle does not support automatic down-migrations (no `migrate down` command)
- Each migration runs in a transaction; if it fails mid-way, PostgreSQL rolls back the failed transaction automatically

---

## Troubleshooting

### "Can't find meta/_journal.json"

The migrations folder exists but has no journal. Fix:
```bash
pnpm --filter @workspace/db run generate
```

### "relation already exists" / "constraint already exists"

The baseline migration already ran but was not recorded in `__drizzle_migrations`. This indicates a stamping issue. Fix: wrap the failing statement in a DO/EXCEPTION block or check `__drizzle_migrations` directly.

### "Applied migration hash mismatch"

A committed migration file was edited after being applied. **Never edit applied migrations.** Fix: create a new migration with the corrective change.

### Smoke test: table X failed

A schema file references a table/column that does not exist in the database. Run:
```bash
pnpm --filter @workspace/db run migrate
pnpm --filter @workspace/scripts run schema-smoke-test
```

### Post-merge.sh fails on connectivity

`pg_isready` check failed. Confirm `DATABASE_URL` is set and the PostgreSQL server is reachable.

---

## Migration History

| File | Description |
|------|-------------|
| `0000_colorful_george_stacy.sql` | Baseline — all 15 tables, indexes, and FK constraints. Idempotent; safe on both fresh and existing databases. |

Future migrations will be listed here as they are added.

---

## Schema Smoke Test

After every migration, the smoke test verifies every ORM-defined table and column is present in the live database:

```bash
pnpm --filter @workspace/scripts run schema-smoke-test
```

Exit codes:
- `0` — All tables pass, or `DATABASE_URL` is not set (skip mode in CI)
- `1` — One or more tables/columns are missing (DB is out of sync)
