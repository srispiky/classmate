/**
 * Unit tests for AvailabilityService — outage tracking and capacity indicators.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { AvailabilityService } from "../../lib/availability";

const BASE_SNAP = {
  requests: { total: 100, avgDurationMs: 30 },
  database: { queryCount: 50, avgQueryMs: 15 },
  backup: { runs: 0, failures: 0 },
};

describe("AvailabilityService — initial state", () => {
  it("returns 100% availability with no outages", () => {
    const svc = new AvailabilityService();
    const snap = svc.snapshot(60, BASE_SNAP);
    expect(snap.outageCount).toBe(0);
    expect(snap.database.availabilityPct).toBe(100);
    expect(snap.overall.status).toBe("healthy");
  });

  it("includes capacity indicators", () => {
    const svc = new AvailabilityService();
    const snap = svc.snapshot(60, BASE_SNAP);
    expect(snap.capacityIndicators).toHaveProperty("requestsPerMinute");
    expect(snap.capacityIndicators).toHaveProperty("estimatedDailyRequests");
    expect(snap.capacityIndicators).toHaveProperty("dbQueryLoad");
    expect(snap.capacityIndicators).toHaveProperty("backupStorageIndicator");
  });

  it("backupStorageIndicator is 'none' with no runs", () => {
    const svc = new AvailabilityService();
    const snap = svc.snapshot(60, BASE_SNAP);
    expect(snap.capacityIndicators.backupStorageIndicator).toBe("none");
  });
});

describe("AvailabilityService — outage tracking", () => {
  it("records an open outage when DB becomes unhealthy", () => {
    const svc = new AvailabilityService();
    svc.recordDbHealth(false);
    const snap = svc.snapshot(60, BASE_SNAP);
    // Active outage appears in the list even though it has no endedAt.
    expect(snap.outageCount).toBeGreaterThan(0);
    expect(snap.database.status).toBe("down");
  });

  it("closes the outage when DB recovers", () => {
    const svc = new AvailabilityService();
    svc.recordDbHealth(false);
    svc.recordDbHealth(true);
    const snap = svc.snapshot(120, BASE_SNAP);
    // DB status should be healthy after recovery.
    expect(snap.database.status).toBe("healthy");
    // The resolved outage is in history.
    const resolved = snap.outages.filter((o) => o.resolved);
    expect(resolved.length).toBeGreaterThanOrEqual(1);
  });

  it("does not duplicate open outages for the same service", () => {
    const svc = new AvailabilityService();
    svc.recordDbHealth(false);
    svc.recordDbHealth(false); // called again — should not create a second outage
    const snap = svc.snapshot(60, BASE_SNAP);
    const activeOutages = snap.outages.filter((o) => !o.resolved);
    expect(activeOutages.length).toBe(1);
  });

  it("accumulates downtime across multiple resolved outages", () => {
    const svc = new AvailabilityService();
    svc.recordDbHealth(false);
    svc.recordDbHealth(true);
    svc.recordDbHealth(false);
    svc.recordDbHealth(true);
    const snap = svc.snapshot(120, BASE_SNAP);
    // Two outages resolved — both appear in history.
    const resolved = snap.outages.filter((o) => o.resolved);
    expect(resolved.length).toBe(2);
    // uptimeSeconds is non-negative and does not exceed session elapsed.
    expect(snap.database.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(snap.database.downtimeSeconds).toBeGreaterThanOrEqual(0);
    expect(snap.database.uptimeSeconds + snap.database.downtimeSeconds).toBeCloseTo(120, -1);
  });
});

describe("AvailabilityService — capacity indicators", () => {
  it("calculates requestsPerMinute from request total and uptime", () => {
    const svc = new AvailabilityService();
    // 120 requests over 120 seconds = 2 minutes → 60 req/min
    const snap = svc.snapshot(120, { ...BASE_SNAP, requests: { total: 120, avgDurationMs: 20 } });
    expect(snap.capacityIndicators.requestsPerMinute).toBe(60);
  });

  it("marks backupStorageIndicator as 'active' when runs > 0 and no failures", () => {
    const svc = new AvailabilityService();
    const snap = svc.snapshot(60, {
      ...BASE_SNAP,
      backup: { runs: 3, failures: 0 },
    });
    expect(snap.capacityIndicators.backupStorageIndicator).toBe("active");
  });

  it("marks backupStorageIndicator as 'failing' when failures > 0", () => {
    const svc = new AvailabilityService();
    const snap = svc.snapshot(60, {
      ...BASE_SNAP,
      backup: { runs: 3, failures: 1 },
    });
    expect(snap.capacityIndicators.backupStorageIndicator).toBe("failing");
  });

  it("dbQueryLoad is 'high' when avgQueryMs > 200", () => {
    const svc = new AvailabilityService();
    const snap = svc.snapshot(60, {
      ...BASE_SNAP,
      database: { queryCount: 10, avgQueryMs: 300 },
    });
    expect(snap.capacityIndicators.dbQueryLoad).toBe("high");
  });

  it("dbQueryLoad is 'low' when avgQueryMs <= 50", () => {
    const svc = new AvailabilityService();
    const snap = svc.snapshot(60, {
      ...BASE_SNAP,
      database: { queryCount: 10, avgQueryMs: 10 },
    });
    expect(snap.capacityIndicators.dbQueryLoad).toBe("low");
  });
});
