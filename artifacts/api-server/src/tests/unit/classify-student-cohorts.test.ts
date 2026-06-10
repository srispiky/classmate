/**
 * Unit tests for classifyStudentCohorts()
 *
 * All tests are pure (no DB, no mocks). Verifies:
 *   - Empty input → all cohorts empty
 *   - Priority ordering (mutually exclusive buckets)
 *   - noData: both risk and trend INSUFFICIENT_DATA
 *   - atRisk: HIGH risk (priority over trend)
 *   - improving: IMPROVING trend (not HIGH)
 *   - declining: DECLINING trend (not HIGH)
 *   - Healthy students (STABLE, LOW/MEDIUM) excluded
 *   - averageScore computation correctness
 *   - Mixed population distributes correctly
 */

import { describe, it, expect } from "vitest";
import { classifyStudentCohorts, type StudentCohortEntry } from "../../services/progress-analytics.service";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeStudent(
  id: number,
  name: string,
  chronologicalScores: number[],
): StudentCohortEntry {
  return { id, name, chronologicalScores };
}

// Score fixtures that produce known classifications:
// noData:    < 3 events AND < 5 events
const NO_DATA_SCORES: number[] = [80]; // 1 event → both INSUFFICIENT_DATA

// atRisk:    ≥ 3 events, avg < 60
const HIGH_RISK_SCORES = [30, 40, 50]; // avg=40 → HIGH risk, 3 events → trend INSUFFICIENT_DATA

// improving: ≥ 5 events, avg ≥ 60, delta > +5 (recent > previous)
// previous 2: [60,60] avg=60, recent 3: [80,80,80] avg=80, delta=+20 → IMPROVING, avg=72 → MEDIUM
const IMPROVING_SCORES = [60, 60, 80, 80, 80];

// declining: ≥ 5 events, avg ≥ 60, delta < -5 (recent < previous)
// previous 2: [80,80] avg=80, recent 3: [60,60,60] avg=60, delta=-20 → DECLINING, avg=68 → MEDIUM
const DECLINING_SCORES = [80, 80, 60, 60, 60];

// stable (healthy): ≥ 5 events, avg ≥ 80, stable
// previous 2: [80,80] avg=80, recent 3: [80,80,80] avg=80, delta=0 → STABLE, avg=80 → LOW
const HEALTHY_SCORES = [80, 80, 80, 80, 80];

// ── Empty population ──────────────────────────────────────────────────────────

describe("classifyStudentCohorts — empty population", () => {
  it("returns all empty arrays for no students", () => {
    const result = classifyStudentCohorts([]);
    expect(result.atRisk).toEqual([]);
    expect(result.improving).toEqual([]);
    expect(result.declining).toEqual([]);
    expect(result.noData).toEqual([]);
  });
});

// ── noData cohort ─────────────────────────────────────────────────────────────

describe("classifyStudentCohorts — noData cohort", () => {
  it("places student with 0 scores into noData", () => {
    const result = classifyStudentCohorts([makeStudent(1, "Alice", [])]);
    expect(result.noData).toHaveLength(1);
    expect(result.noData[0].name).toBe("Alice");
  });

  it("places student with 1 score into noData", () => {
    const result = classifyStudentCohorts([makeStudent(1, "Alice", [80])]);
    expect(result.noData).toHaveLength(1);
    expect(result.noData[0].id).toBe(1);
  });

  it("places student with 2 scores into noData", () => {
    const result = classifyStudentCohorts([makeStudent(1, "Alice", [70, 80])]);
    expect(result.noData).toHaveLength(1);
  });

  it("student with 2 scores is NOT in atRisk, improving, or declining", () => {
    const result = classifyStudentCohorts([makeStudent(1, "Alice", [70, 80])]);
    expect(result.atRisk).toHaveLength(0);
    expect(result.improving).toHaveLength(0);
    expect(result.declining).toHaveLength(0);
  });

  it("averageScore is 0 for student with no scores", () => {
    const result = classifyStudentCohorts([makeStudent(1, "Alice", [])]);
    expect(result.noData[0].averageScore).toBe(0);
  });
});

// ── atRisk cohort ─────────────────────────────────────────────────────────────

describe("classifyStudentCohorts — atRisk cohort (HIGH risk)", () => {
  it("places HIGH-risk student into atRisk", () => {
    const result = classifyStudentCohorts([makeStudent(1, "Bob", HIGH_RISK_SCORES)]);
    expect(result.atRisk).toHaveLength(1);
    expect(result.atRisk[0].name).toBe("Bob");
  });

  it("HIGH-risk student is not in improving, declining, or noData", () => {
    const result = classifyStudentCohorts([makeStudent(1, "Bob", HIGH_RISK_SCORES)]);
    expect(result.improving).toHaveLength(0);
    expect(result.declining).toHaveLength(0);
    expect(result.noData).toHaveLength(0);
  });

  it("computes correct averageScore for atRisk student", () => {
    // [30, 40, 50] → avg=40
    const result = classifyStudentCohorts([makeStudent(1, "Bob", [30, 40, 50])]);
    expect(result.atRisk[0].averageScore).toBe(40);
  });

  it("HIGH risk takes priority over DECLINING trend", () => {
    // avg < 60 → HIGH, but also declining (recent worse than previous)
    // previous [50,50] avg=50, recent [20,20,20] avg=20 → DECLINING
    // but avg=32 < 60 → HIGH → goes to atRisk not declining
    const scores = [50, 50, 20, 20, 20];
    const result = classifyStudentCohorts([makeStudent(1, "Bob", scores)]);
    expect(result.atRisk).toHaveLength(1);
    expect(result.declining).toHaveLength(0);
  });

  it("HIGH risk takes priority over IMPROVING trend", () => {
    // avg < 60 → HIGH, but improving (very low → slightly less low)
    // previous [20,20] avg=20, recent [45,45,55] avg=48.3 → delta=+28.3 → IMPROVING
    // but avg=37 < 60 → HIGH → goes to atRisk not improving
    const scores = [20, 20, 45, 45, 55];
    const result = classifyStudentCohorts([makeStudent(1, "Bob", scores)]);
    expect(result.atRisk).toHaveLength(1);
    expect(result.improving).toHaveLength(0);
  });
});

