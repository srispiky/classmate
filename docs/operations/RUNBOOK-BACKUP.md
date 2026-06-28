# Backup, Recovery & Restore Runbook — Classmate Connect

**Applies to:** All environments
**Last updated:** Sprint 10 Chunk 7

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

No cloud provider is assumed. The commands below use `pg_dump` (available in all PostgreSQL distributions) and produce custom-format dumps that can be restored to any compatible PostgreSQL instance.

---

## 2 — Backup Procedure

The backup script is implemented in `scripts/src/backup.ts` and invoked via npm scripts.
It uses `pg_dump --format=custom --compress=9`, writes a timestamped `.dump` file and a matching
`.json` sidecar (row-count snapshot), then runs retention cleanup automatically.

### Standard daily backup

```bash
# From the project root
BACKUP_DIR=/var/backups/classmate \
  pnpm --filter @workspace/scripts run backup
```

Output files:
- `classmate_YYYYMMDD_HHMMSS_{env}.dump` — compressed PostgreSQL backup
- `classmate_YYYYMMDD_HHMMSS_{env}.json` — row-count sidecar (used by restore-verify)

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
# Should list TABLE DATA sections for each of the 11 expected tables
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

## 4 — Restore Procedure

### Automated restore + verification (recommended)

The `restore-verify` script handles restore and integrity checking in one step.

#### Verify-only (check a running database — no restore)

```bash
pnpm --filter @workspace/scripts run restore-verify
```

Runs all integrity checks against `DATABASE_URL`. Exits 0 on PASS, 1 on FAIL.

#### Full DR restore to an auto-created temporary database

```bash
BACKUP_FILE=/var/backups/classmate/classmate_20260628_020000_production.dump \
  pnpm --filter @workspace/scripts run restore-verify:dr
```

Creates a temp database, restores the backup into it, runs integrity checks, then drops it.
Requires `rolcreatedb` privilege (the application database user has this in the current environment).

#### Full DR restore to a pre-provisioned target database

```bash
BACKUP_FILE=/path/to/classmate_20260628_020000_production.dump \
RESTORE_TARGET_URL=postgresql://user:pass@host/classmate_dr \
  pnpm --filter @workspace/scripts run restore-verify
```

#### Restore configuration variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | **Yes** | — | Source DB (used for verify-only and admin operations) |
| `BACKUP_FILE` | Restore mode | — | Path to `.dump` file |
| `RESTORE_TARGET_URL` | No | — | Explicit target DB URL (skips auto-create) |
| `RESTORE_CREATE_DB` | No | `false` | Set to `true` to auto-create and drop a temp DB |
| `RESTORE_KEEP_DB` | No | `false` | Set to `true` to keep the temp DB after the test |

### Manual restore steps (no script)

#### Step 1 — Create empty target database

```sql
-- As a user with CREATE DATABASE privilege:
CREATE DATABASE classmate_production;
```

#### Step 2 — Restore backup

```bash
pg_restore \
  --no-password \
  --no-owner \
  --no-privileges \
  --dbname="postgresql://user:pass@host/classmate_production" \
  classmate_20260628_020000_production.dump
```

#### Step 3 — Verify data integrity

```bash
# Automated (recommended):
BACKUP_FILE=classmate_20260628_020000_production.dump \
RESTORE_TARGET_URL=postgresql://user:pass@host/classmate_production \
  pnpm --filter @workspace/scripts run restore-verify

# Manual SQL checks:
psql "$TARGET_URL" -c "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;"
# Expected: 11 tables (activity, announcements, assessments, assignments,
#           course_enrollments, courses, notes, session, student_guardians, students, users)

psql "$TARGET_URL" -c "SELECT COUNT(*) FROM pg_constraint WHERE contype='f';"
# Expected: >= 36

psql "$TARGET_URL" -c "SELECT COUNT(*) FROM pg_indexes WHERE schemaname='public' AND indexname LIKE 'ix_%';"
# Expected: >= 18

psql "$TARGET_URL" -c "SELECT relname, n_live_tup FROM pg_stat_user_tables WHERE schemaname='public' ORDER BY relname;"
# Compare counts against the .json sidecar file
```

