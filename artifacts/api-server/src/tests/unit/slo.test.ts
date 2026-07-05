/**
 * Unit tests for SLOService — compliance calculations and error budget math.
 */

import { describe, it, expect } from "vitest";
import { SLOService, SLO_DEFINITIONS, SLO_WINDOW_SECONDS } from "../../lib/slo";
import type { MetricsSnapshot } from "../../lib/metrics";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSnap(overrides: Partial<{
  total: number;
  errors: number;
  loginAttempts: number;
  loginFailures: number;
  rateLimitHits: number;
  backupRuns: number;
  backupFailures: number;
  uptimeSeconds: number;
}> = {}): MetricsSnapshot {
  return {
    requests: {
      total: overrides.total ?? 0,
      errors: overrides.errors ?? 0,
      byStatus: {},
      avgDurationMs: 0,
    },
    auth: {
      loginAttempts: overrides.loginAttempts ?? 0,
      loginFailures: overrides.loginFailures ?? 0,
      rateLimitHits: overrides.rateLimitHits ?? 0,
    },
    database: { queryCount: 0, queryFailures: 0, avgQueryMs: 0 },
    backup: {
      runs: overrides.backupRuns ?? 0,
      failures: overrides.backupFailures ?? 0,
      lastRunAt: null,
    },
    process: {
      startedAt: new Date().toISOString(),
      uptimeSeconds: overrides.uptimeSeconds ?? 60,
    },
    latency: { p50: 0, p95: 0, p99: 0, sampleSize: 0 },
    slowestEndpoints: [],
  };
}

const svc = new SLOService();

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("SLOService — snapshot structure", () => {
  it("returns 5 SLO results", () => {
    const snap = svc.evaluate(makeSnap(), true, true);
    expect(snap.slos).toHaveLength(5);
  });

  it("includes evaluatedAt, windowSeconds, elapsedSeconds, and summary", () => {
    const snap = svc.evaluate(makeSnap(), true, true);
    expect(snap.evaluatedAt).toBeTruthy();
    expect(snap.windowSeconds).toBeGreaterThan(0);
    expect(snap.elapsedSeconds).toBeGreaterThan(0);
    expect(snap.summary.total).toBe(5);
  });

  it("caps windowSeconds at SLO_WINDOW_SECONDS", () => {
    const snap = svc.evaluate(makeSnap({ uptimeSeconds: SLO_WINDOW_SECONDS * 2 }), true, true);
    expect(snap.windowSeconds).toBeLessThanOrEqual(SLO_WINDOW_SECONDS);
  });
});

describe("SLOService — api_availability", () => {
  it("is compliant with no requests (assumes healthy)", () => {
    const snap = svc.evaluate(makeSnap({ total: 0 }), true, true);
    const slo = snap.slos.find((s) => s.id === "api_availability")!;
    expect(slo.compliant).toBe(true);
    expect(slo.current).toBe(1.0);
  });

  it("is compliant when error rate is below 0.1%", () => {
    const snap = svc.evaluate(makeSnap({ total: 10000, errors: 5 }), true, true);
    const slo = snap.slos.find((s) => s.id === "api_availability")!;
    expect(slo.compliant).toBe(true);
    expect(slo.current).toBeGreaterThanOrEqual(SLO_DEFINITIONS.api_availability.target);
  });

  it("is breached when error rate exceeds 0.1%", () => {
    const snap = svc.evaluate(makeSnap({ total: 1000, errors: 5 }), true, true);
    const slo = snap.slos.find((s) => s.id === "api_availability")!;
    expect(slo.compliant).toBe(false);
    expect(slo.current).toBeLessThan(SLO_DEFINITIONS.api_availability.target);
  });
});

describe("SLOService — auth_availability", () => {
  it("is compliant with no login attempts", () => {
    const snap = svc.evaluate(makeSnap(), true, true);
    const slo = snap.slos.find((s) => s.id === "auth_availability")!;
    expect(slo.compliant).toBe(true);
  });

  it("is breached when rate-limit hit rate exceeds 0.1%", () => {
    const snap = svc.evaluate(makeSnap({ loginAttempts: 100, rateLimitHits: 5 }), true, true);
    const slo = snap.slos.find((s) => s.id === "auth_availability")!;
    expect(slo.compliant).toBe(false);
  });

  it("is compliant when rate-limit rate is below 0.1%", () => {
    const snap = svc.evaluate(makeSnap({ loginAttempts: 10000, rateLimitHits: 1 }), true, true);
    const slo = snap.slos.find((s) => s.id === "auth_availability")!;
    expect(slo.compliant).toBe(true);
  });
});

