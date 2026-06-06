import { describe, it, expect } from "vitest";
import { assessmentsTable } from "@workspace/db";
import { buildScopeContext, type ClassmateSession } from "./scope-context";
import { canAccessMixedResource } from "./ownership";
import { SQL_FALSE } from "./scope-filter";
import { buildAssessmentListConditions } from "./assessments.queries";

// ── helpers ──────────────────────────────────────────────────────────────────

function session(overrides: Partial<ClassmateSession> = {}): ClassmateSession {
  return {
    userId: 1,
    username: "test",
    displayName: "Test",
    role: "admin",
    studentId: undefined,
    childStudentIds: undefined,
    enrolledCourseIds: undefined,
    ...overrides,
  } as ClassmateSession;
}

// ── buildAssessmentListConditions — Layer 2 scope filtering ───────────────────

describe("buildAssessmentListConditions — admin scope", () => {
  it("produces only the deletedAt guard (no scope filter) for admin", () => {
    const scope = buildScopeContext(session({ role: "admin" }));
    const conditions = buildAssessmentListConditions(scope, {});
    expect(conditions).toHaveLength(1);
    expect(conditions[0]).not.toBe(SQL_FALSE);
  });

  it("applies courseId filter for admin", () => {
    const scope = buildScopeContext(session({ role: "admin" }));
    const conditions = buildAssessmentListConditions(scope, { courseId: 4 });
    expect(conditions).toHaveLength(2);
    expect(conditions).not.toContain(SQL_FALSE);
  });

  it("applies studentId filter for admin (global role)", () => {
    const scope = buildScopeContext(session({ role: "admin" }));
    const conditions = buildAssessmentListConditions(scope, { studentId: 7 });
    expect(conditions).toHaveLength(2);
    expect(conditions).not.toContain(SQL_FALSE);
  });

  it("applies both courseId and studentId filters for admin", () => {
    const scope = buildScopeContext(session({ role: "admin" }));
    const conditions = buildAssessmentListConditions(scope, { courseId: 2, studentId: 5 });
    expect(conditions).toHaveLength(3);
    expect(conditions).not.toContain(SQL_FALSE);
  });
});

describe("buildAssessmentListConditions — teacher scope", () => {
  it("teacher with empty ownedCourseIds → SQL_FALSE scope filter", () => {
    const scope = buildScopeContext(session({ role: "teacher", ownedCourseIds: [] }));
    const conditions = buildAssessmentListConditions(scope, {});
    expect(conditions).toHaveLength(2);
    expect(conditions[0]).toBe(SQL_FALSE);
  });

  it("teacher with ownedCourseIds → course-based scope filter (not SQL_FALSE)", () => {
    const scope = buildScopeContext(session({ role: "teacher", ownedCourseIds: [3, 7] }));
    const conditions = buildAssessmentListConditions(scope, {});
    expect(conditions).toHaveLength(2);
    expect(conditions[0]).not.toBe(SQL_FALSE);
  });

  it("teacher can additionally filter by studentId (within owned courses)", () => {
    const scope = buildScopeContext(session({ role: "teacher", ownedCourseIds: [3, 7] }));
    const conditions = buildAssessmentListConditions(scope, { studentId: 11 });
    // [inArray(courseId, [3,7]), eq(studentId, 11), isNull(deletedAt)]
    expect(conditions).toHaveLength(3);
    expect(conditions).not.toContain(SQL_FALSE);
  });

  it("teacher can additionally filter by courseId", () => {
    const scope = buildScopeContext(session({ role: "teacher", ownedCourseIds: [3, 7] }));
    const conditions = buildAssessmentListConditions(scope, { courseId: 3 });
    // [inArray(courseId, [3,7]), eq(courseId, 3), isNull(deletedAt)]
    expect(conditions).toHaveLength(3);
    expect(conditions).not.toContain(SQL_FALSE);
  });
});

