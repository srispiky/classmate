/**
 * Unit tests for buildTimeline()
 *
 * All tests are pure (no DB, no mocks). They verify:
 *   - Assignment-only timelines (only graded, non-soft-deleted)
 *   - Assessment-only timelines (all non-soft-deleted)
 *   - Mixed timelines
 *   - Chronological ordering correctness
 *   - Deterministic tie-breaking
 *   - Empty data handling
 *   - Soft-delete exclusion
 *   - Score percentage rounding
 */

import { describe, it, expect } from "vitest";
import {
  buildTimeline,
  type TimelineAssignmentInput,
  type TimelineAssessmentInput,
} from "../../services/progress-analytics.service";

// ── Test fixtures ─────────────────────────────────────────────────────────────

const t = (iso: string) => new Date(iso);

function makeAssignment(overrides: Partial<TimelineAssignmentInput> = {}): TimelineAssignmentInput {
  return {
    updatedAt: t("2026-01-10T12:00:00Z"),
    title: "Test Assignment",
    score: 80,
    maxScore: 100,
    status: "graded",
    courseId: 1,
    courseName: "Math",
    deletedAt: null,
    ...overrides,
  };
}

function makeAssessment(overrides: Partial<TimelineAssessmentInput> = {}): TimelineAssessmentInput {
  return {
    createdAt: t("2026-01-15T12:00:00Z"),
    title: "Test Assessment",
    score: 75,
    maxScore: 100,
    courseId: 1,
    courseName: "Math",
    deletedAt: null,
    ...overrides,
  };
}

// ── Empty data ────────────────────────────────────────────────────────────────

describe("buildTimeline — empty data", () => {
  it("returns empty array for no assignments and no assessments", () => {
    expect(buildTimeline([], [])).toEqual([]);
  });

  it("returns empty array for ungraded assignments only", () => {
    const result = buildTimeline(
      [makeAssignment({ status: "pending" }), makeAssignment({ status: "submitted" })],
      [],
    );
    expect(result).toEqual([]);
  });

  it("returns empty array when all assignments are soft-deleted", () => {
    const result = buildTimeline(
      [makeAssignment({ deletedAt: t("2026-02-01T00:00:00Z") })],
      [],
    );
    expect(result).toEqual([]);
  });

  it("returns empty array when all assessments are soft-deleted", () => {
    const result = buildTimeline(
      [],
      [makeAssessment({ deletedAt: t("2026-02-01T00:00:00Z") })],
    );
    expect(result).toEqual([]);
  });
});

// ── Assignments only ──────────────────────────────────────────────────────────

describe("buildTimeline — assignments only", () => {
  it("includes graded assignments", () => {
    const result = buildTimeline([makeAssignment()], []);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("ASSIGNMENT_GRADED");
    expect(result[0].title).toBe("Test Assignment");
  });

  it("excludes pending assignments", () => {
    const result = buildTimeline([makeAssignment({ status: "pending", score: null })], []);
    expect(result).toHaveLength(0);
  });

  it("excludes submitted (ungraded) assignments", () => {
    const result = buildTimeline([makeAssignment({ status: "submitted", score: null })], []);
    expect(result).toHaveLength(0);
  });

  it("excludes graded assignments with null score", () => {
    const result = buildTimeline([makeAssignment({ status: "graded", score: null })], []);
    expect(result).toHaveLength(0);
  });

  it("uses updatedAt as the event date", () => {
    const updatedAt = t("2026-03-15T09:00:00Z");
    const result = buildTimeline([makeAssignment({ updatedAt })], []);
    expect(result[0].date).toBe("2026-03-15T09:00:00.000Z");
  });

  it("computes scorePercent correctly (80/100 → 80)", () => {
    const result = buildTimeline([makeAssignment({ score: 80, maxScore: 100 })], []);
    expect(result[0].scorePercent).toBe(80);
  });

  it("computes scorePercent with rounding (7/8 → 87.5)", () => {
    const result = buildTimeline([makeAssignment({ score: 7, maxScore: 8 })], []);
    expect(result[0].scorePercent).toBe(87.5);
  });

  it("falls back to 'Unknown' for null courseName", () => {
    const result = buildTimeline([makeAssignment({ courseName: null })], []);
    expect(result[0].courseName).toBe("Unknown");
  });
});

// ── Assessments only ──────────────────────────────────────────────────────────

