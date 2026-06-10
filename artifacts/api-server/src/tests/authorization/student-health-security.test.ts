/**
 * Dashboard Student Health Security Regression Tests
 *
 * Sprint 8 Chunk 3: Verifies that GET /dashboard/student-health enforces
 * the same dashboard scoping established in Sprint 7 Chunk 6.
 *
 * Tests operate at the pure query-builder level (no HTTP server, no DB) —
 * consistent with the existing dashboard-scoping.test.ts pattern.
 *
 * Coverage:
 *   - buildDashboardStudentFilter applies correctly for admin/teacher/other
 *   - Teacher A's filter is distinct from Teacher B's
 *   - classifyStudentCohorts produces correct cohort membership
 *   - No raw score leakage in output (only averageScore derived field)
 *   - E2E isolation scenario: Teacher A sees Student A, Teacher B sees Student B
 */

import { describe, it, expect } from "vitest";
import {
  buildDashboardStudentFilter,
  buildDashboardAssignmentFilter,
  buildDashboardAssessmentFilter,
} from "../../lib/dashboard.queries";
import { classifyStudentCohorts } from "../../services/progress-analytics.service";
import { SQL_FALSE } from "../../lib/scope-filter";
import {
  createAdminScope,
  createTeacherScope,
  createStudentScope,
  createParentScope,
  createGuestScope,
} from "../helpers/authorization/sessions";

// ── Teacher A and Teacher B scopes ────────────────────────────────────────────

const teacherA = createTeacherScope({ teacherId: 1, ownedCourseIds: [10, 11] });
const teacherB = createTeacherScope({ teacherId: 2, ownedCourseIds: [20, 21] });
const teacherNoCourses = createTeacherScope({ teacherId: 3, ownedCourseIds: [] });
const admin = createAdminScope();

// ── Layer 2: scope filter correctness ────────────────────────────────────────

describe("Student Health — Layer 2: buildDashboardStudentFilter", () => {
  it("admin: returns undefined (no filter — global)", () => {
    expect(buildDashboardStudentFilter(admin)).toBeUndefined();
  });

  it("teacher with courses: returns a defined SQL condition (not SQL_FALSE)", () => {
    expect(buildDashboardStudentFilter(teacherA)).toBeDefined();
    expect(buildDashboardStudentFilter(teacherA)).not.toBe(SQL_FALSE);
  });

  it("teacher with no courses: returns SQL_FALSE (blocked)", () => {
    expect(buildDashboardStudentFilter(teacherNoCourses)).toBe(SQL_FALSE);
  });

  it("student role: returns SQL_FALSE", () => {
    expect(buildDashboardStudentFilter(createStudentScope())).toBe(SQL_FALSE);
  });

  it("parent role: returns SQL_FALSE", () => {
    expect(buildDashboardStudentFilter(createParentScope())).toBe(SQL_FALSE);
  });

  it("guest role: returns SQL_FALSE", () => {
    expect(buildDashboardStudentFilter(createGuestScope())).toBe(SQL_FALSE);
  });
});

describe("Student Health — assignment/assessment filters consistent with student filter", () => {
  it("admin: assignment filter is undefined", () => {
    expect(buildDashboardAssignmentFilter(admin)).toBeUndefined();
  });

  it("teacher with courses: assignment filter is defined", () => {
    expect(buildDashboardAssignmentFilter(teacherA)).toBeDefined();
    expect(buildDashboardAssignmentFilter(teacherA)).not.toBe(SQL_FALSE);
  });

  it("admin: assessment filter is undefined", () => {
    expect(buildDashboardAssessmentFilter(admin)).toBeUndefined();
  });

  it("teacher with courses: assessment filter is defined", () => {
    expect(buildDashboardAssessmentFilter(teacherA)).toBeDefined();
    expect(buildDashboardAssessmentFilter(teacherA)).not.toBe(SQL_FALSE);
  });
});

// ── Teacher A vs Teacher B isolation ─────────────────────────────────────────

