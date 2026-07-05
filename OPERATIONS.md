# Operations Guide — Classmate Connect

## Table of Contents

1. [Overview](#overview)
2. [Monitoring](#monitoring)
3. [SLO Definitions](#slo-definitions)
4. [Error Budget Policy](#error-budget-policy)
5. [Alert Types](#alert-types)
6. [Incident Response](#incident-response)
7. [Backup Procedures](#backup-procedures)
8. [Reporting Workflow](#reporting-workflow)
9. [Thresholds Reference](#thresholds-reference)
10. [Escalation Guidance](#escalation-guidance)

---

## Overview

Classmate Connect is a Node.js/Express API server backed by PostgreSQL. The platform exposes a real-time operations dashboard at `/monitoring` (admin only), alert center at `/monitoring/alerts`, and SLO/availability reporting at `/monitoring/slo`.

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
| `GET /api/monitoring/status` | System status: DB, backup, replication, alert counts |
| `GET /api/monitoring/summary` | Metrics: requests, latency, auth, DB, backup |
| `GET /api/monitoring/alerts` | All alerts (filter by `?status=active`) |
| `GET /api/monitoring/alerts/:id` | Single alert detail |
| `PATCH /api/monitoring/alerts/:id` | Acknowledge or resolve an alert |
| `GET /api/monitoring/slo` | SLO compliance and error budget report |
| `GET /api/monitoring/availability` | Availability and capacity indicators |
| `GET /api/monitoring/operations-report` | Aggregated operational report |

### Dashboard Pages (admin only)

| Path | Description |
|---|---|
| `/monitoring` | Operations dashboard: status, metrics, SLO quicklink, alert summary |
| `/monitoring/alerts` | Alert Center: active/acknowledged/resolved alerts |
| `/monitoring/slo` | SLO dashboard: compliance, error budgets, availability, capacity |

---

## SLO Definitions

All SLOs are evaluated over a **30-day rolling window**. Data is session-scoped and resets on server restart. For persistent SLO tracking, integrate Prometheus + Grafana.

### API Availability
- **Target**: 99.9% (budget: ~43.2 minutes/month)
- **Measurement**: Non-5xx responses / total responses
- **Breach trigger**: More than 0.1% of requests return 5xx errors

### Authentication Availability
- **Target**: 99.9% (budget: ~43.2 minutes/month)
- **Measurement**: Non-rate-limited auth requests / total auth requests
- **Breach trigger**: More than 0.1% of login attempts are rate-limited

### Backup Success Rate
- **Target**: 100% (zero tolerance for failures)
- **Measurement**: Successful backup runs / total backup runs
- **Breach trigger**: Any backup run failure

### Replication Success Rate
- **Target**: 100%
- **Measurement**: S3 replication active (S3_BUCKET configured) = 100%, not configured = 0%
- **Breach trigger**: S3_BUCKET environment variable not set

### Health Endpoint Availability
- **Target**: 99.99% (budget: ~4.3 minutes/month)
- **Measurement**: Server process uptime (proxy for health endpoint availability)
- **Breach trigger**: Database unavailability (causes degraded health response)

---

## Error Budget Policy

Error budgets express how much unavailability is allowed before an SLO is breached.

### Burn Rate Interpretation

| Burn Rate | Meaning | Action |
|---|---|---|
| < 1x | Consuming slower than allowed | Normal operation |
| 1x | Exactly on pace to exhaust budget at month end | Monitor |
| > 2x | Elevated — budget exhausted in < 2 weeks | Investigate |
| > 10x | Critical — budget exhausted in < 3 days | Incident response |

### Budget Status

| Status | Threshold | Response |
|---|---|---|
| Healthy | < 50% consumed | No action needed |
| At Risk | 50–99% consumed | Review and monitor closely |
| Exhausted | 100% consumed | SLO breached — file incident |

### Monthly Reporting

1. Visit `/monitoring/slo` on the last day of each month.
2. Export the error budget table for each SLO.
3. Review recommendations from `/monitoring/operations-report`.
4. File a post-incident review for any SLO breach.
5. Update thresholds if sustained false-positive alerting is observed.

---

## Alert Types

### Authentication Alerts

| Alert | Severity | Condition |
|---|---|---|
| `auth.excessive_login_failures` | HIGH | > 10 login failures this session |
| `auth.rate_limit_violations` | MEDIUM | > 5 rate-limit hits this session |

### Database Alerts

| Alert | Severity | Condition |
|---|---|---|
| `db.unavailable` | CRITICAL | DB health check failed |
| `db.repeated_query_failures` | HIGH | > 5 query failures this session |

### Backup Alerts

| Alert | Severity | Condition |
|---|---|---|
| `backup.failure` | HIGH | Any backup run failure |

### Application Health Alerts

| Alert | Severity | Condition |
|---|---|---|
| `app.elevated_error_rate` | HIGH | > 5% 5xx rate with ≥ 50 requests |

### Performance Alerts

| Alert | Severity | Condition |
|---|---|---|
| `perf.high_p95_latency` | MEDIUM | Global p95 > 500ms (≥ 20 samples) |
| `perf.high_p99_latency` | HIGH | Global p99 > 1000ms (≥ 20 samples) |
| `perf.slow_endpoint` | MEDIUM | Endpoint p95 > 1000ms |

---

## Incident Response

### P0 — Critical (CRITICAL severity alerts)

Immediate action required. SLA: respond within 5 minutes.

**Triggers**: `db.unavailable`

**Steps**:
1. Acknowledge the alert in the Alert Center.
2. Check DB connectivity: `psql $DATABASE_URL -c "SELECT 1"`.
3. Review DB server logs for OOM, disk full, connection exhaustion.
4. If connection pool exhausted: restart the API server.
5. If disk full: extend volume or purge old logs.
6. Resolve the alert once DB is confirmed healthy.
7. File post-incident review.

### P1 — High (HIGH severity alerts)

Respond within 30 minutes.

**Triggers**: `auth.excessive_login_failures`, `db.repeated_query_failures`, `backup.failure`, `app.elevated_error_rate`, `perf.high_p99_latency`

**Steps**:
1. Acknowledge the alert.
2. Identify the triggering condition from the alert metadata.
3. Investigate root cause (error logs, DB slow query log, auth logs).
4. Apply fix or mitigation.
5. Monitor until condition clears (auto-resolves) or manually resolve.

### P2 — Medium (MEDIUM severity alerts)

Respond within 2 hours during business hours.

**Triggers**: `auth.rate_limit_violations`, `perf.high_p95_latency`, `perf.slow_endpoint`

**Steps**:
1. Review the alert detail for affected endpoints or patterns.
2. Investigate during next business day if outside hours.
3. Consider query optimisation, index review, or load balancing.

---

## Backup Procedures

### Configuration

Backup is active when `DATABASE_URL` is set (always true in production). S3 replication requires `S3_BUCKET`.

### Verification

1. Check backup status: `GET /api/monitoring/status` → `backup.configured`.
2. Verify last run: `backup.lastRunAt` should be recent.
3. Check failure count: `backup.failures` should be 0.

### Recovery

If backup has failures:
1. Inspect server logs for backup error messages.
2. Verify `DATABASE_URL` is valid and DB is reachable.
3. If S3 replication is enabled, verify `S3_BUCKET` and IAM permissions.
4. Re-run backup manually and monitor.

---

## Reporting Workflow

### Weekly Check (every Monday)

1. Review `/monitoring/slo` — check compliance and burn rates.
2. Review `/monitoring/alerts` for any unresolved alerts.
3. Check capacity indicators — flag if request rate is growing unexpectedly.

### Monthly Operations Report

1. Navigate to `/monitoring/slo` as admin.
2. Click through to the full Operations Report.
3. Check SLO compliance table and recommendations.
4. For any breached SLO: document root cause and remediation.
5. Archive the report summary (copy from the dashboard or use `GET /api/monitoring/operations-report`).

---

## Thresholds Reference

| Metric | Threshold | Alert Type |
|---|---|---|
| Login failures | > 10 | auth.excessive_login_failures |
| Rate limit hits | > 5 | auth.rate_limit_violations |
| DB query failures | > 5 | db.repeated_query_failures |
| 5xx error rate | > 5% (min 50 req) | app.elevated_error_rate |
| Global p95 latency | > 500ms | perf.high_p95_latency |
| Global p99 latency | > 1000ms | perf.high_p99_latency |
| Endpoint p95 latency | > 1000ms | perf.slow_endpoint |

---

## Escalation Guidance

| Condition | Escalate To | Channel |
|---|---|---|
| DB unavailable > 5 min | On-call engineer | PagerDuty / phone |
| SLO exhausted | Engineering lead | Slack #incidents |
| Multiple SLOs breached | CTO | Email + Slack |
| Backup failure > 24h | DevOps lead | Email |
| Security alert (auth storms) | Security team | Slack #security |

### SLO Breach Escalation

When an SLO breach is detected:

1. **Immediately**: Acknowledge the breach in the Alert Center.
2. **Within 1 hour**: Open an incident document.
3. **Within 4 hours**: Root cause identified and mitigation in place.
4. **Within 24 hours**: Post-incident review completed.
5. **Next sprint**: Preventive measures implemented and tested.

---

*All monitoring data is session-scoped and resets on server restart. For production-grade persistent SLO tracking, integrate a time-series database (Prometheus, Datadog, or similar).*
