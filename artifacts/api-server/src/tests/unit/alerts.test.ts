/**
 * Unit tests for AlertService — lifecycle and evaluation logic.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { AlertService, ALERT_THRESHOLDS } from "../../lib/alerts";
import type { MetricsSnapshot } from "../../lib/metrics";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSnapshot(overrides: Partial<{
  authFailures: number;
  rateLimitHits: number;
  dbQueryFailures: number;
  backupRuns: number;
  backupFailures: number;
  requestCount: number;
  errorCount: number;
  p95Ms: number;
  p99Ms: number;
  slowEndpoints: MetricsSnapshot["slowestEndpoints"];
}> = {}): MetricsSnapshot {
  return {
    requests: {
      total: overrides.requestCount ?? 0,
      errors: overrides.errorCount ?? 0,
      byStatus: {},
      avgDurationMs: 0,
    },
    auth: {
      loginAttempts: 0,
      loginFailures: overrides.authFailures ?? 0,
      rateLimitHits: overrides.rateLimitHits ?? 0,
    },
    database: {
      queryCount: 0,
      queryFailures: overrides.dbQueryFailures ?? 0,
      avgQueryMs: 0,
    },
    backup: {
      runs: overrides.backupRuns ?? 0,
      failures: overrides.backupFailures ?? 0,
      lastRunAt: null,
    },
    process: {
      startedAt: new Date().toISOString(),
      uptimeSeconds: 60,
    },
    latency: {
      p50: 0,
      p95: overrides.p95Ms ?? 0,
      p99: overrides.p99Ms ?? 0,
      sampleSize: overrides.p95Ms !== undefined || overrides.p99Ms !== undefined ? 25 : 10,
    },
    slowestEndpoints: overrides.slowEndpoints ?? [],
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("AlertService — lifecycle", () => {
  let svc: AlertService;

  beforeEach(() => {
    svc = new AlertService();
  });

  it("starts with no alerts", () => {
    expect(svc.list()).toHaveLength(0);
    expect(svc.counts()).toEqual({ active: 0, acknowledged: 0, resolved: 0 });
  });

  it("fires an alert when auth failure threshold is exceeded", () => {
    svc.evaluate(makeSnapshot({ authFailures: ALERT_THRESHOLDS.AUTH_LOGIN_FAILURES + 1 }), true);
    const alerts = svc.list("active");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.type).toBe("auth.excessive_login_failures");
    expect(alerts[0]?.severity).toBe("high");
  });

  it("deduplicates: does not create a second active alert for the same type", () => {
    svc.evaluate(makeSnapshot({ authFailures: ALERT_THRESHOLDS.AUTH_LOGIN_FAILURES + 1 }), true);
    svc.evaluate(makeSnapshot({ authFailures: ALERT_THRESHOLDS.AUTH_LOGIN_FAILURES + 2 }), true);
    expect(
      svc.list("active").filter((a) => a.type === "auth.excessive_login_failures"),
    ).toHaveLength(1);
  });

  it("auto-resolves an alert when the condition clears", () => {
    svc.evaluate(makeSnapshot({ authFailures: ALERT_THRESHOLDS.AUTH_LOGIN_FAILURES + 1 }), true);
    expect(svc.list("active")).toHaveLength(1);

    svc.evaluate(makeSnapshot({ authFailures: 0 }), true);
    expect(svc.list("active")).toHaveLength(0);
    const resolved = svc.list("resolved");
    expect(resolved[0]?.type).toBe("auth.excessive_login_failures");
    expect(resolved[0]?.resolvedAt).not.toBeNull();
  });

  it("acknowledge transitions status from active → acknowledged", () => {
    svc.evaluate(makeSnapshot({ authFailures: ALERT_THRESHOLDS.AUTH_LOGIN_FAILURES + 1 }), true);
    const alert = svc.list("active")[0]!;
    const ack = svc.acknowledge(alert.id);
    expect(ack?.status).toBe("acknowledged");
    expect(ack?.acknowledgedAt).not.toBeNull();
    expect(svc.list("active")).toHaveLength(0);
    expect(svc.list("acknowledged")).toHaveLength(1);
  });

  it("resolve transitions status from active → resolved", () => {
    svc.evaluate(makeSnapshot({ authFailures: ALERT_THRESHOLDS.AUTH_LOGIN_FAILURES + 1 }), true);
    const alert = svc.list("active")[0]!;
    const resolved = svc.resolve(alert.id);
    expect(resolved?.status).toBe("resolved");
    expect(resolved?.resolvedAt).not.toBeNull();
  });

  it("resolve transitions status from acknowledged → resolved", () => {
    svc.evaluate(makeSnapshot({ authFailures: ALERT_THRESHOLDS.AUTH_LOGIN_FAILURES + 1 }), true);
    const alert = svc.list("active")[0]!;
    svc.acknowledge(alert.id);
    const resolved = svc.resolve(alert.id);
    expect(resolved?.status).toBe("resolved");
  });

  it("acknowledge returns null for a non-existent id", () => {
    expect(svc.acknowledge("no-such-id")).toBeNull();
  });

  it("resolve returns null for a non-existent id", () => {
    expect(svc.resolve("no-such-id")).toBeNull();
  });

  it("get returns alert by id", () => {
    svc.evaluate(makeSnapshot({ authFailures: ALERT_THRESHOLDS.AUTH_LOGIN_FAILURES + 1 }), true);
    const alert = svc.list()[0]!;
    expect(svc.get(alert.id)).toEqual(alert);
  });

  it("get returns undefined for unknown id", () => {
    expect(svc.get("does-not-exist")).toBeUndefined();
  });

  it("counts returns correct tallies", () => {
    svc.evaluate(makeSnapshot({ authFailures: ALERT_THRESHOLDS.AUTH_LOGIN_FAILURES + 1 }), true);
    svc.evaluate(makeSnapshot({ authFailures: ALERT_THRESHOLDS.AUTH_LOGIN_FAILURES + 1, rateLimitHits: ALERT_THRESHOLDS.AUTH_RATE_LIMIT_HITS + 1 }), true);
    const firstAlert = svc.list("active")[0]!;
    svc.acknowledge(firstAlert.id);
    const counts = svc.counts();
    expect(counts.active).toBeGreaterThanOrEqual(1);
    expect(counts.acknowledged).toBe(1);
  });
});

describe("AlertService — evaluation rules", () => {
  let svc: AlertService;

  beforeEach(() => {
    svc = new AlertService();
  });

  it("fires db.unavailable when DB is down", () => {
    svc.evaluate(makeSnapshot(), false);
    const a = svc.list("active").find((x) => x.type === "db.unavailable");
    expect(a).toBeDefined();
    expect(a?.severity).toBe("critical");
  });

  it("does not fire db.unavailable when DB is healthy", () => {
    svc.evaluate(makeSnapshot(), true);
    expect(svc.list("active").find((x) => x.type === "db.unavailable")).toBeUndefined();
  });

  it("fires db.repeated_query_failures above threshold", () => {
    svc.evaluate(makeSnapshot({ dbQueryFailures: ALERT_THRESHOLDS.DB_QUERY_FAILURES + 1 }), true);
    expect(svc.list("active").find((x) => x.type === "db.repeated_query_failures")).toBeDefined();
  });

  it("fires auth.rate_limit_violations above threshold", () => {
    svc.evaluate(makeSnapshot({ rateLimitHits: ALERT_THRESHOLDS.AUTH_RATE_LIMIT_HITS + 1 }), true);
    expect(svc.list("active").find((x) => x.type === "auth.rate_limit_violations")).toBeDefined();
  });

  it("fires backup.failure when backup runs have failures", () => {
    svc.evaluate(makeSnapshot({ backupRuns: 3, backupFailures: 2 }), true);
    expect(svc.list("active").find((x) => x.type === "backup.failure")).toBeDefined();
  });

  it("does not fire backup.failure when backupRuns is 0", () => {
    svc.evaluate(makeSnapshot({ backupRuns: 0, backupFailures: 0 }), true);
    expect(svc.list("active").find((x) => x.type === "backup.failure")).toBeUndefined();
  });

  it("fires app.elevated_error_rate above threshold with min requests", () => {
    const total = ALERT_THRESHOLDS.MIN_REQUESTS_FOR_RATE + 10;
    const errors = Math.ceil(((ALERT_THRESHOLDS.ERROR_RATE_PERCENT + 1) / 100) * total);
    svc.evaluate(makeSnapshot({ requestCount: total, errorCount: errors }), true);
    expect(svc.list("active").find((x) => x.type === "app.elevated_error_rate")).toBeDefined();
  });

  it("does not fire app.elevated_error_rate below min requests", () => {
    svc.evaluate(makeSnapshot({ requestCount: 10, errorCount: 5 }), true);
    expect(svc.list("active").find((x) => x.type === "app.elevated_error_rate")).toBeUndefined();
  });

  it("fires perf.high_p95_latency above threshold", () => {
    svc.evaluate(makeSnapshot({ p95Ms: ALERT_THRESHOLDS.P95_LATENCY_MS + 1 }), true);
    expect(svc.list("active").find((x) => x.type === "perf.high_p95_latency")).toBeDefined();
  });

  it("fires perf.high_p99_latency above threshold", () => {
    svc.evaluate(makeSnapshot({ p99Ms: ALERT_THRESHOLDS.P99_LATENCY_MS + 1 }), true);
    expect(svc.list("active").find((x) => x.type === "perf.high_p99_latency")).toBeDefined();
  });

  it("fires perf.slow_endpoint when an endpoint p95 exceeds threshold", () => {
    svc.evaluate(
      makeSnapshot({
        slowEndpoints: [
          {
            path: "GET /api/slow",
            p95: ALERT_THRESHOLDS.SLOW_ENDPOINT_P95_MS + 1,
            p99: 2000,
            count: 10,
          },
        ],
      }),
      true,
    );
    expect(svc.list("active").find((x) => x.type === "perf.slow_endpoint")).toBeDefined();
  });
});