describe("SLOService — backup_success_rate", () => {
  it("is compliant with no backup runs", () => {
    const snap = svc.evaluate(makeSnap({ backupRuns: 0 }), true, true);
    const slo = snap.slos.find((s) => s.id === "backup_success_rate")!;
    expect(slo.compliant).toBe(true);
  });

  it("is compliant when all backup runs succeed", () => {
    const snap = svc.evaluate(makeSnap({ backupRuns: 5, backupFailures: 0 }), true, true);
    const slo = snap.slos.find((s) => s.id === "backup_success_rate")!;
    expect(slo.compliant).toBe(true);
    expect(slo.current).toBe(1.0);
  });

  it("is breached when any backup fails", () => {
    const snap = svc.evaluate(makeSnap({ backupRuns: 5, backupFailures: 1 }), true, true);
    const slo = snap.slos.find((s) => s.id === "backup_success_rate")!;
    expect(slo.compliant).toBe(false);
  });
});

describe("SLOService — replication_success_rate", () => {
  it("is non-compliant when replication is not configured", () => {
    const snap = svc.evaluate(makeSnap(), true, false);
    const slo = snap.slos.find((s) => s.id === "replication_success_rate")!;
    expect(slo.compliant).toBe(false);
    expect(slo.current).toBe(0);
  });

  it("is compliant when replication is configured", () => {
    const snap = svc.evaluate(makeSnap(), true, true);
    const slo = snap.slos.find((s) => s.id === "replication_success_rate")!;
    expect(slo.compliant).toBe(true);
  });
});

describe("SLOService — health_endpoint_availability", () => {
  it("is compliant when DB is healthy", () => {
    const snap = svc.evaluate(makeSnap(), true, true);
    const slo = snap.slos.find((s) => s.id === "health_endpoint_availability")!;
    expect(slo.compliant).toBe(true);
    expect(slo.current).toBe(1.0);
  });

  it("falls below 99.99% target when DB is down", () => {
    const snap = svc.evaluate(makeSnap(), false, true);
    const slo = snap.slos.find((s) => s.id === "health_endpoint_availability")!;
    expect(slo.compliant).toBe(false);
  });
});

describe("SLOService — error budget", () => {
  it("has a positive total budget", () => {
    const snap = svc.evaluate(makeSnap(), true, true);
    snap.slos.forEach((slo) => {
      if (slo.target < 1) {
        expect(slo.errorBudget.totalSeconds).toBeGreaterThan(0);
      }
    });
  });

  it("has healthy budget status when fully compliant", () => {
    const snap = svc.evaluate(makeSnap({ total: 100, errors: 0 }), true, true);
    const slo = snap.slos.find((s) => s.id === "api_availability")!;
    expect(slo.errorBudget.status).toBe("healthy");
    expect(slo.errorBudget.consumedPercent).toBe(0);
  });

  it("has exhausted budget status when SLO is badly breached over a long window", () => {
    // Use a long uptime so 100% errors consume far more than the 30-day budget (2592s).
    // With uptimeSeconds = SLO_WINDOW_SECONDS and 100% errors:
    //   consumed = 1.0 * window = window >> budget (2592s) => 100%+ consumed.
    const snap = svc.evaluate(
      makeSnap({ total: 1000, errors: 1000, uptimeSeconds: SLO_WINDOW_SECONDS }),
      true,
      true,
    );
    const slo = snap.slos.find((s) => s.id === "api_availability")!;
    expect(slo.errorBudget.status).toBe("exhausted");
  });

  it("summary.compliant matches the count of compliant SLOs", () => {
    const snap = svc.evaluate(makeSnap(), true, true);
    const manualCount = snap.slos.filter((s) => s.compliant).length;
    expect(snap.summary.compliant).toBe(manualCount);
  });

  it("summary.breached matches the count of non-compliant SLOs", () => {
    const snap = svc.evaluate(makeSnap(), true, true);
    const manualCount = snap.slos.filter((s) => !s.compliant).length;
    expect(snap.summary.breached).toBe(manualCount);
  });
});
