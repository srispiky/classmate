/**
 * AlertService — in-memory alert store with active/acknowledged/resolved lifecycle.
 *
 * Evaluation runs on demand (called by monitoring route handlers) so no setInterval
 * is required. Each alert type maps to at most one active alert at a time (dedup by
 * type). When a condition clears, the active alert is auto-resolved.
 *
 * No notifications are implemented here — this is the foundational lifecycle only.
 */

import { randomUUID } from "crypto";
import type { MetricsSnapshot, SlowEndpoint } from "./metrics";

// ── Types ─────────────────────────────────────────────────────────────────────

export type AlertSeverity = "low" | "medium" | "high" | "critical";
export type AlertStatus = "active" | "acknowledged" | "resolved";

export interface Alert {
  id: string;
  type: string;
  severity: AlertSeverity;
  status: AlertStatus;
  title: string;
  description: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
}

// ── Alert condition definitions ───────────────────────────────────────────────

// Configurable thresholds — constants so they are easy to find and change.
export const ALERT_THRESHOLDS = {
  /** Login failures in-session before alerting. */
  AUTH_LOGIN_FAILURES: 10,
  /** Rate-limit hits in-session before alerting. */
  AUTH_RATE_LIMIT_HITS: 5,
  /** DB query failures in-session before alerting. */
  DB_QUERY_FAILURES: 5,
  /** 5xx error rate (%) above which to alert. Requires MIN_REQUESTS. */
  ERROR_RATE_PERCENT: 5,
  /** Minimum request count before checking error rate (avoid false positives). */
  MIN_REQUESTS_FOR_RATE: 50,
  /** p95 response time (ms) above which to raise a MEDIUM latency alert. */
  P95_LATENCY_MS: 500,
  /** p99 response time (ms) above which to raise a HIGH latency alert. */
  P99_LATENCY_MS: 1000,
  /** Individual endpoint p95 (ms) above which to raise a slow-endpoint alert. */
  SLOW_ENDPOINT_P95_MS: 1000,
} as const;

// ── AlertService ──────────────────────────────────────────────────────────────

export class AlertService {
  private store = new Map<string, Alert>();

  // ── Core helpers ────────────────────────────────────────────────────────────

  private now(): string {
    return new Date().toISOString();
  }

  /** Ensure there is exactly one ACTIVE alert for the given type. */
  private fireAlert(
    type: string,
    severity: AlertSeverity,
    title: string,
    description: string,
    metadata: Record<string, unknown> = {},
  ): void {
    // Find an existing active alert of this type to avoid duplicates.
    const existing = [...this.store.values()].find(
      (a) => a.type === type && a.status === "active",
    );
    if (existing) {
      // Update description + metadata so it stays fresh.
      existing.description = description;
      existing.metadata = { ...existing.metadata, ...metadata };
      existing.updatedAt = this.now();
      return;
    }

    const id = randomUUID();
    const ts = this.now();
    this.store.set(id, {
      id,
      type,
      severity,
      status: "active",
      title,
      description,
      metadata,
      createdAt: ts,
      updatedAt: ts,
      acknowledgedAt: null,
      resolvedAt: null,
    });
  }

  /** Resolve any active alert of the given type. Acknowledged alerts are left alone. */
  private clearAlert(type: string): void {
    for (const alert of this.store.values()) {
      if (alert.type === type && alert.status === "active") {
        const ts = this.now();
        alert.status = "resolved";
        alert.resolvedAt = ts;
        alert.updatedAt = ts;
      }
    }
  }

  // ── Evaluation ──────────────────────────────────────────────────────────────

  /**
   * Evaluate all alert conditions against the current metrics snapshot and
   * optional database availability flag. Call this on every /monitoring/alerts
   * request so alerts stay up-to-date without background intervals.
   */
  evaluate(snap: MetricsSnapshot, dbOk: boolean): void {
    this.evaluateAuthAlerts(snap);
    this.evaluateDatabaseAlerts(snap, dbOk);
    this.evaluateBackupAlerts(snap);
    this.evaluateAppHealthAlerts(snap);
    this.evaluatePerformanceAlerts(snap);
  }

