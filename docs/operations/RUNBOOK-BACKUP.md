# Backup, Recovery & Restore Runbook — Classmate Connect

**Applies to:** All environments
**Last updated:** Sprint 10 Chunk 6

---

## 1 — Backup Strategy

### Scope

The only stateful component requiring backup is **PostgreSQL**. The application code is in version control (Git) and is fully recoverable from source. Env secrets (SESSION_SECRET, PASSWORD_ENCRYPTION_KEY) must be stored separately in a secure secret manager — they are **not** in Git and are **not** in the database.

### Backup frequency

| Tier | Frequency | Retention | When to use |
|------|-----------|-----------|-------------|
| Daily snapshot | Every 24 hours | 7 days | Routine recovery, "restore to yesterday" |
| Weekly snapshot | Every Sunday | 4 weeks | Mid-term recovery, schema regression |
| Pre-migration snapshot | Before any `migrate` or `push` run | Keep indefinitely until next migration verified | Schema rollback |
| Pre-release snapshot | Before any production redeploy | Keep 2 releases | Release rollback |

### Storage location

- **Primary:** Object storage bucket (S3-compatible or equivalent), separate region from the database server
- **Secondary:** Encrypted local copy on a separate host (for offline recovery)

No cloud provider is assumed. The commands below use `pg_dump` (available in all PostgreSQL distributions) and produce plain-SQL or custom-format dumps that can be restored to any compatible PostgreSQL instance.

---

## 2 — Backup Procedure

The backup script is implemented in `scripts/src/backup.ts` and invoked via npm scripts.
It uses `pg_dump --format=custom --compress=9`, writes a timestamped file, and runs retention cleanup automatically.

### Standard daily backup

```bash
# From the project root
BACKUP_DIR=/var/backups/classmate \
  pnpm --filter @workspace/scripts run backup
```

Output filename format: `classmate_YYYYMMDD_HHMMSS_{env}.dump`
Example: `classmate_20260628_020000_production.dump`

### Weekly backup (28-day retention)

```bash
BACKUP_DIR=/var/backups/classmate \
  pnpm --filter @workspace/scripts run backup:weekly
```

### Pre-migration or pre-release backup (keep indefinitely)

```bash
BACKUP_DIR=/var/backups/classmate \
BACKUP_ENV=premigration \
BACKUP_RETENTION_DAYS=9999 \
  pnpm --filter @workspace/scripts run backup
```

### Configuration variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | **Yes** | — | PostgreSQL connection string |
| `BACKUP_DIR` | No | `./backups` | Directory where `.dump` files are written |
| `BACKUP_RETENTION_DAYS` | No | `7` | Days to keep daily backups before pruning |
| `BACKUP_ENV` | No | `$NODE_ENV` or `development` | Label embedded in the filename |

### Scheduling (external scheduler)

Replit does not provide a native cron facility. Schedule the backup from an external system:

**GitHub Actions (recommended)** — create `.github/workflows/backup.yml`:
```yaml
on:
  schedule:
    - cron: '0 2 * * *'   # 02:00 UTC daily
jobs:
  backup:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - run: pnpm install --filter @workspace/scripts
      - run: pnpm --filter @workspace/scripts run backup
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
          BACKUP_DIR: /tmp/classmate-backups
          BACKUP_ENV: production
```

**Operator machine cron** — if running from a server with repo access:
```
0 2 * * * cd /opt/classmate && BACKUP_DIR=/var/backups/classmate pnpm --filter @workspace/scripts run backup >> /var/log/classmate-backup.log 2>&1
```

### Verify a backup is readable

```bash
pg_restore --list classmate_20260628_020000_production.dump | head -20
# Should list tables: students, courses, assignments, assessments, notes, activity, users, session, announcements
```

---

## 3 — Migration Framework

### Overview

| Environment | Schema changes via | History tracked |
|-------------|-------------------|-----------------|
| Development | `drizzle-kit push` | No (apply directly) |
| Production | `drizzle-kit migrate` | Yes (`__drizzle_migrations` table) |

Migration files live in `lib/db/migrations/`. All SQL in migration files is idempotent (`IF NOT EXISTS`, `DO $$ BEGIN` guards) so they can be re-applied safely.

### Apply pending migrations

```bash
pnpm --filter @workspace/db run migrate
```

### Check applied migrations

```sql
SELECT filename, created_at FROM __drizzle_migrations ORDER BY created_at;
```

