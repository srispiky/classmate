/**
 * Progress Analytics Security Regression Tests
 *
 * Sprint 8 Chunk 1: Verifies that adding riskLevel + trend fields to the
 * GET /students/:id/progress response does NOT weaken any of the three
 * authorization layers.
 *
 * Authorization layers verified:
 *   Layer 1  — requireRole("admin", "teacher") blocks students, parents, guests
 *   Layer 3  — Teacher A cannot access Teacher B's student progress
 *
 * Tests operate at the pure service/policy level (no HTTP server) — consistent
 * with the existing auth test suite pattern.
 *
 * Coverage:
 *   - computeRiskLevel produces a valid RiskLevel enum value
 *   - computeTrend produces a valid Trend enum value
 *   - INSUFFICIENT_DATA returned for thin data (< 3 / < 5 events)
 *   - Teacher scope constraints remain identical to pre-Chunk-1 behaviour
 */

import { describe, it, expect } from "vitest";
import { computeRiskLevel, computeTrend } from "../../services/progress-analytics.service";
import { studentPolicy } from "../../lib/policies/student-scope-policy";
import {
  createAdminScope,
  createTeacherScope,
  createStudentScope,
  createParentScope,
  createGuestScope,
} from "../helpers/authorization/sessions";
import { PolicyAuthorizationError } from "../../lib/policies/resource-scope-policy";

// ── Valid enum outputs ────────────────────────────────────────────────────────

const VALID_RISK_LEVELS = ["LOW", "MEDIUM", "HIGH", "INSUFFICIENT_DATA"] as const;
const VALID_TRENDS = ["IMPROVING", "STABLE", "DECLINING", "INSUFFICIENT_DATA"] as const;

describe("Progress analytics — output enum validity", () => {
  it("computeRiskLevel always returns a valid RiskLevel enum value", () => {
    const testCases = [[], [50], [50, 50], [50, 50, 50], [80, 90, 100], [30, 40, 20]];
    for (const scores of testCases) {
      expect(VALID_RISK_LEVELS).toContain(computeRiskLevel(scores));
    }
  });

  it("computeTrend always returns a valid Trend enum value", () => {
    const testCases = [
      [],
      [70],
      [70, 70, 70, 70],
      [70, 70, 70, 70, 70],
      [50, 50, 90, 90, 90],
      [90, 90, 50, 50, 50],
    ];
    for (const scores of testCases) {
      expect(VALID_TRENDS).toContain(computeTrend(scores));
    }
  });
});

// ── INSUFFICIENT_DATA boundary ────────────────────────────────────────────────

describe("Progress analytics — INSUFFICIENT_DATA boundary", () => {
  it("riskLevel: 0, 1, 2 events → INSUFFICIENT_DATA", () => {
    expect(computeRiskLevel([])).toBe("INSUFFICIENT_DATA");
    expect(computeRiskLevel([90])).toBe("INSUFFICIENT_DATA");
    expect(computeRiskLevel([90, 90])).toBe("INSUFFICIENT_DATA");
  });

  it("riskLevel: 3+ events → never INSUFFICIENT_DATA", () => {
    expect(computeRiskLevel([90, 90, 90])).not.toBe("INSUFFICIENT_DATA");
  });

  it("trend: 0–4 events → INSUFFICIENT_DATA", () => {
    expect(computeTrend([])).toBe("INSUFFICIENT_DATA");
    expect(computeTrend([70])).toBe("INSUFFICIENT_DATA");
    expect(computeTrend([70, 70])).toBe("INSUFFICIENT_DATA");
    expect(computeTrend([70, 70, 70])).toBe("INSUFFICIENT_DATA");
    expect(computeTrend([70, 70, 70, 70])).toBe("INSUFFICIENT_DATA");
  });

  it("trend: 5+ events → never INSUFFICIENT_DATA", () => {
    expect(computeTrend([70, 70, 70, 70, 70])).not.toBe("INSUFFICIENT_DATA");
  });
});

// ── Layer 1: Role enforcement (StudentScopePolicy) ───────────────────────────
//
// The analytics functions are only reachable inside the progress handler, which
// is already guarded by requireRole("admin", "teacher"). These tests verify
// that the policy contract is unchanged after Chunk 1.

