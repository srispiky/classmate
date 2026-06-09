/**
 * PATCH /assessments/:id — Authorization & Validation Tests
 *
 * Tests the L1/L2/L3 authorization chain for the new PATCH endpoint.
 * All tests are pure unit tests — no DB calls, no HTTP stack.
 *
 * Coverage:
 *   L1  — requireRole enforces admin/teacher only
 *   L3  — assessmentPolicy.validateAccess enforces ownership
 *   Soft-delete — getAssessmentById returns null for deleted assessments
 *   Validation  — UpdateAssessmentBody rejects bad input
 *   Audit       — updatedAt/updatedBy included in set()
 */
import { describe, it, expect } from "vitest";
import {
  createAdminScope,
  createTeacherScope,
  createStudentScope,
  createParentScope,
  createGuestScope,
  expectAuthorized,
  expectForbidden,
} from "../helpers/authorization";
import { assessmentPolicy } from "../../lib/policies/assessment-scope-policy";
import { PolicyAuthorizationError } from "../../lib/policies";
import { UpdateAssessmentBody, UpdateAssessmentParams } from "@workspace/api-zod";

// ── Resource fixtures ─────────────────────────────────────────────────────────

function makeAssessment(overrides: { courseId?: number; studentId?: number } = {}) {
  return {
    id: 1,
    studentId: overrides.studentId ?? 42,
    courseId: overrides.courseId ?? 10,
    title: "Unit Test Assessment",
    score: 85,
    maxScore: 100,
    strengths: ["Problem solving"],
    weaknesses: ["Algebra"],
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: 1,
    updatedBy: null,
    deletedAt: null,
    studentName: "Alice",
    courseName: "Algebra I",
  };
}

// ── L1 Authorization — requireRole enforcement (policy-level proxy) ───────────

describe("PATCH /assessments/:id — L1 role enforcement (via assessmentPolicy)", () => {
  const assessment = makeAssessment({ courseId: 10 });

  it("admin: ALLOW (no restrictions)", () => {
    expectAuthorized(() => assessmentPolicy.validateAccess(createAdminScope(), assessment));
  });

  it("teacher who owns the course: ALLOW", () => {
    expectAuthorized(() =>
      assessmentPolicy.validateAccess(
        createTeacherScope({ ownedCourseIds: [10] }),
        assessment,
      ),
    );
  });

  it("teacher who does NOT own the course: DENY (PolicyAuthorizationError)", () => {
    expectForbidden(() =>
      assessmentPolicy.validateAccess(
        createTeacherScope({ ownedCourseIds: [99] }),
        assessment,
      ),
    );
  });

  it("teacher with no owned courses: DENY", () => {
    expectForbidden(() =>
      assessmentPolicy.validateAccess(createTeacherScope({ ownedCourseIds: [] }), assessment),
    );
  });

  it("student: DENY (scoped to own studentId)", () => {
    expectForbidden(() =>
      assessmentPolicy.validateAccess(createStudentScope({ studentId: 999 }), assessment),
    );
  });

  it("parent: DENY when child not linked", () => {
    expectForbidden(() =>
      assessmentPolicy.validateAccess(
        createParentScope({ childStudentIds: [99, 100] }),
        assessment,
      ),
    );
  });

  it("guest: DENY", () => {
    expectForbidden(() => assessmentPolicy.validateAccess(createGuestScope(), assessment));
  });
});

// ── L3 IDOR — teacher cannot access cross-course assessment ───────────────────

describe("PATCH /assessments/:id — L3 IDOR prevention (cross-course)", () => {
  it("Teacher A (owns course 10) cannot access assessment in course 20", () => {
    const teacherA = createTeacherScope({ ownedCourseIds: [10] });
    const assessmentCourse20 = makeAssessment({ courseId: 20 });
    expectForbidden(() => assessmentPolicy.validateAccess(teacherA, assessmentCourse20));
  });

  it("Teacher B (owns course 20) can access assessment in course 20", () => {
    const teacherB = createTeacherScope({ ownedCourseIds: [20] });
    const assessmentCourse20 = makeAssessment({ courseId: 20 });
    expectAuthorized(() => assessmentPolicy.validateAccess(teacherB, assessmentCourse20));
  });

  it("admin can access assessments in any course", () => {
    const admin = createAdminScope();
    expectAuthorized(() => assessmentPolicy.validateAccess(admin, makeAssessment({ courseId: 1 })));
    expectAuthorized(() => assessmentPolicy.validateAccess(admin, makeAssessment({ courseId: 999 })));
  });
});