  // ── Authentication alerts ────────────────────────────────────────────────────

  private evaluateAuthAlerts(snap: MetricsSnapshot): void {
    const { loginFailures, rateLimitHits } = snap.auth;

    if (loginFailures > ALERT_THRESHOLDS.AUTH_LOGIN_FAILURES) {
      this.fireAlert(
        "auth.excessive_login_failures",
        "high",
        "Excessive login failures",
        `${loginFailures} failed login attempts since last restart — possible credential-stuffing attack.`,
        { loginFailures },
      );
    } else {
      this.clearAlert("auth.excessive_login_failures");
    }

    if (rateLimitHits > ALERT_THRESHOLDS.AUTH_RATE_LIMIT_HITS) {
      this.fireAlert(
        "auth.rate_limit_violations",
        "medium",
        "Rate-limit violations detected",
        `${rateLimitHits} rate-limit hits recorded. Review auth logs for source IPs and repeated patterns.`,
        { rateLimitHits },
      );
    } else {
      this.clearAlert("auth.rate_limit_violations");
    }
  }

  // ── Database alerts ──────────────────────────────────────────────────────────

  private evaluateDatabaseAlerts(snap: MetricsSnapshot, dbOk: boolean): void {
    if (!dbOk) {
      this.fireAlert(
        "db.unavailable",
        "critical",
        "Database unavailable",
        "The API server cannot connect to PostgreSQL. All database-backed endpoints are failing.",
        { dbStatus: "error" },
      );
    } else {
      this.clearAlert("db.unavailable");
    }

    if (snap.database.queryFailures > ALERT_THRESHOLDS.DB_QUERY_FAILURES) {
      this.fireAlert(
        "db.repeated_query_failures",
        "high",
        "Repeated database query failures",
        `${snap.database.queryFailures} DB query failures recorded since restart. ` +
          "Check for schema issues, connection pool exhaustion, or long-running transactions.",
        { queryFailures: snap.database.queryFailures },
      );
    } else {
      this.clearAlert("db.repeated_query_failures");
    }
  }

  // ── Backup alerts ────────────────────────────────────────────────────────────

  private evaluateBackupAlerts(snap: MetricsSnapshot): void {
    if (snap.backup.failures > 0) {
      this.fireAlert(
        "backup.failure",
        "high",
        "Backup failure detected",
        `${snap.backup.failures} backup failure(s) recorded. ` +
          "Check backup logs and verify storage connectivity.",
        {
          failures: snap.backup.failures,
          runs: snap.backup.runs,
          lastRunAt: snap.backup.lastRunAt,
        },
      );
    } else {
      this.clearAlert("backup.failure");
    }
  }

  // ── Application health alerts ─────────────────────────────────────────────────

  private evaluateAppHealthAlerts(snap: MetricsSnapshot): void {
    const { total, errors } = snap.requests;
    const errorRate =
      total >= ALERT_THRESHOLDS.MIN_REQUESTS_FOR_RATE
        ? (errors / total) * 100
        : 0;

    if (errorRate > ALERT_THRESHOLDS.ERROR_RATE_PERCENT) {
      this.fireAlert(
        "app.elevated_error_rate",
        "high",
        "Elevated 5xx error rate",
        `Error rate is ${errorRate.toFixed(1)}% (${errors} of ${total} requests). ` +
          "Review server logs filtered by request IDs present in 5xx responses.",
        { errorRate: parseFloat(errorRate.toFixed(1)), errors, total },
      );
    } else {
      this.clearAlert("app.elevated_error_rate");
    }
  }

  // ── Performance alerts ────────────────────────────────────────────────────────

