/**
 * OperationalReportService — generates a point-in-time operational report.
 *
 * Aggregates data from MetricsStore, AlertService, SLOService, and
 * AvailabilityService into a concise monthly-style operations summary.
 *
 * All data is scoped to the current server session (resets on restart).
 * For persistent historical reports integrate a time-series database.
 */

import type { MetricsSnapshot } from "./metrics";
import type { SloSnapshot } from "./slo";
import type { AvailabilitySnapshot } from "./availability";
import type { Alert } from "./alerts";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OperationsReport {
  generatedAt: string;
  reportPeriod: {
    startedAt: string;
    durationSeconds: number;
    durationLabel: string;
  };
  uptime: {
    availabilityPct: number;
    uptimeSeconds: number;
    downtimeSeconds: number;
  };
  requests: {
    total: number;
    errors: number;
    errorRatePct: number;
    avgDurationMs: number;
    requestsPerMinute: number;
  };
  authentication: {
    totalAttempts: number;
    failures: number;
    failureRatePct: number;
    rateLimitHits: number;
  };
  database: {
    queryCount: number;
    queryFailures: number;
    failureRatePct: number;
    avgQueryMs: number;
  };
  backup: {
    runs: number;
    failures: number;
    successRatePct: number;
    lastRunAt: string | null;
  };
  alerts: {
    total: number;
    active: number;
    acknowledged: number;
    resolved: number;
    criticalCount: number;
    highCount: number;
    mediumCount: number;
    lowCount: number;
  };
  slo: {
    compliant: number;
    total: number;
    breached: string[];
    overallHealthLabel: "excellent" | "good" | "at_risk" | "critical";
  };
  capacity: {
    requestsPerMinute: number;
    estimatedDailyRequests: number;
    dbQueryLoad: string;
    backupStorageIndicator: string;
  };
  recommendations: string[];
}

// ── OperationalReportService ──────────────────────────────────────────────────