### Add a new migration

```bash
# Edit schema files in lib/db/src/schema/
# Then generate the migration file:
pnpm --filter @workspace/db run generate
# Review the generated SQL in lib/db/migrations/<timestamp>_<name>.sql
# Then apply:
pnpm --filter @workspace/db run migrate
```

---

## 4 — Fresh Install Recovery

Use when recovering from complete data loss (disk failure, accidental drop, etc.).

### Prerequisites

- A valid backup file (`*.dump` or `*.sql`)
- A new empty PostgreSQL database with `DATABASE_URL` pointing to it
- All environment secrets available (especially `PASSWORD_ENCRYPTION_KEY` — without it, all password hashes are unreadable)

### Step 1 — Create empty database

```sql
-- As postgres superuser:
CREATE DATABASE classmate_production;
```

### Step 2 — Restore backup

**From custom format dump:**

```bash
pg_restore \
  --no-password \
  --dbname="$DATABASE_URL" \
  --verbose \
  classmate_20250611_020000.dump
```

**From plain SQL dump:**

```bash
psql "$DATABASE_URL" < classmate_20250611_020000.sql
```

### Step 3 — Verify data integrity

```sql
-- Check row counts match expected
SELECT
  (SELECT COUNT(*) FROM students  WHERE deleted_at IS NULL) AS students,
  (SELECT COUNT(*) FROM courses   WHERE deleted_at IS NULL) AS courses,
  (SELECT COUNT(*) FROM users     WHERE is_active = true)   AS users;

-- Check FK constraints are present
SELECT conname, conrelid::regclass AS table
FROM pg_constraint
WHERE contype = 'f'
ORDER BY conrelid::regclass::text;
-- Expected: 6 FK constraints on assignments, assessments, announcements, notes

-- Check indexes are present
SELECT indexname FROM pg_indexes
WHERE tablename IN ('assignments','assessments','announcements','notes','courses','activity')
  AND indexname LIKE 'ix_%'
ORDER BY indexname;
-- Expected: 13 ix_* indexes
```

### Step 4 — Apply any missed migrations

If the backup predates a migration, apply it now:

```bash
pnpm --filter @workspace/db run migrate
```

### Step 5 — Start the application

```bash
pnpm --filter @workspace/api-server run build
node --enable-source-maps artifacts/api-server/dist/index.mjs
```

Verify: `GET /api/healthz` returns `{"status":"ok"}`.

---

## 5 — Selective Table Restore

To restore a single table from a custom-format backup (e.g., accidental mass-delete):

```bash
# List available tables in the dump
pg_restore --list classmate_backup.dump | grep "TABLE DATA"

# Restore just the students table
pg_restore \
  --no-password \
  --dbname="$DATABASE_URL" \
  --table=students \
  --data-only \
  classmate_backup.dump
```

> **Warning:** Restoring a single table may violate FK constraints if dependent rows in other tables reference rows that were deleted. Disable triggers or use `--disable-triggers` carefully in that scenario, and re-enable them after restore.

---

## 6 — Disaster Recovery Procedure

Complete end-to-end recovery after catastrophic failure:

| Step | Action | Estimated time |
|------|--------|----------------|
| 1 | Provision new PostgreSQL database | 2–5 min |
| 2 | Set `DATABASE_URL` to new database | 1 min |
| 3 | Restore latest backup via `pg_restore` | 5–30 min (data-size dependent) |
| 4 | Verify row counts and FK constraints | 5 min |
| 5 | Apply any pending migrations | 1–2 min |
| 6 | Deploy application code | 2–3 min |
| 7 | Verify health check and login | 2 min |
| **Total** | | **~20–45 min** |

### RTO / RPO estimates

| Metric | Value | Notes |
|--------|-------|-------|
| RTO (Recovery Time Objective) | < 1 hour | With runbook + available backup |
| RPO (Recovery Point Objective) | < 24 hours | With daily backups; < 1 hour with pre-migration backups |

---

## 7 — Backup Verification (Monthly)

Run this monthly to confirm backups are valid and restores work:

1. Take a fresh backup
2. Restore it to a **test database** (never the production database)
3. Run the integrity queries from Step 3 of §4
4. Attempt a login against the test database instance
5. Record the result and timestamp in an operations log
6. Drop the test database

A backup that has never been tested is not a backup — it is an untested assumption.