#### Step 4 — Apply any missed migrations

If the backup predates a migration, apply it now:

```bash
pnpm --filter @workspace/db run migrate
```

#### Step 5 — Start the application

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
| 3 | Restore latest backup via `restore-verify:dr` | 5–30 min (data-size dependent) |
| 4 | Verify integrity check output shows PASS | 1 min |
| 5 | Apply any pending migrations | 1–2 min |
| 6 | Deploy application code | 2–3 min |
| 7 | Verify health check and login | 2 min |
| **Total** | | **~15–45 min** |

### RTO / RPO estimates

| Metric | Value | Basis |
|--------|-------|-------|
| RTO (Recovery Time Objective) | **< 45 minutes** | Automated restore + verify via `restore-verify:dr` |
| RPO (Recovery Point Objective) | **< 24 hours** | Daily backup cadence |
| RPO with pre-migration backups | **< 1 hour** | Triggered immediately before each schema change |

These estimates assume:
- Backup file is accessible (object storage or local copy)
- Target PostgreSQL instance is already provisioned
- Operator has repo access and credentials

---

## 7 — Monthly Backup Drill

Run this procedure once per month to confirm backups are valid and the restore path works end-to-end. Record results in `docs/operations/backup-drill-log.md`.

### Drill steps

```bash
# Step 1: Take a fresh backup
BACKUP_DIR=/var/backups/classmate pnpm --filter @workspace/scripts run backup

# Step 2: Run DR simulation (creates temp DB, restores, verifies, drops)
BACKUP_FILE=/var/backups/classmate/<latest>.dump \
  pnpm --filter @workspace/scripts run restore-verify:dr

# Step 3: Record result in backup-drill-log.md
```

**Expected output:**
```
[restore-verify] Mode: full-dr (auto temp DB)
[restore-verify] Creating temp database: classmate_dr_<timestamp>
[restore-verify] Backup verified: classmate_...dump — N TABLE DATA sections
[restore-verify] Restoring ... → target database…
[restore-verify] pg_restore completed
[restore-verify] Running integrity checks…
[restore-verify] Tables present: 11 / 11 expected
[restore-verify] Foreign keys: 36 (min 36)
[restore-verify] ix_* indexes: 18 (min 18)
[restore-verify] Result: PASS ✓
[restore-verify] Dropping temp database: classmate_dr_<timestamp>
```

A backup that has never been tested is not a backup — it is an untested assumption.

---

## 8 — Troubleshooting

### pg_restore exits with warnings but restore looks complete

pg_restore uses exit code 1 for both fatal errors and non-fatal warnings. Check the warning text:
- `already exists` — target database was not empty; the restore may still be complete
- `permission denied` — the restore user lacks ownership; use `--no-owner --no-privileges`
- `invalid data` / `file format` — the backup file is corrupt; use a different backup

### Integrity check fails after restore

Run `restore-verify` manually against the restored database to see which specific checks fail:

```bash
RESTORE_TARGET_URL=postgresql://user:pass@host/classmate_dr \
  pnpm --filter @workspace/scripts run restore-verify
```

Common causes:
- Missing tables: pg_restore was run against a non-empty database with conflicting objects
- Low FK count: backup was taken mid-migration (schema partially applied)
- Row count mismatch: backup is from a different point in time than the sidecar

### Cannot create temp database (RESTORE_CREATE_DB=true fails)

The database user must have `rolcreatedb = true`. Check with:

```sql
SELECT rolcreatedb FROM pg_roles WHERE rolname = current_user;
```

If `false`, either grant the privilege or use a pre-provisioned target database via `RESTORE_TARGET_URL`.

### Retention not pruning files

Filenames must match the format `classmate_YYYYMMDD_HHMMSS_env.dump`. Files with non-standard names are ignored by the retention logic (this is intentional — it protects pre-migration backups renamed manually).