describe("buildAssessmentListConditions — student scope", () => {
  it("adds student_id eq condition when studentId is set", () => {
    const scope = buildScopeContext(session({ role: "student", studentId: 5 }));
    const conditions = buildAssessmentListConditions(scope, {});
    // [eq(studentId, 5), isNull(deletedAt)]
    expect(conditions).toHaveLength(2);
    expect(conditions[0]).not.toBe(SQL_FALSE);
  });

  it("returns SQL_FALSE when studentId is null (unlinked account)", () => {
    const scope = buildScopeContext(session({ role: "student", studentId: undefined }));
    const conditions = buildAssessmentListConditions(scope, {});
    expect(conditions).toHaveLength(2);
    expect(conditions[0]).toBe(SQL_FALSE);
  });

  it("ignores studentId query param for scoped student role", () => {
    const scope = buildScopeContext(session({ role: "student", studentId: 5 }));
    const conditions = buildAssessmentListConditions(scope, { studentId: 5 });
    expect(conditions).toHaveLength(2);
  });

  it("applies courseId filter alongside scope filter for student", () => {
    const scope = buildScopeContext(session({ role: "student", studentId: 5 }));
    const conditions = buildAssessmentListConditions(scope, { courseId: 2 });
    // [eq(studentId, 5), eq(courseId, 2), isNull(deletedAt)]
    expect(conditions).toHaveLength(3);
    expect(conditions[0]).not.toBe(SQL_FALSE);
  });
});

describe("buildAssessmentListConditions — parent scope", () => {
  it("adds inArray condition when childStudentIds is populated", () => {
    const scope = buildScopeContext(session({ role: "parent", childStudentIds: [1, 3, 5] }));
    const conditions = buildAssessmentListConditions(scope, {});
    // [inArray(studentId, [1,3,5]), isNull(deletedAt)]
    expect(conditions).toHaveLength(2);
    expect(conditions[0]).not.toBe(SQL_FALSE);
  });

  it("returns SQL_FALSE when childStudentIds is empty", () => {
    const scope = buildScopeContext(session({ role: "parent", childStudentIds: [] }));
    const conditions = buildAssessmentListConditions(scope, {});
    expect(conditions).toHaveLength(2);
    expect(conditions[0]).toBe(SQL_FALSE);
  });

  it("returns SQL_FALSE when childStudentIds is undefined", () => {
    const scope = buildScopeContext(session({ role: "parent", childStudentIds: undefined }));
    const conditions = buildAssessmentListConditions(scope, {});
    expect(conditions).toHaveLength(2);
    expect(conditions[0]).toBe(SQL_FALSE);
  });

  it("applies courseId filter alongside scope filter for parent", () => {
    const scope = buildScopeContext(session({ role: "parent", childStudentIds: [2, 4] }));
    const conditions = buildAssessmentListConditions(scope, { courseId: 3 });
    expect(conditions).toHaveLength(3);
    expect(conditions[0]).not.toBe(SQL_FALSE);
  });

  it("ignores studentId query param for scoped parent role", () => {
    const scope = buildScopeContext(session({ role: "parent", childStudentIds: [3] }));
    const conditions = buildAssessmentListConditions(scope, { studentId: 3 });
    expect(conditions).toHaveLength(2);
  });
});

describe("buildAssessmentListConditions — soft-delete guard", () => {
  it("always includes isNull(deletedAt) as last condition for admin", () => {
    const scope = buildScopeContext(session({ role: "admin" }));
    const conditions = buildAssessmentListConditions(scope, {});
    expect(conditions.length).toBeGreaterThanOrEqual(1);
    const last = conditions[conditions.length - 1];
    expect(last).toBeDefined();
    expect(last).not.toBe(SQL_FALSE);
  });

  it("always includes isNull(deletedAt) as last condition for student", () => {
    const scope = buildScopeContext(session({ role: "student", studentId: 3 }));
    const conditions = buildAssessmentListConditions(scope, {});
    expect(conditions).toHaveLength(2);
    const last = conditions[conditions.length - 1];
    expect(last).toBeDefined();
    expect(last).not.toBe(SQL_FALSE);
  });
});

// ── canAccessMixedResource — Layer 3 ownership (assessment context) ──────────