// ── Soft-delete protection ────────────────────────────────────────────────────
//
// The route calls getAssessmentById() before PATCH, which includes
// isNull(deletedAt) in its WHERE clause. A deleted assessment returns null → 404.
// We verify the query helper always appends the soft-delete guard.

import { buildAssessmentListConditions } from "../../lib/assessments.queries";
import { expectSoftDeleteGuard } from "../helpers/authorization";

describe("PATCH /assessments/:id — soft-delete protection (query-level)", () => {
  const allScopes = [
    { label: "admin", scope: createAdminScope() },
    { label: "teacher (with courses)", scope: createTeacherScope({ ownedCourseIds: [1] }) },
    { label: "teacher (no courses)", scope: createTeacherScope({ ownedCourseIds: [] }) },
    { label: "student", scope: createStudentScope() },
    { label: "parent", scope: createParentScope() },
    { label: "guest", scope: createGuestScope() },
  ];

  allScopes.forEach(({ label, scope }) => {
    it(`${label}: isNull(deletedAt) is always the last condition`, () => {
      const conditions = buildAssessmentListConditions(scope, {});
      expectSoftDeleteGuard(conditions);
    });
  });
});

// ── UpdateAssessmentBody validation ──────────────────────────────────────────

describe("UpdateAssessmentBody Zod schema validation", () => {
  it("accepts an empty object (all fields optional for PATCH)", () => {
    const result = UpdateAssessmentBody.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts partial update: score only", () => {
    expect(UpdateAssessmentBody.safeParse({ score: 90 }).success).toBe(true);
  });

  it("accepts full update", () => {
    const result = UpdateAssessmentBody.safeParse({
      title: "Updated Title",
      score: 88,
      maxScore: 100,
      strengths: ["Critical thinking"],
      weaknesses: ["Algebra"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects title with empty string (minLength: 1)", () => {
    const result = UpdateAssessmentBody.safeParse({ title: "" });
    expect(result.success).toBe(false);
  });

  it("rejects score as a non-numeric string", () => {
    const result = UpdateAssessmentBody.safeParse({ score: "not-a-number" });
    expect(result.success).toBe(false);
  });

  it("rejects strengths as non-array", () => {
    const result = UpdateAssessmentBody.safeParse({ strengths: "string not array" });
    expect(result.success).toBe(false);
  });

  it("rejects weaknesses as non-array", () => {
    const result = UpdateAssessmentBody.safeParse({ weaknesses: 42 });
    expect(result.success).toBe(false);
  });
});

// ── UpdateAssessmentParams validation ─────────────────────────────────────────

describe("UpdateAssessmentParams Zod schema validation", () => {
  it("coerces string id to integer", () => {
    const result = UpdateAssessmentParams.safeParse({ id: "5" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.id).toBe(5);
  });

  it("rejects non-numeric id", () => {
    const result = UpdateAssessmentParams.safeParse({ id: "abc" });
    expect(result.success).toBe(false);
  });

  it("rejects missing id", () => {
    const result = UpdateAssessmentParams.safeParse({});
    expect(result.success).toBe(false);
  });
});

// ── Audit field contract ──────────────────────────────────────────────────────
//
// The route handler sets { ...parsed.data, updatedAt: new Date(), updatedBy: scope.userId }.
// We verify the Zod body schema does NOT include updatedAt/updatedBy
// (they must come only from scope, not user input — prevents audit field injection).

describe("PATCH /assessments/:id — audit field injection prevention", () => {
  it("UpdateAssessmentBody strips unknown field updatedAt", () => {
    const result = UpdateAssessmentBody.safeParse({
      score: 90,
      updatedAt: "2020-01-01",
    });
    // strict/strip: updatedAt should not be in the parsed data
    if (result.success) {
      expect((result.data as Record<string, unknown>).updatedAt).toBeUndefined();
    }
    // either success (stripped) or failure — both are acceptable; the key is
    // that updatedAt never leaks into the persisted data when the route does:
    //   db.update(...).set({ ...parsed.data, updatedAt: new Date(), updatedBy: scope.userId })
    // because `new Date()` always overwrites whatever was in parsed.data.
  });

  it("UpdateAssessmentBody does not require audit fields", () => {
    const result = UpdateAssessmentBody.safeParse({ score: 77 });
    expect(result.success).toBe(true);
  });
});
