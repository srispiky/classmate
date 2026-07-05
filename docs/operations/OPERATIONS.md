# Production Operations Guide — Classmate Connect

**Last updated:** Sprint 11 Chunk B
**Readiness score:** 89.25 / 100

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Monitoring & Logging](#2-monitoring--logging)
3. [Backup Monitoring](#3-backup-monitoring)
4. [Critical Operational Events](#4-critical-operational-events)
5. [Failure Scenarios & Responses](#5-failure-scenarios--responses)
6. [Security Operations Verification](#6-security-operations-verification)
7. [Production Readiness Assessment](#7-production-readiness-assessment)
8. [Remaining Launch Blockers](#8-remaining-launch-blockers)

Related runbooks:
- [RUNBOOK-DEPLOY.md](./RUNBOOK-DEPLOY.md) — deployment, rollback, health checks
- [RUNBOOK-BACKUP.md](./RUNBOOK-BACKUP.md) — backup, recovery, fresh install

---

## 1 — Architecture Overview

```
Browser / SPA
     │
     ▼
Replit Proxy (path-based routing, mTLS)
     │
     ├─── / ──────────► Frontend (static files, classmate Vite build)
     │
     └─── /api ────────► API Server (Express 5, Node.js 24)
                              │
                              ▼
                         PostgreSQL (Replit managed)
                         connect-pg-simple (session store)
```

**Runtime:** Node.js 24, single process
**Session storage:** PostgreSQL (`session` table via `connect-pg-simple`)
**Auth model:** Cookie-based sessions, role-based access (admin / teacher / student / guest)
**Password security:** AES-256-GCM envelope encryption over bcrypt (cost 12)

---

## 2 — Monitoring & Logging

### Logging infrastructure

The API server uses **pino** for structured JSON logging. All log lines are machine-parseable.

| Environment | Log format | Level |
|-------------|-----------|-------|
| Development | pino-pretty (colored, human-readable) | `info` (default) |
| Production | JSON (one object per line) | `info` (configurable via `LOG_LEVEL`) |

Set `LOG_LEVEL=debug` temporarily during incident investigation. Revert to `info` afterward.

### Sensitive data redaction

The following fields are **automatically redacted** from all log output:

- `req.headers.authorization`
- `req.headers.cookie`
- `res.headers['set-cookie']`

This is enforced in `lib/logger.ts` via pino's `redact` option. No session tokens, passwords, or auth headers appear in logs.

### Request log format

Every HTTP request produces a structured log line:

```json
{
  "level": 30,
  "time": 1749657600000,
  "req": { "id": "1", "method": "GET", "url": "/api/students" },
  "res": { "statusCode": 200 },
  "responseTime": 42
}
```

The `url` field strips query strings (see `app.ts` serializer) to prevent sensitive filter values from appearing in logs.

### Log levels

| Level | Usage |
|-------|-------|
| `fatal` | Startup failures (DB unreachable, missing env var) — process exits |
| `error` | Unexpected exceptions, port bind failures |
| `warn` | Authorization denied (403), rate-limit triggered (429) |
| `info` | Normal request lifecycle, startup summary, DB connectivity verified |
| `debug` | Verbose — query params, scope context — dev/investigation only |

---

## 3 — Backup Monitoring

### Automated backup schedule

Backups run automatically via `.github/workflows/backup.yml`:

| Type | Schedule | GitHub artifact TTL | Offsite retention |
|------|----------|--------------------|--------------------|
| Daily | 02:00 UTC every day | 30 days | 30 days |
| Weekly | 02:00 UTC every Sunday | 90 days | 84 days (12 weeks) |
| Monthly | 02:00 UTC on 1st of month | 365 days | 365 days (12 months) |

GitHub Actions artifacts: **GitHub → Actions → Database Backup → Artifacts**

Offsite backups: `s3://{S3_BUCKET}/backups/{tier}/{filename}` — browsable with `aws s3 ls` or the provider's console.

### Expected log signatures (GitHub Actions run)

A healthy backup run produces these log lines:

**Backup script:**
```
[backup] Starting backup → classmate_YYYYMMDD_020000_production.dump
[backup] SUCCESS: classmate_YYYYMMDD_020000_production.dump (NNN KB)
[backup] Sidecar written: classmate_YYYYMMDD_020000_production.json
[backup] Retention: no files to prune (policy: 7 days)
[backup] Done
```

**Validation steps:**
```
TABLE DATA sections in dump: 11
```
(11 is the expected table count — a lower number is an error.)

**Replication (when S3_BUCKET configured):**
```
[replicate] Uploading dump → s3://<bucket>/backups/daily/classmate_YYYYMMDD_020000_production.dump
[replicate] Dump uploaded and verified (NNN KB, sha256=<first 12 chars>…)
[replicate] Uploading sidecar → s3://<bucket>/backups/daily/classmate_YYYYMMDD_020000_production.json
[replicate] Sidecar uploaded and verified
[replicate] Retention: no offsite objects to prune for daily (policy: 30 days)
[replicate] SUCCESS
```

**Replication skipped (S3_BUCKET not yet configured):**
```
Offsite replication: skipped (S3_BUCKET not configured)
```
This is a notice, not an error — the backup and artifact upload still succeed.

### Alerting

GitHub sends failure email notifications automatically for failed scheduled workflows.

To check backup status manually:

```bash
gh run list --workflow=backup.yml --limit=10
```

### Troubleshooting

| Symptom | Likely cause | Action |
|---------|-------------|--------|
| "Run backup" fails: `DATABASE_URL is not set` | Secret not configured | Add `DATABASE_URL` under **Settings → Secrets → Actions** |
| "Validate — dump file exists" fails | `pg_dump` auth error | Verify `DATABASE_URL` value is correct and points to production |
| `TABLE DATA sections in dump: 0` | DB empty or pg_restore mismatch | Restore locally and inspect with `pg_restore --list` |
| "Replicate to offsite storage" fails: `NoSuchBucket` | Bucket doesn't exist | Create bucket; verify `S3_BUCKET` and `AWS_REGION` secrets |
| "Replicate" fails: `Upload integrity check failed` | Network corruption or provider issue | Re-run workflow; if persistent, check S3_ENDPOINT config |
| "Replicate" fails: `Checksum mismatch` | File corrupted in transit | Re-run workflow; if persistent, escalate to storage provider |
| Artifact not found after TTL | Retention window expired | Download from offsite storage (30-day window still valid for daily) |

---

## 4 — Critical Operational Events

Monitor for these log signatures in production:

### Startup events (expected at every boot)

```
Classmate Connect API — startup configuration  env=production port=8080 ...
Database connectivity verified
Server listening — ready to accept requests  port=8080
```

**Alert if any of these are absent** — the server may have exited silently.

### Security events to alert on

| Event | Log signature | Action |
|-------|--------------|--------|
| Authentication failure (repeated) | `statusCode: 401` from `/api/auth/login` | Investigate brute-force; review rate limiter |
| Authorization denied | `statusCode: 403` | Review if legitimate access pattern or probing |
| Rate limit triggered | `statusCode: 429` from `/api/auth/login` | Check for credential stuffing attack |
| CORS rejection | `"CORS: origin not allowed"` in error | Check `ALLOWED_ORIGINS` config or probe |

### Database events

| Event | Meaning | Action |
|-------|---------|--------|
| `"Database connectivity check failed at startup"` | DB unreachable at boot | Check DB host, credentials, network |
| `"Failed query"` in Drizzle output | SQL error | Check for schema mismatch or constraint violation |
| Connection pool exhaustion | pg Pool `"timeout acquiring"` | Increase pool size or investigate query leak |

### Application errors

| Pattern | Meaning | Action |
|---------|---------|--------|
| Any `level: "fatal"` log | Unrecoverable startup error | Immediate investigation required |
| Any `level: "error"` log | Unexpected runtime exception | Review stack trace, check for regression |
| `process.exit(1)` at boot | Missing env var or DB failure | Check secrets, check DB connectivity |

---

## 4 — Failure Scenarios & Responses

### Scenario 1 — Database unavailable at startup

**Symptom:** Server exits immediately with:
```
Database connectivity check failed at startup — aborting  error="..."
```

**Root cause:** `DATABASE_URL` points to an unreachable or non-existent host, or the database service is down.

**Operator actions:**
1. Verify `DATABASE_URL` is correctly set in Replit Secrets
2. Check the PostgreSQL service is running and accepting connections
3. Test connectivity: `psql $DATABASE_URL -c "SELECT 1"`
4. Restart the application after the database is confirmed reachable

---

### Scenario 2 — Missing required environment variable

**Symptom:** Server exits with one of:
```
PORT environment variable is required but was not provided.
SESSION_SECRET environment variable is required
PASSWORD_ENCRYPTION_KEY environment variable is required
DATABASE_URL, ensure the database is provisioned
```

**Operator actions:**
1. Check Replit Secrets — all four required variables must be present
2. Verify values are correct format:
   - `PORT` — positive integer (production: `8080`)
   - `SESSION_SECRET` — any non-empty string (minimum 32 chars recommended)
   - `PASSWORD_ENCRYPTION_KEY` — exactly 64 hex characters
   - `DATABASE_URL` — valid PostgreSQL connection string
3. Restart after correcting

---

### Scenario 3 — Migration failure

**Symptom:** `drizzle-kit migrate` fails with a constraint or syntax error.

**Operator actions:**
1. Do **not** re-run the migration blindly — identify the failing statement
2. Take a database backup immediately before any manual intervention
3. Check if the failure is idempotency-safe (the migration uses `IF NOT EXISTS` guards — re-running is safe for this codebase's migration files)
4. If the migration partially applied, inspect `__drizzle_migrations` to see which files were recorded
5. Fix the migration SQL or write a compensating statement
6. Re-apply with `pnpm --filter @workspace/db run migrate`

---

### Scenario 4 — Invalid (rotated) `PASSWORD_ENCRYPTION_KEY`

**Symptom:** All existing user logins fail with `{"error":"Invalid credentials"}` even with correct passwords. Server started successfully.

**Root cause:** The `PASSWORD_ENCRYPTION_KEY` was changed after users were created. The stored password hashes are encrypted with the old key and cannot be decrypted.

**Operator actions:**
1. **Do not rotate this key without a migration plan**
2. If accidentally rotated, restore the original key value from your secret backup
3. If the original key is lost, all users must reset their passwords (admin must re-seed or provide reset mechanism)
4. Going forward: store `PASSWORD_ENCRYPTION_KEY` in a dedicated secret manager with versioning

---

### Scenario 5 — Expired or invalid `SESSION_SECRET`

**Symptom:** All active sessions become invalid simultaneously. Users are logged out and cannot log in (if the key is invalid), or are logged out and must re-authenticate (if the key was rotated).

**Operator actions:**

If rotated intentionally:
- All sessions are immediately invalidated — this is expected
- Users must log in again
- No data is lost

If rotated accidentally with the wrong value:
1. Restore the previous `SESSION_SECRET` value
2. Redeploy — sessions from before the accidental change will be valid again

If the session table is corrupted:
```sql
TRUNCATE TABLE session;
```
All users will be logged out and must re-authenticate. This is a clean recovery.

---

### Scenario 6 — Startup failure (generic)

**Symptom:** `GET /api/healthz` never returns 200; Replit deployment shows the build succeeded but the health check is failing.

**Operator actions:**
1. Check server logs for `fatal` or `error` entries
2. Look for the startup environment summary line — if absent, the app is crashing before reaching `app.listen`
3. Common causes in order of likelihood:
   - Missing `DATABASE_URL` (DB not provisioned)
   - Missing `SESSION_SECRET` or `PASSWORD_ENCRYPTION_KEY`
   - Port conflict (`PORT` already in use)
   - Syntax/runtime error in a startup module (check for `SyntaxError` in logs)
4. Resolve the root cause and redeploy

---

### Scenario 7 — Restore failure

**Symptom:** `pg_restore` exits with errors; tables are missing or row counts are wrong after restore.

**Operator actions:**
1. Check for FK constraint violations in restore output — restore data in dependency order (parent tables before child tables)
2. If partial restore, truncate affected tables and retry from backup
3. Use `--disable-triggers` if FK violations prevent bulk restore, then re-enable:
   ```bash
   pg_restore --disable-triggers --dbname="$DATABASE_URL" backup.dump
   ```
4. After restore, always run the integrity check queries from RUNBOOK-BACKUP.md §4 Step 3
5. If the backup file itself is corrupted, restore from the previous day's backup

---

## 5 — Security Operations Verification

Verified during Sprint 9 (1,863 tests passing as of Chunk 5).

### Authentication & authorization

| Control | Status | Verification method |
|---------|--------|-------------------|
| Login rate limiting (10/15 min per IP) | ✅ Active | `http-authorization.test.ts` — verifies 429 on 11th attempt |
| `requireRole` on all protected routes | ⚠️ Gap — see §7 | HTTP integration tests |
| Session-based auth (cookie, httpOnly) | ✅ Active | `app.ts` session config |
| `secure: true` cookies in production | ✅ Active | `NODE_ENV === "production"` check in `app.ts` |
| `sameSite: "strict"` CSRF defense | ✅ Active | `app.ts` session config |
| 8-hour session expiry | ✅ Active | `maxAge: 8 * 60 * 60 * 1000` |

### Encryption

| Control | Status | Notes |
|---------|--------|-------|
| Passwords: AES-256-GCM + bcrypt(12) | ✅ Active | `lib/password.ts` |
| `PASSWORD_ENCRYPTION_KEY` fail-fast validation | ✅ Fixed (Chunk 6) | `app.ts` module load |

### Network security

| Control | Status | Notes |
|---------|--------|-------|
| Helmet security headers | ✅ Active | `app.ts` — applied globally |
| CORS restricted in production | ✅ Active | `ALLOWED_ORIGINS` env var |
| CORS defaults to localhost-only in dev | ✅ Active | Regex check in `app.ts` |

### Logging & data exposure

| Control | Status | Notes |
|---------|--------|-------|
| Auth headers redacted from logs | ✅ Active | `lib/logger.ts` pino redact config |
| Cookies redacted from logs | ✅ Active | `lib/logger.ts` pino redact config |
| Query strings stripped from request logs | ✅ Active | `app.ts` req serializer |

### ~~Known gap: Course catalog open to unauthenticated users~~ — RESOLVED (Sprint 9 Chunk 8)

`GET /api/courses` and `GET /api/courses/:id` are protected by:
1. `requireAuth` — applied globally in `routes/index.ts` before `coursesRouter` is mounted
2. `requireRole("admin", "teacher")` — explicit Layer 1 gate on both GET handlers in `routes/courses.ts`

Unauthenticated requests → 401. Student/parent/guest requests → 403. Full regression coverage in
`tests/http/course-layer1-security.test.ts` (13 tests) and `tests/http/http-authorization.test.ts`.

---

## 6 — Production Readiness Assessment

### Score by domain

| Domain | Weight | Score | Weighted |
|--------|--------|-------|---------|
| Security | 30% | 87 | 26.1 |
| Authorization | 20% | 90 | 18.0 |
| Database integrity | 15% | 88 | 13.2 |
| Performance | 10% | 88 | 8.8 |
| **Deployment & ops** | **10%** | **92** | **9.2** |
| Test coverage | 10% | 92 | 9.2 |
| OpenAPI / contract | 5% | 95 | 4.75 |
| **Total** | | | **89.25 / 100** |

### What changed in Chunk 6

| Area | Before | After |
|------|--------|-------|
| `PASSWORD_ENCRYPTION_KEY` validation | Lazy (first login call) | Fail-fast at startup |
| DB connectivity at startup | Not checked | Verified with 5s timeout; exits if unreachable |
| Health check (`/api/healthz`) | Returns `ok` without probing DB | Probes DB; returns 503 if unreachable |
| Startup log | Port only | Full env summary (presence, not values) |
| Deployment runbook | None | Created (RUNBOOK-DEPLOY.md) |
| Backup / recovery runbook | None | Created (RUNBOOK-BACKUP.md) |
| Operations guide | None | This document |

### Readiness by tier

| Scale | Readiness | Notes |
|-------|-----------|-------|
| 100 users | ✅ Ready for production | All blockers documented; primary risk is courses open read |
| 1,000 users | ✅ Ready with monitoring | Indexes and SQL aggregation handle this load |
| 10,000 users | ⚠️ Needs pagination | Unbounded list queries are a risk at scale |

---

## 7 — Remaining Launch Blockers

| ID | Severity | Description | Status |
|----|---------|-------------|--------|
| ~~F1~~ | ~~High~~ | ~~`GET /api/courses` and `GET /api/courses/:id` have no `requireRole`~~ | **CLOSED** — Fixed Sprint 9 Chunk 8. `requireAuth` + `requireRole("admin","teacher")` applied. 13 regression tests in `course-layer1-security.test.ts`. |
| M3 | Medium | No pagination on `/students`, `/assignments`, `/assessments` — full-table queries at scale | **CLOSED** — Cursor-based pagination implemented Sprint 10 Chunks 1–4. |
| M4 | Low | `/dashboard/student-health` student cohort classification is linear in student count | Open — Acceptable to 1K students; revisit at scale. |
| M8 | Low | No external process supervisor (PM2, systemd) — Replit restart on crash | Open — Replit deployment restarts the process; mitigated in production deployment. |

All original blockers (F1, M3) are closed. Only low-severity operational items remain open.
