# Operations Guide — Classmate Connect

## Table of Contents

1. [Overview](#overview)
2. [Monitoring](#monitoring)
3. [Alert Types](#alert-types)
4. [Incident Response](#incident-response)
5. [Backup Procedures](#backup-procedures)
6. [Thresholds Reference](#thresholds-reference)

---

## Overview

Classmate Connect is a Node.js/Express API server backed by PostgreSQL. The platform exposes a real-time operations dashboard at `/monitoring` (admin only) and an alert center at `/monitoring/alerts` (admin only).

All incidents surface as alerts in the Alert Center. Alerts follow a three-state lifecycle:

```
ACTIVE → ACKNOWLEDGED → RESOLVED
```

Alerts auto-resolve when the underlying condition clears. Acknowledge an alert to signal awareness without dismissing it while work is in progress.

---

## Monitoring

### Endpoints (admin only)

| Endpoint | Description |
|---|---|
| `GET /api/monitoring/status` | System status: DB, backup, replication |
| `GET /api/monitoring/summary` | Metrics: requests, latency, auth, DB, backup |
| `GET /api/monitoring/alerts` | All alerts (filter by `?status=active`) |
| `GET /api/monitoring/alerts/:id` | Single alert detail |
| `PATCH /api/monitoring/alerts/:id` | Acknowledge or resolve an alert |

### Dashboard

Navigate to `/monitoring` in the Classmate app (admin login required).

The Operations page shows:

- System health status (application, database, backup, replication)
- Request volume and error rate
- Latency percentiles (p50/p95/p99)
- Slowest endpoints
- Auth counters
- Active alert summary with link to Alert Center

---

## Alert Types

### Authentication Alerts

| Alert | Severity | Condition |
|---|---|---|
| `auth.excessive_login_failures` | HIGH | > 10 failed logins in session |
| `auth.rate_limit_violations` | MEDIUM | > 5 rate-limit hits in session |

### Database Alerts

| Alert | Severity | Condition |
|---|---|---|
| `db.unavailable` | CRITICAL | Cannot connect to PostgreSQL |
| `db.repeated_query_failures` | HIGH | > 5 query failures in session |

### Backup Alerts

| Alert | Severity | Condition |
|---|---|---|
| `backup.failure` | HIGH | Any backup run has failed |

### Application Health Alerts

| Alert | Severity | Condition |
|---|---|---|
| `app.elevated_error_rate` | HIGH | 5xx rate > 5% (min 50 requests) |

### Performance Alerts

| Alert | Severity | Condition |
|---|---|---|
| `perf.high_p95_latency` | MEDIUM | Global p95 > 500 ms (min 20 samples) |
| `perf.high_p99_latency` | HIGH | Global p99 > 1000 ms (min 20 samples) |
| `perf.slow_endpoint` | MEDIUM | Any endpoint p95 > 1000 ms |

---

## Incident Response

### Database Outage (`db.unavailable` — CRITICAL)

**Symptoms:** Alert Center shows CRITICAL `db.unavailable`. All API calls returning 500/503. Health endpoint shows `status: degraded`.

**Steps:**

1. Check PostgreSQL process: `systemctl status postgresql` (or check managed DB console).
2. Verify `DATABASE_URL` environment variable is set and correct.
3. Check disk space on the database host (`df -h`).
4. Check PostgreSQL logs for OOM, max_connections, or disk errors.
5. If managed DB (e.g. Neon, RDS): check provider status page.
6. Restart PostgreSQL if process crashed: `systemctl restart postgresql`.
7. Verify with health endpoint: `curl /api/healthz`.
8. Once resolved, alert auto-resolves. Resolve manually if needed via Alert Center.

**Escalation:** If DB cannot be restored within 15 minutes, initiate restore from most recent backup (see [Backup Procedures](#backup-procedures)).

---

### Repeated DB Query Failures (`db.repeated_query_failures` — HIGH)

**Symptoms:** Query failure counter rising but DB is reachable.

**Steps:**

1. Check API server logs for specific query error messages (filter by `requestId`).
2. Look for: schema mismatch, missing columns, connection pool exhaustion.
3. Check for long-running transactions blocking writes: `SELECT * FROM pg_stat_activity WHERE state = 'idle in transaction';`
4. Run `VACUUM ANALYZE` if table bloat suspected.
5. Restart API server if pool is exhausted and cannot recover.

---

### Backup Failure (`backup.failure` — HIGH)

**Symptoms:** Alert Center shows HIGH `backup.failure`.

**Steps:**

1. Check backup run logs (in structured log output, filter `component: backup`).
2. Verify storage connectivity (local disk or S3 bucket).
3. If S3 replication: verify `S3_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` are set.
4. Manually trigger a backup and observe logs.
5. Verify checksums are valid after re-run.
6. Update `backup.lastRunAt` will reflect the successful run.
7. Alert auto-resolves once `backup.failures` returns to 0 (after server restart or manual reset).

---

### Authentication Attack (`auth.excessive_login_failures` — HIGH)

**Symptoms:** HIGH `auth.excessive_login_failures` alert, login failure count rising rapidly.

**Steps:**

1. Navigate to Alert Center → note the `loginFailures` count in alert metadata.
2. Check server logs filtered by `POST /api/auth/login` — look for repeating IPs or usernames.
3. If a specific IP is identified, apply rate limiting or block at the reverse proxy / firewall.
4. Verify no admin accounts have been locked or compromised.
5. If a credential-stuffing pattern is confirmed, rotate any potentially exposed passwords.
6. Acknowledge the alert → continue monitoring. Alert auto-resolves when failures drop below threshold (after restart).

---

### Elevated Error Rate (`app.elevated_error_rate` — HIGH)

**Symptoms:** HIGH alert with 5xx error rate > 5%.

**Steps:**

1. Check which status codes are spiking: `GET /api/monitoring/summary` → `requests.byStatus`.
2. Grep server logs for `error` level entries within the affected time window.
3. Use request IDs from error responses to trace specific failures.
4. If a recent deploy is suspected: check git log and roll back if necessary.
5. Verify downstream dependencies (DB, S3, external APIs).
6. Resolve root cause — alert auto-resolves when error rate drops below threshold.

---

### High p95/p99 Latency (`perf.high_p95_latency` / `perf.high_p99_latency`)

**Symptoms:** MEDIUM/HIGH latency alert. Operations dashboard shows elevated percentiles.

**Steps:**

1. Review `slowestEndpoints` in Operations dashboard to identify offending routes.
2. Check database: look for slow queries in `pg_stat_statements`.
3. Check for N+1 query patterns, missing indexes, or full table scans.
4. Inspect memory: if the Node.js process is GC-stressed, heap usage will be high.
5. If external API calls are involved, check third-party latency.
6. Apply appropriate fix: add index, cache result, or optimize query.
7. Alert auto-resolves when latency returns below threshold.

---

### Slow Endpoint (`perf.slow_endpoint`)

**Symptoms:** MEDIUM alert naming one or more slow routes.

**Steps:**

1. Note the endpoint path(s) from alert metadata.
2. Add timing instrumentation or check query explain plans for those routes.
3. Verify the endpoint is not waiting on external I/O.
4. Optimize or cache as needed.

---

## Backup Procedures

See `RUNBOOK-BACKUP.md` for full backup and restore procedures.

**Quick reference:**

- Backups are tracked via `MetricsStore.recordBackupRun(success)`.
- Backup status is visible in `GET /api/monitoring/status` → `backup` field.
- Alert fires on any backup failure.

---

## Thresholds Reference

All thresholds are defined in `artifacts/api-server/src/lib/alerts.ts` under `ALERT_THRESHOLDS`.

| Constant | Default | Alert |
|---|---|---|
| `AUTH_LOGIN_FAILURES` | 10 | excessive login failures |
| `AUTH_RATE_LIMIT_HITS` | 5 | rate limit violations |
| `DB_QUERY_FAILURES` | 5 | repeated query failures |
| `ERROR_RATE_PERCENT` | 5% | elevated error rate |
| `MIN_REQUESTS_FOR_RATE` | 50 | (minimum traffic before error rate fires) |
| `P95_LATENCY_MS` | 500 | high p95 latency |
| `P99_LATENCY_MS` | 1000 | high p99 latency |
| `SLOW_ENDPOINT_P95_MS` | 1000 | slow endpoint |