  private evaluatePerformanceAlerts(snap: MetricsSnapshot): void {
    const { p95, p99, sampleSize } = snap.latency;

    // Only alert if we have enough samples to make percentiles meaningful.
    const hasSamples = sampleSize >= 20;

    if (hasSamples && p95 > ALERT_THRESHOLDS.P95_LATENCY_MS) {
      this.fireAlert(
        "perf.high_p95_latency",
        "medium",
        "High p95 response latency",
        `Global p95 latency is ${p95}ms (threshold: ${ALERT_THRESHOLDS.P95_LATENCY_MS}ms). ` +
          "Check slowest endpoints in the monitoring summary.",
        { p95, threshold: ALERT_THRESHOLDS.P95_LATENCY_MS, sampleSize },
      );
    } else {
      this.clearAlert("perf.high_p95_latency");
    }

    if (hasSamples && p99 > ALERT_THRESHOLDS.P99_LATENCY_MS) {
      this.fireAlert(
        "perf.high_p99_latency",
        "high",
        "High p99 response latency",
        `Global p99 latency is ${p99}ms (threshold: ${ALERT_THRESHOLDS.P99_LATENCY_MS}ms). ` +
          "Performance tail is degraded. Review slow query logs and endpoint timings.",
        { p99, threshold: ALERT_THRESHOLDS.P99_LATENCY_MS, sampleSize },
      );
    } else {
      this.clearAlert("perf.high_p99_latency");
    }

    // Slow individual endpoints
    const offendingEndpoints: SlowEndpoint[] = snap.slowestEndpoints.filter(
      (ep) => ep.p95 > ALERT_THRESHOLDS.SLOW_ENDPOINT_P95_MS,
    );

    if (offendingEndpoints.length > 0) {
      const paths = offendingEndpoints.map((ep) => ep.path).join(", ");
      this.fireAlert(
        "perf.slow_endpoint",
        "medium",
        "Slow endpoint(s) detected",
        `${offendingEndpoints.length} endpoint(s) exceeding p95 threshold: ${paths}`,
        {
          endpoints: offendingEndpoints,
          threshold: ALERT_THRESHOLDS.SLOW_ENDPOINT_P95_MS,
        },
      );
    } else {
      this.clearAlert("perf.slow_endpoint");
    }
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  list(status?: AlertStatus): Alert[] {
    const all = [...this.store.values()];
    const filtered = status ? all.filter((a) => a.status === status) : all;
    // Sort: active first, then by severity weight DESC, then by createdAt DESC.
    const severityWeight: Record<AlertSeverity, number> = {
      critical: 4,
      high: 3,
      medium: 2,
      low: 1,
    };
    return filtered.sort((a, b) => {
      if (a.status !== b.status) {
        const order = { active: 0, acknowledged: 1, resolved: 2 };
        return order[a.status] - order[b.status];
      }
      const sw = severityWeight[b.severity] - severityWeight[a.severity];
      if (sw !== 0) return sw;
      return b.createdAt.localeCompare(a.createdAt);
    });
  }

  get(id: string): Alert | undefined {
    return this.store.get(id);
  }

  acknowledge(id: string): Alert | null {
    const alert = this.store.get(id);
    if (!alert) return null;
    if (alert.status !== "active") return alert; // idempotent
    const ts = this.now();
    alert.status = "acknowledged";
    alert.acknowledgedAt = ts;
    alert.updatedAt = ts;
    return alert;
  }

  resolve(id: string): Alert | null {
    const alert = this.store.get(id);
    if (!alert) return null;
    if (alert.status === "resolved") return alert; // idempotent
    const ts = this.now();
    alert.status = "resolved";
    alert.resolvedAt = ts;
    alert.updatedAt = ts;
    return alert;
  }

  /** Used in tests to start from a clean state. */
  reset(): void {
    this.store.clear();
  }

  /** Number of alerts by status. */
  counts(): Record<AlertStatus, number> {
    const result: Record<AlertStatus, number> = {
      active: 0,
      acknowledged: 0,
      resolved: 0,
    };
    for (const a of this.store.values()) result[a.status]++;
    return result;
  }
}

export const alertService = new AlertService();
