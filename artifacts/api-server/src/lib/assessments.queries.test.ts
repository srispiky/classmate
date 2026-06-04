import { describe, it, expect } from "vitest";
import { assessmentsTable } from "@workspace/db";
import { buildScopeContext, type ClassmateSession } from "./scope-context";
import { canAccessStudentResource } from "./ownership";
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
  it("produces only the deletedAt guard (no scope filter) for teacher", () => {
    const scope = buildScopeContext(session({ role: "teacher" }));
    const conditions = buildAssessmentListConditions(scope, {});
    expect(conditions).toHaveLength(1);
    expect(conditions[0]).not.toBe(SQL_FALSE);
  });

  it("applies studentId filter for teacher (global role)", () => {
    const scope = buildScopeContext(session({ role: "teacher" }));
    const conditions = buildAssessmentListConditions(scope, { studentId: 11 });
    expect(conditions).toHaveLength(2);
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
    // studentId filter param is ignored for non-global roles
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
    // studentId filter param is ignored for non-global roles
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

// ── schema column reference sanity check ─────────────────────────────────────

describe("assessmentsTable schema — deletedAt column", () => {
  it("assessmentsTable exposes the deletedAt column", () => {
    expect(assessmentsTable.deletedAt).toBeDefined();
    expect(assessmentsTable.deletedAt.name).toBe("deleted_at");
  });

  it("assessmentsTable exposes the studentId column for scope filter binding", () => {
    expect(assessmentsTable.studentId).toBeDefined();
    expect(assessmentsTable.studentId.name).toBe("student_id");
  });
});

// ── canAccessStudentResource — Layer 3 ownership (assessment context) ─────────

describe("canAccessStudentResource — admin and teacher", () => {
  it("admin can access any assessment regardless of student_id", () => {
    const scope = buildScopeContext(session({ role: "admin" }));
    expect(canAccessStudentResource(99, scope)).toBe("allowed");
    expect(canAccessStudentResource(1, scope)).toBe("allowed");
  });

  it("teacher can access any assessment regardless of student_id", () => {
    const scope = buildScopeContext(session({ role: "teacher" }));
    expect(canAccessStudentResource(42, scope)).toBe("allowed");
  });
});

describe("canAccessStudentResource — student IDOR protection (assessments)", () => {
  it("student can access own assessment (matching studentId)", () => {
    const scope = buildScopeContext(session({ role: "student", studentId: 8 }));
    expect(canAccessStudentResource(8, scope)).toBe("allowed");
  });

  it("student IDOR blocked — cannot access another student assessment", () => {
    const scope = buildScopeContext(session({ role: "student", studentId: 8 }));
    expect(canAccessStudentResource(15, scope)).toBe("denied");
  });

  it("student with null studentId is always denied (unlinked account)", () => {
    const scope = buildScopeContext(session({ role: "student", studentId: undefined }));
    expect(canAccessStudentResource(1, scope)).toBe("denied");
  });
});

describe("canAccessStudentResource — parent IDOR protection (assessments)", () => {
  it("parent can access child assessment", () => {
    const scope = buildScopeContext(session({ role: "parent", childStudentIds: [2, 6, 9] }));
    expect(canAccessStudentResource(6, scope)).toBe("allowed");
  });

  it("parent IDOR blocked — cannot access non-child assessment", () => {
    const scope = buildScopeContext(session({ role: "parent", childStudentIds: [2, 6, 9] }));
    expect(canAccessStudentResource(10, scope)).toBe("denied");
  });

  it("parent with empty childStudentIds is always denied", () => {
    const scope = buildScopeContext(session({ role: "parent", childStudentIds: [] }));
    expect(canAccessStudentResource(1, scope)).toBe("denied");
  });

  it("parent with undefined childStudentIds is always denied", () => {
    const scope = buildScopeContext(session({ role: "parent", childStudentIds: undefined }));
    expect(canAccessStudentResource(1, scope)).toBe("denied");
  });
});

describe("canAccessStudentResource — guest scope", () => {
  it("guest is always denied", () => {
    const scope = buildScopeContext(session({ role: "guest" }));
    expect(canAccessStudentResource(1, scope)).toBe("denied");
  });
});
