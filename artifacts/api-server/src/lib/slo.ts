/**
 * SLOService — in-memory SLO compliance and error budget tracking.
 *
 * SLOs are evaluated against metrics accumulated since the last server restart.
 * Error budgets are computed relative to a rolling 30-day window; when the
 * session is shorter than 30 days the elapsed time is used instead.
 *
 * All numbers are current-session approximations — for true SLO tracking
 * integrate a time-series DB such as Prometheus + Grafana.
 */

import type { MetricsSnapshot } from "./metrics";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Reporting window in seconds (30 days). */
export const SLO_WINDOW_SECONDS = 30 * 24 * 60 * 60;

/** SLO definitions — targets as decimals (0.999 = 99.9%). */
export const SLO_DEFINITIONS = {
  api_availability: {
    id: "api_availability",
    name: "API Availability",
    description: "Percentage of requests that succeed (non-5xx) over the reporting window.",
    target: 0.999,
    targetLabel: "99.9%",
    unit: "percent",
  },
  auth_availability: {
    id: "auth_availability",
    name: "Authentication Availability",
    description: "Percentage of login attempts that do not hit a rate-limit wall.",
    target: 0.999,
    targetLabel: "99.9%",
    unit: "percent",
  },
  backup_success_rate: {
    id: "backup_success_rate",
    name: "Backup Success Rate",
    description: "Percentage of backup runs that complete without error.",
    target: 1.0,
    targetLabel: "100%",
    unit: "percent",
  },
  replication_success_rate: {
    id: "replication_success_rate",
    name: "Replication Success Rate",
    description: "S3 replication availability as a fraction of server uptime.",
    target: 1.0,
    targetLabel: "100%",
    unit: "percent",
  },
  health_endpoint_availability: {
    id: "health_endpoint_availability",
    name: "Health Endpoint Availability",
    description: "Uptime of the server process — health endpoint is available whenever the process is running.",
    target: 0.9999,
    targetLabel: "99.99%",
    unit: "percent",
  },
} as const;

export type SloId = keyof typeof SLO_DEFINITIONS;

// ── Result types ──────────────────────────────────────────────────────────────

export interface SloResult {
  id: string;
  name: string;
  description: string;
  target: number;
  targetLabel: string;
  current: number;
  currentLabel: string;
  compliant: boolean;
  errorBudget: {
    totalSeconds: number;
    consumedSeconds: number;
    remainingSeconds: number;
    consumedPercent: number;
    burnRate: number;
    status: "healthy" | "at_risk" | "exhausted";
  };
  sampleBasis: string;
}

export interface SloSnapshot {
  evaluatedAt: string;
  windowSeconds: number;
  elapsedSeconds: number;
  slos: SloResult[];
  summary: {
    total: number;
    compliant: number;
    atRisk: number;
    breached: number;
  };
}

// ── SLOService ────────────────────────────────────────────────────────────────

export class SLOService {
  /**
   * Evaluate all SLOs against the provided metrics snapshot.
   * `dbOk` reflects whether the DB health check passed.
   * `replicationConfigured` reflects whether S3_BUCKET is set.
   */
  evaluate(
    snap: MetricsSnapshot,
    dbOk: boolean,
    replicationConfigured: boolean,
  ): SloSnapshot {
    const now = new Date().toISOString();
    const elapsedSeconds = Math.max(snap.process.uptimeSeconds, 1);
    const windowSeconds = Math.min(elapsedSeconds, SLO_WINDOW_SECONDS);

    const slos: SloResult[] = [
      this.apiAvailability(snap, elapsedSeconds),
      this.authAvailability(snap, elapsedSeconds),
      this.backupSuccessRate(snap, elapsedSeconds),
      this.replicationSuccessRate(snap, elapsedSeconds, replicationConfigured),
      this.healthEndpointAvailability(snap, elapsedSeconds, dbOk),
    ];

    const compliant = slos.filter((s) => s.compliant).length;
    const atRisk = slos.filter(
      (s) => !s.compliant || s.errorBudget.status === "at_risk",
    ).length;
    const breached = slos.filter((s) => !s.compliant).length;

    return {
      evaluatedAt: now,
      windowSeconds,
      elapsedSeconds,
      slos,
      summary: {
        total: slos.length,
        compliant,
        atRisk,
        breached,
      },
    };
  }

  // ── Individual SLO evaluators ─────────────────────────────────────────────

  private apiAvailability(snap: MetricsSnapshot, elapsedSec: number): SloResult {
    const def = SLO_DEFINITIONS.api_availability;
    const { total, errors } = snap.requests;

    let current: number;
    let sampleBasis: string;

    if (total === 0) {
      // No traffic yet — assume target met.
      current = 1.0;
      sampleBasis = "No requests recorded; assuming compliant.";
    } else {
      current = (total - errors) / total;
      sampleBasis = `${total - errors}/${total} requests succeeded (${errors} 5xx errors).`;
    }

    return this.buildResult(def, current, elapsedSec, sampleBasis);
  }