describe("buildTimeline — assessments only", () => {
  it("includes non-soft-deleted assessments", () => {
    const result = buildTimeline([], [makeAssessment()]);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("ASSESSMENT_COMPLETED");
    expect(result[0].title).toBe("Test Assessment");
  });

  it("uses createdAt as the event date", () => {
    const createdAt = t("2026-04-01T14:30:00Z");
    const result = buildTimeline([], [makeAssessment({ createdAt })]);
    expect(result[0].date).toBe("2026-04-01T14:30:00.000Z");
  });

  it("computes scorePercent correctly (75/100 → 75)", () => {
    const result = buildTimeline([], [makeAssessment({ score: 75, maxScore: 100 })]);
    expect(result[0].scorePercent).toBe(75);
  });

  it("falls back to 'Unknown' for null courseName", () => {
    const result = buildTimeline([], [makeAssessment({ courseName: null })]);
    expect(result[0].courseName).toBe("Unknown");
  });
});

// ── Mixed events ──────────────────────────────────────────────────────────────

describe("buildTimeline — mixed events", () => {
  it("merges assignments and assessments in chronological order", () => {
    const result = buildTimeline(
      [
        makeAssignment({ updatedAt: t("2026-02-01T00:00:00Z"), title: "A2" }),
        makeAssignment({ updatedAt: t("2026-01-01T00:00:00Z"), title: "A1" }),
      ],
      [
        makeAssessment({ createdAt: t("2026-01-15T00:00:00Z"), title: "AS1" }),
        makeAssessment({ createdAt: t("2026-02-10T00:00:00Z"), title: "AS2" }),
      ],
    );
    expect(result).toHaveLength(4);
    expect(result.map((e) => e.title)).toEqual(["A1", "AS1", "A2", "AS2"]);
  });

  it("mixes types correctly in the output", () => {
    const result = buildTimeline(
      [makeAssignment({ updatedAt: t("2026-01-01T00:00:00Z") })],
      [makeAssessment({ createdAt: t("2026-01-02T00:00:00Z") })],
    );
    expect(result[0].type).toBe("ASSIGNMENT_GRADED");
    expect(result[1].type).toBe("ASSESSMENT_COMPLETED");
  });

  it("excludes soft-deleted items from mixed results", () => {
    const result = buildTimeline(
      [
        makeAssignment({ updatedAt: t("2026-01-01T00:00:00Z"), title: "Visible" }),
        makeAssignment({
          updatedAt: t("2026-01-02T00:00:00Z"),
          title: "Deleted",
          deletedAt: t("2026-02-01T00:00:00Z"),
        }),
      ],
      [makeAssessment({ createdAt: t("2026-01-03T00:00:00Z"), title: "Assessment" })],
    );
    expect(result).toHaveLength(2);
    expect(result.map((e) => e.title)).toEqual(["Visible", "Assessment"]);
  });
});

// ── Ordering ──────────────────────────────────────────────────────────────────

describe("buildTimeline — ordering", () => {
  it("returns events oldest first", () => {
    const result = buildTimeline(
      [],
      [
        makeAssessment({ createdAt: t("2026-03-01T00:00:00Z"), title: "C" }),
        makeAssessment({ createdAt: t("2026-01-01T00:00:00Z"), title: "A" }),
        makeAssessment({ createdAt: t("2026-02-01T00:00:00Z"), title: "B" }),
      ],
    );
    expect(result.map((e) => e.title)).toEqual(["A", "B", "C"]);
  });

  it("deterministic tie-break by type then title for same timestamp", () => {
    const ts = t("2026-01-01T12:00:00Z");
    const result = buildTimeline(
      [
        makeAssignment({ updatedAt: ts, title: "Z Assignment" }),
        makeAssignment({ updatedAt: ts, title: "A Assignment" }),
      ],
      [makeAssessment({ createdAt: ts, title: "M Assessment" })],
    );
    // Same timestamp: type sort — ASSESSMENT_COMPLETED < ASSIGNMENT_GRADED alphabetically,
    // so assessment first, then assignments in title order
    expect(result[0].type).toBe("ASSESSMENT_COMPLETED");
    expect(result[1].title).toBe("A Assignment");
    expect(result[2].title).toBe("Z Assignment");
  });

  it("handles single event", () => {
    const result = buildTimeline([makeAssignment()], []);
    expect(result).toHaveLength(1);
  });
});
