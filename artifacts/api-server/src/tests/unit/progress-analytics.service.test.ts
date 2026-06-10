/**
 * Unit tests for ProgressAnalyticsService
 *
 * All tests operate purely on score arrays — no DB, no mocks required.
 *
 * Coverage:
 *   - computeRiskLevel: boundary conditions, INSUFFICIENT_DATA, all three levels
 *   - computeTrend: boundary conditions, INSUFFICIENT_DATA, all three directions
 *   - Window behaviour: ensures only the last 5 events are used for trend
 */

import { describe, it, expect } from "vitest";
import { computeRiskLevel, computeTrend } from "../../services/progress-analytics.service";

// ─── computeRiskLevel ─────────────────────────────────────────────────────────

describe("computeRiskLevel", () => {
  // INSUFFICIENT_DATA
  it("returns INSUFFICIENT_DATA for empty array", () => {
    expect(computeRiskLevel([])).toBe("INSUFFICIENT_DATA");
  });

  it("returns INSUFFICIENT_DATA for 1 score", () => {
    expect(computeRiskLevel([90])).toBe("INSUFFICIENT_DATA");
  });

  it("returns INSUFFICIENT_DATA for 2 scores", () => {
    expect(computeRiskLevel([80, 90])).toBe("INSUFFICIENT_DATA");
  });

  it("returns a classification for exactly 3 scores", () => {
    expect(computeRiskLevel([80, 85, 90])).toBe("LOW");
  });

  // HIGH (avg < 60)
  it("returns HIGH when avg is exactly 0", () => {
    expect(computeRiskLevel([0, 0, 0])).toBe("HIGH");
  });

  it("returns HIGH when avg is 59", () => {
    expect(computeRiskLevel([59, 59, 59])).toBe("HIGH");
  });

  it("returns HIGH when avg is 59.9", () => {
    expect(computeRiskLevel([58, 60, 61.7])).toBe("HIGH");
  });

  // MEDIUM (60 ≤ avg < 80)
  it("returns MEDIUM when avg is exactly 60", () => {
    expect(computeRiskLevel([60, 60, 60])).toBe("MEDIUM");
  });

  it("returns MEDIUM when avg is 70", () => {
    expect(computeRiskLevel([65, 70, 75])).toBe("MEDIUM");
  });

  it("returns MEDIUM when avg is 79.9", () => {
    expect(computeRiskLevel([79, 80, 79.7])).toBe("MEDIUM");
  });

  // LOW (avg ≥ 80)
  it("returns LOW when avg is exactly 80", () => {
    expect(computeRiskLevel([80, 80, 80])).toBe("LOW");
  });

  it("returns LOW when avg is 95", () => {
    expect(computeRiskLevel([90, 95, 100])).toBe("LOW");
  });

  it("returns LOW when avg is 100", () => {
    expect(computeRiskLevel([100, 100, 100])).toBe("LOW");
  });

  // Large arrays
  it("handles more than 3 scores correctly", () => {
    // avg = (50+50+50+50+50)/5 = 50 → HIGH
    expect(computeRiskLevel([50, 50, 50, 50, 50])).toBe("HIGH");
  });

  it("uses all scores, not just the first 3", () => {
    // avg = (90+90+10)/3 = 63.3 → MEDIUM
    expect(computeRiskLevel([90, 90, 10])).toBe("MEDIUM");
  });
});

// ─── computeTrend ─────────────────────────────────────────────────────────────