  private authAvailability(snap: MetricsSnapshot, elapsedSec: number): SloResult {
    const def = SLO_DEFINITIONS.auth_availability;
    const { loginAttempts, rateLimitHits } = snap.auth;

    let current: number;
    let sampleBasis: string;

    if (loginAttempts === 0) {
      current = 1.0;
      sampleBasis = "No login attempts recorded; assuming compliant.";
    } else {
      current = Math.max(0, (loginAttempts - rateLimitHits) / loginAttempts);
      sampleBasis = `${loginAttempts - rateLimitHits}/${loginAttempts} auth requests not rate-limited.`;
    }

    return this.buildResult(def, current, elapsedSec, sampleBasis);
  }

  private backupSuccessRate(snap: MetricsSnapshot, elapsedSec: number): SloResult {
    const def = SLO_DEFINITIONS.backup_success_rate;
    const { runs, failures } = snap.backup;

    let current: number;
    let sampleBasis: string;

    if (runs === 0) {
      // Treat as compliant when backup is not yet configured/run.
      current = 1.0;
      sampleBasis = "No backup runs recorded this session.";
    } else {
      current = (runs - failures) / runs;
      sampleBasis = `${runs - failures}/${runs} backup runs succeeded.`;
    }

    return this.buildResult(def, current, elapsedSec, sampleBasis);
  }

  private replicationSuccessRate(
    snap: MetricsSnapshot,
    elapsedSec: number,
    configured: boolean,
  ): SloResult {
    const def = SLO_DEFINITIONS.replication_success_rate;

    // Replication is either active (configured, uptime-based) or not configured.
    // When not configured: treat as N/A but mark as non-compliant with budget = 0.
    const current = configured ? 1.0 : 0.0;
    const sampleBasis = configured
      ? "S3 replication active for the current session."
      : "S3_BUCKET not configured — replication is inactive.";

    return this.buildResult(def, current, elapsedSec, sampleBasis);
  }

  private healthEndpointAvailability(
    snap: MetricsSnapshot,
    elapsedSec: number,
    dbOk: boolean,
  ): SloResult {
    const def = SLO_DEFINITIONS.health_endpoint_availability;

    // Health endpoint is available whenever the server process is running.
    // We approximate unavailability as time when DB is down (degraded state).
    // Since we don't track DB downtime duration directly, we use availability
    // proxy: server uptime / window. If DB is currently down, flag at-risk.
    const current = dbOk ? 1.0 : 0.995; // Slight degradation when DB is down
    const sampleBasis = dbOk
      ? `Server up for ${this.fmtUptime(elapsedSec)}. Health endpoint available.`
      : `DB currently unavailable — health endpoint returning degraded status.`;

    return this.buildResult(def, current, elapsedSec, sampleBasis);
  }

  // ── Shared error budget builder ───────────────────────────────────────────

  private buildResult(
    def: (typeof SLO_DEFINITIONS)[SloId],
    current: number,
    elapsedSec: number,
    sampleBasis: string,
  ): SloResult {
    const windowSec = Math.min(elapsedSec, SLO_WINDOW_SECONDS);

    // Total allowable downtime in the window.
    const totalBudgetSec = (1 - def.target) * SLO_WINDOW_SECONDS;

    // Consumed: how much of the window was unavailable.
    const errorFraction = Math.max(0, 1 - current);
    const consumedSec = errorFraction * windowSec;
    const remainingSec = Math.max(0, totalBudgetSec - consumedSec);
    const consumedPct = totalBudgetSec > 0 ? (consumedSec / totalBudgetSec) * 100 : 0;

    // Burn rate = actual error rate / (1 - target). 1 = burning at exactly SLO rate.
    const burnRate =
      def.target < 1
        ? errorFraction / (1 - def.target)
        : errorFraction === 0
          ? 0
          : Infinity;

    const budgetStatus: SloResult["errorBudget"]["status"] =
      consumedPct >= 100 ? "exhausted" : consumedPct >= 50 ? "at_risk" : "healthy";

    return {
      id: def.id,
      name: def.name,
      description: def.description,
      target: def.target,
      targetLabel: def.targetLabel,
      current: parseFloat(current.toFixed(6)),
      currentLabel: `${(current * 100).toFixed(3)}%`,
      compliant: current >= def.target,
      errorBudget: {
        totalSeconds: Math.round(totalBudgetSec),
        consumedSeconds: Math.round(consumedSec),
        remainingSeconds: Math.round(remainingSec),
        consumedPercent: parseFloat(consumedPct.toFixed(2)),
        burnRate: parseFloat(Math.min(burnRate, 9999).toFixed(2)),
        status: budgetStatus,
      },
      sampleBasis,
    };
  }

  private fmtUptime(seconds: number): string {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }
}

export const sloService = new SLOService();