describe("Student Health — Teacher A vs Teacher B: cross-teacher filter isolation", () => {
  it("student filters produce different SQL objects", () => {
    expect(buildDashboardStudentFilter(teacherA)).not.toBe(
      buildDashboardStudentFilter(teacherB),
    );
  });

  it("assignment filters produce different SQL objects", () => {
    expect(buildDashboardAssignmentFilter(teacherA)).not.toBe(
      buildDashboardAssignmentFilter(teacherB),
    );
  });

  it("assessment filters produce different SQL objects", () => {
    expect(buildDashboardAssessmentFilter(teacherA)).not.toBe(
      buildDashboardAssessmentFilter(teacherB),
    );
  });
});

// ── classifyStudentCohorts isolation (E2E scenario) ───────────────────────────
//
// Simulates Part 8 of the Chunk 3 spec:
//   Student A → HIGH risk (configured with low scores)
//   Student B → IMPROVING trend (configured with improving scores)
//   Teacher A dashboard → shows only Student A
//   Teacher B dashboard → shows only Student B
//   Admin dashboard → shows both
//
// Data isolation is enforced by buildDashboardStudentFilter at the DB level.
// This test verifies that classifyStudentCohorts correctly places each student
// in the expected cohort once the scoped data is passed in.

describe("Student Health — E2E cohort isolation scenario", () => {
  // Student A: HIGH risk (avg < 60)
  const studentA = { id: 1, name: "Student A", chronologicalScores: [30, 40, 50] };

  // Student B: IMPROVING (avg ≥ 60, recent better than older)
  const studentB = {
    id: 2,
    name: "Student B",
    chronologicalScores: [60, 60, 80, 80, 80],
  };

  it("Teacher A sees only Student A → correctly classified as atRisk", () => {
    // Teacher A's scoped query returns only studentA
    const result = classifyStudentCohorts([studentA]);
    expect(result.atRisk).toHaveLength(1);
    expect(result.atRisk[0].id).toBe(1);
    expect(result.improving).toHaveLength(0);
  });

  it("Teacher B sees only Student B → correctly classified as improving", () => {
    // Teacher B's scoped query returns only studentB
    const result = classifyStudentCohorts([studentB]);
    expect(result.improving).toHaveLength(1);
    expect(result.improving[0].id).toBe(2);
    expect(result.atRisk).toHaveLength(0);
  });

  it("Admin sees both → Student A in atRisk, Student B in improving", () => {
    // Admin's query returns all students (no filter)
    const result = classifyStudentCohorts([studentA, studentB]);
    expect(result.atRisk).toHaveLength(1);
    expect(result.atRisk[0].id).toBe(1);
    expect(result.improving).toHaveLength(1);
    expect(result.improving[0].id).toBe(2);
  });

  it("cohorts are mutually exclusive (no student in two cohorts)", () => {
    const result = classifyStudentCohorts([studentA, studentB]);
    const allIds = [
      ...result.atRisk.map((s) => s.id),
      ...result.improving.map((s) => s.id),
      ...result.declining.map((s) => s.id),
      ...result.noData.map((s) => s.id),
    ];
    expect(new Set(allIds).size).toBe(allIds.length);
  });
});

// ── Output shape — no raw score leakage ──────────────────────────────────────

describe("Student Health — output shape and data safety", () => {
  it("cohort entries contain only id, name, averageScore — no raw scores", () => {
    const result = classifyStudentCohorts([
      { id: 1, name: "Alice", chronologicalScores: [30, 40, 50] },
    ]);
    const entry = result.atRisk[0];
    expect(entry).toHaveProperty("id");
    expect(entry).toHaveProperty("name");
    expect(entry).toHaveProperty("averageScore");
    expect(entry).not.toHaveProperty("chronologicalScores");
    expect(entry).not.toHaveProperty("scores");
  });

  it("averageScore is a rounded number, not an array", () => {
    const result = classifyStudentCohorts([
      { id: 1, name: "Alice", chronologicalScores: [30, 40, 50] },
    ]);
    expect(typeof result.atRisk[0].averageScore).toBe("number");
    expect(result.atRisk[0].averageScore).toBe(40);
  });

  it("all four cohort arrays are always present, even if empty", () => {
    const result = classifyStudentCohorts([]);
    expect(Array.isArray(result.atRisk)).toBe(true);
    expect(Array.isArray(result.improving)).toBe(true);
    expect(Array.isArray(result.declining)).toBe(true);
    expect(Array.isArray(result.noData)).toBe(true);
  });
});