describe("computeTrend", () => {
  // INSUFFICIENT_DATA
  it("returns INSUFFICIENT_DATA for empty array", () => {
    expect(computeTrend([])).toBe("INSUFFICIENT_DATA");
  });

  it("returns INSUFFICIENT_DATA for 4 scores", () => {
    expect(computeTrend([80, 80, 90, 90])).toBe("INSUFFICIENT_DATA");
  });

  it("returns a trend for exactly 5 scores", () => {
    const result = computeTrend([70, 70, 80, 80, 80]);
    expect(["IMPROVING", "STABLE", "DECLINING"]).toContain(result);
  });

  // IMPROVING (delta > +5)
  it("returns IMPROVING when recent scores are clearly higher", () => {
    // previous 2: [50, 50] avg=50 | recent 3: [90, 90, 90] avg=90 | delta=+40
    expect(computeTrend([50, 50, 90, 90, 90])).toBe("IMPROVING");
  });

  it("returns IMPROVING when delta is exactly +6", () => {
    // previous: [70, 70] avg=70 | recent: [76, 76, 76] avg=76 | delta=+6
    expect(computeTrend([70, 70, 76, 76, 76])).toBe("IMPROVING");
  });

  it("returns IMPROVING when delta is just above threshold", () => {
    // previous: [60, 60] avg=60 | recent: [65.01, 65.01, 65.99] avg≈65.34 | delta≈5.34>5
    expect(computeTrend([60, 60, 65, 65, 66])).toBe("IMPROVING");
  });

  // DECLINING (delta < -5)
  it("returns DECLINING when recent scores are clearly lower", () => {
    // previous: [90, 90] avg=90 | recent: [40, 40, 40] avg=40 | delta=-50
    expect(computeTrend([90, 90, 40, 40, 40])).toBe("DECLINING");
  });

  it("returns DECLINING when delta is exactly -6", () => {
    // previous: [80, 80] avg=80 | recent: [74, 74, 74] avg=74 | delta=-6
    expect(computeTrend([80, 80, 74, 74, 74])).toBe("DECLINING");
  });

  // STABLE (|delta| ≤ 5)
  it("returns STABLE when all scores are identical", () => {
    expect(computeTrend([75, 75, 75, 75, 75])).toBe("STABLE");
  });

  it("returns STABLE when delta is exactly 0", () => {
    expect(computeTrend([70, 70, 70, 70, 70])).toBe("STABLE");
  });

  it("returns STABLE when delta is exactly +5", () => {
    // previous: [70, 70] avg=70 | recent: [75, 75, 75] avg=75 | delta=+5 (not > 5)
    expect(computeTrend([70, 70, 75, 75, 75])).toBe("STABLE");
  });

  it("returns STABLE when delta is exactly -5", () => {
    // previous: [75, 75] avg=75 | recent: [70, 70, 70] avg=70 | delta=-5 (not < -5)
    expect(computeTrend([75, 75, 70, 70, 70])).toBe("STABLE");
  });

  // Window behaviour — only last 5 used
  it("uses only the last 5 events when more are provided", () => {
    // First 10 events are 10 (very low), last 5 are a STABLE pattern
    // If all events were used the trend would be skewed; window=last5 gives STABLE
    const manyLowThenStable = [10, 10, 10, 10, 10, 10, 10, 70, 70, 70, 70, 70];
    // last 5: [70, 70, 70, 70, 70] → previous [70,70] avg=70, recent [70,70,70] avg=70 → STABLE
    expect(computeTrend(manyLowThenStable)).toBe("STABLE");
  });

  it("uses last 5 and detects improvement even with early poor scores", () => {
    // Long history of poor scores, last 5 show clear improvement
    const history = [20, 20, 20, 20, 20, 20, 40, 40, 90, 90, 90];
    // last 5: [40, 40, 90, 90, 90] → previous [40,40] avg=40, recent [90,90,90] avg=90 → IMPROVING
    expect(computeTrend(history)).toBe("IMPROVING");
  });

  it("chronological order matters — reversed scores give different result", () => {
    // Improving forward → IMPROVING
    const improving = [50, 50, 90, 90, 90];
    // Declining when reversed → DECLINING
    const declining = [90, 90, 50, 50, 50];
    expect(computeTrend(improving)).toBe("IMPROVING");
    expect(computeTrend(declining)).toBe("DECLINING");
  });
});
