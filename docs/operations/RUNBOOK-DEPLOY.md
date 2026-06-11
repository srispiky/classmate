# Deployment Runbook — Classmate Connect

**Applies to:** Replit-hosted deployments (development and production)
**Last updated:** Sprint 9 Chunk 6

---

## Prerequisites

Before deploying, ensure the following are available:

| Requirement | Notes |
|-------------|-------|
| Replit project access | Deployer role or Owner |
| All required env vars set | See §1 — Environment Variable Inventory |
| PostgreSQL database provisioned | `DATABASE_URL` must be set |
| Admin seed credentials decided | `ADMIN_USER`, `ADMIN_PASS`, `ADMIN_NAME` |

---

## 1 — Environment Variable Inventory

### Required (server refuses to start without these)

| Variable | Where validated | Description |
|----------|----------------|-------------|
| `DATABASE_URL` | `lib/db/src/index.ts` (module load) | PostgreSQL connection string |
| `SESSION_SECRET` | `app.ts` (module load) | Cookie signing secret — minimum 32 random characters |
| `PASSWORD_ENCRYPTION_KEY` | `app.ts` (module load) | AES-256 key — exactly 64 hex characters (32 bytes) |
| `PORT` | `index.ts` (entry point) | TCP port the server binds to — set to `8080` in production |

### Optional (have safe defaults in development; must be set in production)

| Variable | Default | Production value |
|----------|---------|-----------------|
| `NODE_ENV` | `"development"` | **`"production"`** — enables secure cookies, disables pino-pretty |
| `ALLOWED_ORIGINS` | Unset (localhost-only) | Comma-separated list of your frontend domains, e.g. `https://app.example.com` |
| `LOG_LEVEL` | `"info"` | `"info"` for normal ops; `"debug"` only for incident investigation |

### Seed-time only (not needed at runtime)

| Variable | Default | Description |
|----------|---------|-------------|
| `ADMIN_USER` | `admin` | Initial admin username |
| `ADMIN_PASS` | `classmate123` | Initial admin password — **change immediately after first login** |
| `ADMIN_NAME` | `Administrator` | Display name for the admin account |

### Generating secrets

```bash
# SESSION_SECRET — 48 random bytes, base64-encoded
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"

# PASSWORD_ENCRYPTION_KEY — exactly 32 bytes, hex-encoded (64 chars)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> **Warning:** `PASSWORD_ENCRYPTION_KEY` is a data key. If it changes after users have been created, all existing password hashes become unreadable and every user must reset their password. Generate once, store securely, never rotate unless you have a migration plan.

---

## 2 — Fresh Installation

### Step 1 — Set environment secrets

In Replit Secrets (or your platform secret manager), set all required variables listed in §1.

Verify none are missing:

```bash
node -e "
const required = ['DATABASE_URL','SESSION_SECRET','PASSWORD_ENCRYPTION_KEY','PORT'];
const missing = required.filter(k => !process.env[k]);
if (missing.length) { console.error('MISSING:', missing); process.exit(1); }
console.log('All required env vars present');
"
```

### Step 2 — Apply database schema

For a **fresh database** (no existing tables):

```bash
pnpm --filter @workspace/db run push
```

Then apply all migrations to reach the current schema version:

```bash
pnpm --filter @workspace/db run migrate
```

Verify migration table:

```sql
SELECT filename, created_at FROM __drizzle_migrations ORDER BY created_at;
-- Expected rows: 0000_baseline, 0001_integrity_constraints
```

### Step 3 — Seed admin account

```bash
ADMIN_USER=admin \
ADMIN_PASS=<strong-password> \
ADMIN_NAME="Administrator" \
pnpm --filter @workspace/scripts run seed-admin
```

**Change the admin password on first login.** The seed script logs the password to stdout — clear your terminal history after running.

### Step 4 — Build

```bash
# Build API server
pnpm --filter @workspace/api-server run build

# Build frontend
pnpm --filter @workspace/classmate run build
```

Both builds must succeed with zero errors before deploying.

### Step 5 — Deploy (Replit)

Click **Publish** in the Replit UI, or use `suggest_deploy` via the agent. The Replit deployment system:

1. Runs `pnpm --filter @workspace/api-server run build` (NODE_ENV=production)
2. Runs `pnpm --filter @workspace/classmate run build`
3. Starts the API server: `node --enable-source-maps artifacts/api-server/dist/index.mjs`
4. Serves the frontend as static files from `artifacts/classmate/dist/public`
5. Polls `GET /api/healthz` until 200 before routing traffic

### Step 6 — Verify

```bash
# Health check
curl -sf https://<your-domain>/api/healthz
# Expected: {"status":"ok"}

# Confirm server is authenticating (not panicking on encryption key)
curl -s -X POST https://<your-domain>/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"wrong","password":"wrong"}'
# Expected: {"error":"Invalid credentials"} with 401
```

Check startup logs for the environment summary:

```
Classmate Connect API — startup configuration  env=production port=8080 allowedOrigins=set ...
Database connectivity verified
Server listening — ready to accept requests  port=8080
```

---

## 3 — Rolling Update (Existing Installation)

For schema-only changes or code-only changes on a running instance:

### Code-only update (no schema change)

1. Merge changes to main branch
2. Click **Redeploy** in the Replit UI
3. Replit runs the build → health check → cuts traffic over

### Schema update (new migration file present)

1. Verify the migration is idempotent (uses `IF NOT EXISTS` / `DO $$ BEGIN` blocks)
2. Run migration against production DB **before** deploying the new code:
   ```bash
   # Point at production DATABASE_URL
   DATABASE_URL=$PROD_DATABASE_URL pnpm --filter @workspace/db run migrate
   ```
3. Verify the migration applied cleanly
4. Redeploy code

Running migrations before the code deploy ensures backward compatibility: the old code runs against the new (extended) schema without error.

---

## 4 — Rollback Procedure

### Code rollback (Replit checkpoints)

Replit creates automatic checkpoints. To roll back:

1. Open the agent/checkpoint history in Replit
2. Identify the last known-good checkpoint by its commit hash
3. Restore the checkpoint via the Replit UI
4. Trigger a redeploy

### Schema rollback

There is no automated down-migration. To reverse a migration:

1. Write a compensating SQL script manually
2. Apply it directly to the database via `executeSql` (Replit DB tool) or `psql`
3. Roll back code to the version before the migration was introduced
4. Do **not** delete migration files from the `migrations/` directory — they are part of the audit trail

### Emergency rollback (full revert)

```bash
# Identify previous known-good commit
git log --oneline -10

# Revert to that state (create a new commit, do not force-push)
git revert HEAD...<previous-good-hash>
git push origin main
```

---

## 5 — Health Verification Checklist

After any deployment, verify:

- [ ] `GET /api/healthz` returns `{"status":"ok"}` with HTTP 200
- [ ] Startup log contains `"Database connectivity verified"`
- [ ] Login succeeds with admin credentials (tests `SESSION_SECRET` + `PASSWORD_ENCRYPTION_KEY`)
- [ ] `GET /api/admin/db-status` returns connected: true (admin session required)
- [ ] Frontend loads at `/` and the dashboard is visible
- [ ] No `fatal` or `error` entries in startup logs