describe("canAccessMixedResource — admin", () => {
  it("admin can access any assessment regardless of studentId or courseId", () => {
    const scope = buildScopeContext(session({ role: "admin" }));
    expect(canAccessMixedResource(99, 1, scope)).toBe("allowed");
    expect(canAccessMixedResource(null, null, scope)).toBe("allowed");
  });
});

describe("canAccessMixedResource — teacher IDOR protection (assessments)", () => {
  it("teacher can access assessment in owned course", () => {
    const scope = buildScopeContext(session({ role: "teacher", ownedCourseIds: [3, 8] }));
    expect(canAccessMixedResource(10, 3, scope)).toBe("allowed");
    expect(canAccessMixedResource(5, 8, scope)).toBe("allowed");
  });

  it("teacher IDOR blocked — cannot access assessment in non-owned course", () => {
    const scope = buildScopeContext(session({ role: "teacher", ownedCourseIds: [3] }));
    expect(canAccessMixedResource(10, 99, scope)).toBe("denied");
  });

  it("teacher with empty ownedCourseIds is always denied", () => {
    const scope = buildScopeContext(session({ role: "teacher", ownedCourseIds: [] }));
    expect(canAccessMixedResource(1, 5, scope)).toBe("denied");
  });

  it("teacher denied when courseId is null", () => {
    const scope = buildScopeContext(session({ role: "teacher", ownedCourseIds: [1] }));
    expect(canAccessMixedResource(1, null, scope)).toBe("denied");
  });
});

describe("canAccessMixedResource — student IDOR protection (assessments)", () => {
  it("student can access own assessment (matching studentId)", () => {
    const scope = buildScopeContext(session({ role: "student", studentId: 8 }));
    expect(canAccessMixedResource(8, 1, scope)).toBe("allowed");
  });

  it("student IDOR blocked — cannot access another student assessment", () => {
    const scope = buildScopeContext(session({ role: "student", studentId: 8 }));
    expect(canAccessMixedResource(15, 1, scope)).toBe("denied");
  });

  it("student with null studentId is always denied (unlinked account)", () => {
    const scope = buildScopeContext(session({ role: "student", studentId: undefined }));
    expect(canAccessMixedResource(1, 1, scope)).toBe("denied");
  });
});

describe("canAccessMixedResource — parent IDOR protection (assessments)", () => {
  it("parent can access child assessment", () => {
    const scope = buildScopeContext(session({ role: "parent", childStudentIds: [2, 6, 9] }));
    expect(canAccessMixedResource(6, 1, scope)).toBe("allowed");
  });

  it("parent IDOR blocked — cannot access non-child assessment", () => {
    const scope = buildScopeContext(session({ role: "parent", childStudentIds: [2, 6, 9] }));
    expect(canAccessMixedResource(10, 1, scope)).toBe("denied");
  });

  it("parent with empty childStudentIds is always denied", () => {
    const scope = buildScopeContext(session({ role: "parent", childStudentIds: [] }));
    expect(canAccessMixedResource(1, 1, scope)).toBe("denied");
  });

  it("parent with undefined childStudentIds is always denied", () => {
    const scope = buildScopeContext(session({ role: "parent", childStudentIds: undefined }));
    expect(canAccessMixedResource(1, 1, scope)).toBe("denied");
  });
});

describe("canAccessMixedResource — guest scope", () => {
  it("guest is always denied", () => {
    const scope = buildScopeContext(session({ role: "guest" }));
    expect(canAccessMixedResource(1, 1, scope)).toBe("denied");
  });
});

// ── schema column reference sanity check ─────────────────────────────────────

describe("assessmentsTable schema — column references", () => {
  it("assessmentsTable exposes the deletedAt column", () => {
    expect(assessmentsTable.deletedAt).toBeDefined();
    expect(assessmentsTable.deletedAt.name).toBe("deleted_at");
  });

  it("assessmentsTable exposes the studentId column for scope filter binding", () => {
    expect(assessmentsTable.studentId).toBeDefined();
    expect(assessmentsTable.studentId.name).toBe("student_id");
  });

  it("assessmentsTable exposes the courseId column for teacher scope filter binding", () => {
    expect(assessmentsTable.courseId).toBeDefined();
    expect(assessmentsTable.courseId.name).toBe("course_id");
  });
});