export class OperationalReportService {
  generate(
    snap: MetricsSnapshot,
    alerts: Alert[],
    sloSnapshot: SloSnapshot,
    availSnap: AvailabilitySnapshot,
  ): OperationsReport {
    const now = new Date().toISOString();
    const elapsed = Math.max(snap.process.uptimeSeconds, 1);
    const elapsedMinutes = elapsed / 60;

    // ── Uptime ──────────────────────────────────────────────────────────────
    const uptime = {
      availabilityPct: availSnap.overall.availabilityPct,
      uptimeSeconds: availSnap.overall.uptimeSeconds,
      downtimeSeconds: availSnap.overall.downtimeSeconds,
    };

    // ── Requests ─────────────────────────────────────────────────────────────
    const { total: reqTotal, errors: reqErrors, avgDurationMs } = snap.requests;
    const requests = {
      total: reqTotal,
      errors: reqErrors,
      errorRatePct: reqTotal > 0 ? parseFloat(((reqErrors / reqTotal) * 100).toFixed(2)) : 0,
      avgDurationMs,
      requestsPerMinute: parseFloat((reqTotal / elapsedMinutes).toFixed(2)),
    };

    // ── Auth ─────────────────────────────────────────────────────────────────
    const { loginAttempts, loginFailures, rateLimitHits } = snap.auth;
    const authentication = {
      totalAttempts: loginAttempts,
      failures: loginFailures,
      failureRatePct:
        loginAttempts > 0
          ? parseFloat(((loginFailures / loginAttempts) * 100).toFixed(2))
          : 0,
      rateLimitHits,
    };

    // ── Database ──────────────────────────────────────────────────────────────
    const { queryCount, queryFailures, avgQueryMs } = snap.database;
    const database = {
      queryCount,
      queryFailures,
      failureRatePct:
        queryCount > 0 ? parseFloat(((queryFailures / queryCount) * 100).toFixed(2)) : 0,
      avgQueryMs,
    };

    // ── Backup ────────────────────────────────────────────────────────────────
    const { runs: backupRuns, failures: backupFailures, lastRunAt } = snap.backup;
    const backup = {
      runs: backupRuns,
      failures: backupFailures,
      successRatePct:
        backupRuns > 0
          ? parseFloat((((backupRuns - backupFailures) / backupRuns) * 100).toFixed(2))
          : 100,
      lastRunAt,
    };

    // ── Alerts ────────────────────────────────────────────────────────────────
    const alertSummary = {
      total: alerts.length,
      active: alerts.filter((a) => a.status === "active").length,
      acknowledged: alerts.filter((a) => a.status === "acknowledged").length,
      resolved: alerts.filter((a) => a.status === "resolved").length,
      criticalCount: alerts.filter((a) => a.severity === "critical").length,
      highCount: alerts.filter((a) => a.severity === "high").length,
      mediumCount: alerts.filter((a) => a.severity === "medium").length,
      lowCount: alerts.filter((a) => a.severity === "low").length,
    };

    // ── SLO ───────────────────────────────────────────────────────────────────
    const breached = sloSnapshot.slos
      .filter((s) => !s.compliant)
      .map((s) => s.name);

    const overallHealthLabel = this.healthLabel(
      sloSnapshot.summary.breached,
      alertSummary.active,
      alertSummary.criticalCount,
    );

    const slo = {
      compliant: sloSnapshot.summary.compliant,
      total: sloSnapshot.summary.total,
      breached,
      overallHealthLabel,
    };

    // ── Capacity ──────────────────────────────────────────────────────────────
    const capacity = {
      requestsPerMinute: availSnap.capacityIndicators.requestsPerMinute,
      estimatedDailyRequests: availSnap.capacityIndicators.estimatedDailyRequests,
      dbQueryLoad: availSnap.capacityIndicators.dbQueryLoad,
      backupStorageIndicator: availSnap.capacityIndicators.backupStorageIndicator,
    };

    // ── Recommendations ───────────────────────────────────────────────────────
    const recommendations = this.buildRecommendations(
      requests,
      authentication,
      database,
      backup,
      alertSummary,
      sloSnapshot,
      availSnap,
    );

    return {
      generatedAt: now,
      reportPeriod: {
        startedAt: snap.process.startedAt,
        durationSeconds: elapsed,
        durationLabel: this.fmtDuration(elapsed),
      },
      uptime,
      requests,
      authentication,
      database,
      backup,
      alerts: alertSummary,
      slo,
      capacity,
      recommendations,
    };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private healthLabel(
    breachedCount: number,
    activeAlerts: number,
    criticalAlerts: number,
  ): OperationsReport["slo"]["overallHealthLabel"] {
    if (criticalAlerts > 0 || breachedCount >= 2) return "critical";
    if (activeAlerts > 2 || breachedCount >= 1) return "at_risk";
    if (activeAlerts > 0) return "good";
    return "excellent";
  }

  private buildRecommendations(
    requests: OperationsReport["requests"],
    auth: OperationsReport["authentication"],
    db: OperationsReport["database"],
    backup: OperationsReport["backup"],
    alerts: OperationsReport["alerts"],
    slo: SloSnapshot,
    avail: AvailabilitySnapshot,
  ): string[] {
    const recs: string[] = [];

    if (requests.errorRatePct > 1) {
      recs.push(
        `Error rate is ${requests.errorRatePct}% — investigate 5xx errors and review recent deployments.`,
      );
    }
    if (auth.failureRatePct > 10) {
      recs.push(
        `Auth failure rate is ${auth.failureRatePct}% — consider tightening rate limits or enabling MFA.`,
      );
    }
    if (db.failureRatePct > 0) {
      recs.push(
        `DB has ${db.queryFailures} query failures (${db.failureRatePct}%) — check connection pool health.`,
      );
    }
    if (db.avgQueryMs > 200) {
      recs.push(
        `Average DB query time is ${db.avgQueryMs}ms — consider adding indexes or query optimisation.`,
      );
    }
    if (backup.runs === 0) {
      recs.push("No backup runs recorded — configure the backup subsystem (DATABASE_URL required).");
    } else if (backup.failures > 0) {
      recs.push(
        `${backup.failures} backup failure(s) detected — investigate backup configuration and storage connectivity.`,
      );
    }
    if (avail.capacityIndicators.backupStorageIndicator === "none") {
      recs.push("Enable S3 replication by setting S3_BUCKET to protect against data loss.");
    }
    if (alerts.active > 0) {
      recs.push(
        `${alerts.active} active alert(s) require attention — visit the Alert Center.`,
      );
    }
    slo.slos
      .filter((s) => !s.compliant)
      .forEach((s) => {
        recs.push(`SLO breached: ${s.name} is at ${s.currentLabel} (target ${s.targetLabel}).`);
      });
    slo.slos
      .filter((s) => s.compliant && s.errorBudget.status === "at_risk")
      .forEach((s) => {
        recs.push(
          `SLO at risk: ${s.name} has consumed ${s.errorBudget.consumedPercent}% of its error budget.`,
        );
      });

    if (recs.length === 0) {
      recs.push("All systems healthy — no immediate actions required.");
    }

    return recs;
  }

  private fmtDuration(seconds: number): string {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const parts: string[] = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0) parts.push(`${h}h`);
    if (m > 0 || parts.length === 0) parts.push(`${m}m`);
    return parts.join(" ");
  }
}

export const operationalReportService = new OperationalReportService();