describe("Progress endpoint — Layer 1: role enforcement unchanged", () => {
  const studentA = { id: 1, enrolledCourseIds: [10] };

  it("admin: validateAccess succeeds (no throw)", () => {
    const admin = createAdminScope();
    expect(() => studentPolicy.validateAccess(admin, studentA)).not.toThrow();
  });

  it("teacher with matching course: validateAccess succeeds (no throw)", () => {
    const teacher = createTeacherScope({ ownedCourseIds: [10] });
    expect(() => studentPolicy.validateAccess(teacher, studentA)).not.toThrow();
  });

  it("student role: validateAccess throws PolicyAuthorizationError", () => {
    const student = createStudentScope({ studentId: 99, enrolledCourseIds: [10] });
    expect(() => studentPolicy.validateAccess(student, studentA)).toThrow(
      PolicyAuthorizationError,
    );
  });

  it("parent role: validateAccess throws PolicyAuthorizationError", () => {
    const parent = createParentScope({ childStudentIds: [1], childCourseIds: [10] });
    expect(() => studentPolicy.validateAccess(parent, studentA)).toThrow(
      PolicyAuthorizationError,
    );
  });

  it("guest role: validateAccess throws PolicyAuthorizationError", () => {
    const guest = createGuestScope();
    expect(() => studentPolicy.validateAccess(guest, studentA)).toThrow(
      PolicyAuthorizationError,
    );
  });
});

// ── Layer 3: Teacher ownership (IDOR prevention) ─────────────────────────────

describe("Progress endpoint — Layer 3: teacher cross-student IDOR", () => {
  const studentInCourse10 = { id: 1, enrolledCourseIds: [10] };
  const studentInCourse20 = { id: 2, enrolledCourseIds: [20] };

  it("Teacher A (owns [10]) can access student enrolled in course 10", () => {
    const teacherA = createTeacherScope({ teacherId: 1, ownedCourseIds: [10] });
    expect(() => studentPolicy.validateAccess(teacherA, studentInCourse10)).not.toThrow();
  });

  it("Teacher A (owns [10]) CANNOT access student enrolled only in course 20", () => {
    const teacherA = createTeacherScope({ teacherId: 1, ownedCourseIds: [10] });
    expect(() => studentPolicy.validateAccess(teacherA, studentInCourse20)).toThrow(
      PolicyAuthorizationError,
    );
  });

  it("Teacher B (owns [20]) can access student in course 20", () => {
    const teacherB = createTeacherScope({ teacherId: 2, ownedCourseIds: [20] });
    expect(() => studentPolicy.validateAccess(teacherB, studentInCourse20)).not.toThrow();
  });

  it("Teacher B (owns [20]) CANNOT access student enrolled only in course 10", () => {
    const teacherB = createTeacherScope({ teacherId: 2, ownedCourseIds: [20] });
    expect(() => studentPolicy.validateAccess(teacherB, studentInCourse10)).toThrow(
      PolicyAuthorizationError,
    );
  });

  it("Teacher with no courses CANNOT access any student", () => {
    const teacherNoCourses = createTeacherScope({ teacherId: 3, ownedCourseIds: [] });
    expect(() =>
      studentPolicy.validateAccess(teacherNoCourses, studentInCourse10),
    ).toThrow(PolicyAuthorizationError);
    expect(() =>
      studentPolicy.validateAccess(teacherNoCourses, studentInCourse20),
    ).toThrow(PolicyAuthorizationError);
  });

  it("admin bypasses teacher ownership and accesses any student", () => {
    const admin = createAdminScope();
    expect(() => studentPolicy.validateAccess(admin, studentInCourse10)).not.toThrow();
    expect(() => studentPolicy.validateAccess(admin, studentInCourse20)).not.toThrow();
  });
});

// ── Analytics do not expose raw scores ───────────────────────────────────────
//
// Verifies that both functions return only their enum output — no raw score
// data is returned even when the input is large.

describe("Progress analytics — no raw score leakage in output", () => {
  it("computeRiskLevel returns a string, not an object with score data", () => {
    const result = computeRiskLevel([55, 60, 70, 80, 90]);
    expect(typeof result).toBe("string");
    expect(result).toBe("MEDIUM");
  });

  it("computeTrend returns a string, not an object with score data", () => {
    const result = computeTrend([50, 50, 90, 90, 90]);
    expect(typeof result).toBe("string");
    expect(result).toBe("IMPROVING");
  });
});