// ── improving cohort ──────────────────────────────────────────────────────────

describe("classifyStudentCohorts — improving cohort", () => {
  it("places IMPROVING student into improving", () => {
    const result = classifyStudentCohorts([makeStudent(1, "Carol", IMPROVING_SCORES)]);
    expect(result.improving).toHaveLength(1);
    expect(result.improving[0].name).toBe("Carol");
  });

  it("IMPROVING student is not in atRisk, declining, or noData", () => {
    const result = classifyStudentCohorts([makeStudent(1, "Carol", IMPROVING_SCORES)]);
    expect(result.atRisk).toHaveLength(0);
    expect(result.declining).toHaveLength(0);
    expect(result.noData).toHaveLength(0);
  });

  it("computes correct averageScore for improving student", () => {
    // [60, 60, 80, 80, 80] → avg=72
    const result = classifyStudentCohorts([makeStudent(1, "Carol", IMPROVING_SCORES)]);
    expect(result.improving[0].averageScore).toBe(72);
  });
});

// ── declining cohort ──────────────────────────────────────────────────────────

describe("classifyStudentCohorts — declining cohort", () => {
  it("places DECLINING student into declining", () => {
    const result = classifyStudentCohorts([makeStudent(1, "Dave", DECLINING_SCORES)]);
    expect(result.declining).toHaveLength(1);
    expect(result.declining[0].name).toBe("Dave");
  });

  it("DECLINING student is not in atRisk, improving, or noData", () => {
    const result = classifyStudentCohorts([makeStudent(1, "Dave", DECLINING_SCORES)]);
    expect(result.atRisk).toHaveLength(0);
    expect(result.improving).toHaveLength(0);
    expect(result.noData).toHaveLength(0);
  });
});

// ── healthy students excluded ─────────────────────────────────────────────────

describe("classifyStudentCohorts — healthy (STABLE, LOW/MEDIUM) excluded", () => {
  it("STABLE with LOW risk student does not appear in any cohort", () => {
    const result = classifyStudentCohorts([makeStudent(1, "Eve", HEALTHY_SCORES)]);
    expect(result.atRisk).toHaveLength(0);
    expect(result.improving).toHaveLength(0);
    expect(result.declining).toHaveLength(0);
    expect(result.noData).toHaveLength(0);
  });

  it("STABLE with MEDIUM risk student does not appear in any cohort", () => {
    // avg=70 → MEDIUM, stable
    const scores = [70, 70, 70, 70, 70];
    const result = classifyStudentCohorts([makeStudent(1, "Eve", scores)]);
    expect(result.atRisk).toHaveLength(0);
    expect(result.improving).toHaveLength(0);
    expect(result.declining).toHaveLength(0);
    expect(result.noData).toHaveLength(0);
  });
});

// ── Mixed population ──────────────────────────────────────────────────────────

describe("classifyStudentCohorts — mixed population", () => {
  it("distributes 5 students correctly across cohorts", () => {
    const students = [
      makeStudent(1, "NoData", NO_DATA_SCORES),
      makeStudent(2, "AtRisk", HIGH_RISK_SCORES),
      makeStudent(3, "Improving", IMPROVING_SCORES),
      makeStudent(4, "Declining", DECLINING_SCORES),
      makeStudent(5, "Healthy", HEALTHY_SCORES),
    ];
    const result = classifyStudentCohorts(students);

    expect(result.noData.map((s) => s.name)).toContain("NoData");
    expect(result.atRisk.map((s) => s.name)).toContain("AtRisk");
    expect(result.improving.map((s) => s.name)).toContain("Improving");
    expect(result.declining.map((s) => s.name)).toContain("Declining");

    // Total classified ≤ total students (healthy not in any cohort)
    const total =
      result.noData.length +
      result.atRisk.length +
      result.improving.length +
      result.declining.length;
    expect(total).toBe(4); // 5 students minus 1 healthy
  });

  it("each student appears in at most one cohort (mutually exclusive)", () => {
    const students = [
      makeStudent(1, "S1", NO_DATA_SCORES),
      makeStudent(2, "S2", HIGH_RISK_SCORES),
      makeStudent(3, "S3", IMPROVING_SCORES),
      makeStudent(4, "S4", DECLINING_SCORES),
    ];
    const result = classifyStudentCohorts(students);

    const allIds = [
      ...result.noData.map((s) => s.id),
      ...result.atRisk.map((s) => s.id),
      ...result.improving.map((s) => s.id),
      ...result.declining.map((s) => s.id),
    ];
    const uniqueIds = new Set(allIds);
    expect(uniqueIds.size).toBe(allIds.length); // no duplicates
  });

  it("multiple students in the same cohort are all included", () => {
    const students = [
      makeStudent(1, "Risk1", HIGH_RISK_SCORES),
      makeStudent(2, "Risk2", [10, 20, 30]),
      makeStudent(3, "Risk3", [40, 50, 55]),
    ];
    const result = classifyStudentCohorts(students);
    expect(result.atRisk).toHaveLength(3);
  });
});
