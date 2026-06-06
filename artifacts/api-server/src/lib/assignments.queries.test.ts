import { describe, it, expect } from "vitest";
import { assignmentsTable } from "@workspace/db";
import { buildScopeContext, type ClassmateSession } from "./scope-context";
import { canAccessMixedResource } from "./ownership";
import { SQL_FALSE } from "./scope-filter";
import { buildAssignmentListConditions } from "./assignments.queries";

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

// ── buildAssignmentListConditions — Layer 2 scope filtering ──────────────────

describe("buildAssignmentListConditions — admin scope", () => {
  it("produces only the deletedAt guard (no scope filter) for admin", () => {
    const scope = buildScopeContext(session({ role: "admin" }));
    const conditions = buildAssignmentListConditions(scope, {});
    expect(conditions).toHaveLength(1);
    expect(conditions[0]).not.toBe(SQL_FALSE);
  });

  it("applies courseId filter for admin", () => {
    const scope = buildScopeContext(session({ role: "admin" }));
    const conditions = buildAssignmentListConditions(scope, { courseId: 7 });
    expect(conditions).toHaveLength(2);
    expect(conditions).not.toContain(SQL_FALSE);
  });

  it("applies studentId filter for admin (global role)", () => {
    const scope = buildScopeContext(session({ role: "admin" }));
    const conditions = buildAssignmentListConditions(scope, { studentId: 3 });
    expect(conditions).toHaveLength(2);
    expect(conditions).not.toContain(SQL_FALSE);
  });

  it("applies both courseId and studentId filters for admin", () => {
    const scope = buildScopeContext(session({ role: "admin" }));
    const conditions = buildAssignmentListConditions(scope, { courseId: 2, studentId: 5 });
    expect(conditions).toHaveLength(3);
    expect(conditions).not.toContain(SQL_FALSE);
  });
});

describe("buildAssignmentListConditions — teacher scope", () => {
  it("teacher with empty ownedCourseIds → SQL_FALSE scope filter", () => {
    const scope = buildScopeContext(session({ role: "teacher", ownedCourseIds: [] }));
    const conditions = buildAssignmentListConditions(scope, {});
    expect(conditions).toHaveLength(2);
    expect(conditions[0]).toBe(SQL_FALSE);
  });

  it("teacher with ownedCourseIds → course-based scope filter (not SQL_FALSE)", () => {
    const scope = buildScopeContext(session({ role: "teacher", ownedCourseIds: [1, 2] }));
    const conditions = buildAssignmentListConditions(scope, {});
    expect(conditions).toHaveLength(2);
    expect(conditions[0]).not.toBe(SQL_FALSE);
  });

  it("teacher can additionally filter by studentId (within owned courses)", () => {
    const scope = buildScopeContext(session({ role: "teacher", ownedCourseIds: [1, 2] }));
    const conditions = buildAssignmentListConditions(scope, { studentId: 9 });
    // [inArray(courseId, [1,2]), eq(studentId, 9), isNull(deletedAt)]
    expect(conditions).toHaveLength(3);
    expect(conditions).not.toContain(SQL_FALSE);
  });

  it("teacher can additionally filter by courseId", () => {
    const scope = buildScopeContext(session({ role: "teacher", ownedCourseIds: [1, 2] }));
    const conditions = buildAssignmentListConditions(scope, { courseId: 1 });
    // [inArray(courseId, [1,2]), eq(courseId, 1), isNull(deletedAt)]
    expect(conditions).toHaveLength(3);
    expect(conditions).not.toContain(SQL_FALSE);
  });
});

describe("buildAssignmentListConditions — student scope", () => {
  it("adds student_id eq condition when studentId is set", () => {
    const scope = buildScopeContext(session({ role: "student", studentId: 5 }));
    const conditions = buildAssignmentListConditions(scope, {});
    // [eq(studentId, 5), isNull(deletedAt)]
    expect(conditions).toHaveLength(2);
    expect(conditions[0]).not.toBe(SQL_FALSE);
  });

  it("returns SQL_FALSE when studentId is null (unlinked account)", () => {
    const scope = buildScopeContext(session({ role: "student", studentId: undefined }));
    const conditions = buildAssignmentListConditions(scope, {});
    expect(conditions).toHaveLength(2);
    expect(conditions[0]).toBe(SQL_FALSE);
  });

  it("ignores studentId query param for scoped student role", () => {
    const scope = buildScopeContext(session({ role: "student", studentId: 5 }));
    const conditions = buildAssignmentListConditions(scope, { studentId: 5 });
    expect(conditions).toHaveLength(2);
  });

  it("applies courseId filter alongside scope filter for student", () => {
    const scope = buildScopeContext(session({ role: "student", studentId: 5 }));
    const conditions = buildAssignmentListConditions(scope, { courseId: 3 });
    // [eq(studentId, 5), eq(courseId, 3), isNull(deletedAt)]
    expect(conditions).toHaveLength(3);
    expect(conditions[0]).not.toBe(SQL_FALSE);
  });
});

describe("buildAssignmentListConditions — parent scope", () => {
  it("adds inArray condition when childStudentIds is populated", () => {
    const scope = buildScopeContext(session({ role: "parent", childStudentIds: [2, 4, 6] }));
    const conditions = buildAssignmentListConditions(scope, {});
    // [inArray(studentId, [2,4,6]), isNull(deletedAt)]
    expect(conditions).toHaveLength(2);
    expect(conditions[0]).not.toBe(SQL_FALSE);
  });

  it("returns SQL_FALSE when childStudentIds is empty", () => {
    const scope = buildScopeContext(session({ role: "parent", childStudentIds: [] }));
    const conditions = buildAssignmentListConditions(scope, {});
    expect(conditions).toHaveLength(2);
    expect(conditions[0]).toBe(SQL_FALSE);
  });

  it("returns SQL_FALSE when childStudentIds is undefined", () => {
    const scope = buildScopeContext(session({ role: "parent", childStudentIds: undefined }));
    const conditions = buildAssignmentListConditions(scope, {});
    expect(conditions).toHaveLength(2);
    expect(conditions[0]).toBe(SQL_FALSE);
  });

  it("applies courseId filter alongside scope filter for parent", () => {
    const scope = buildScopeContext(session({ role: "parent", childStudentIds: [3] }));
    const conditions = buildAssignmentListConditions(scope, { courseId: 1 });
    expect(conditions).toHaveLength(3);
    expect(conditions[0]).not.toBe(SQL_FALSE);
  });

  it("ignores studentId query param for scoped parent role", () => {
    const scope = buildScopeContext(session({ role: "parent", childStudentIds: [3] }));
    const conditions = buildAssignmentListConditions(scope, { studentId: 3 });
    expect(conditions).toHaveLength(2);
  });
});

describe("buildAssignmentListConditions — soft-delete guard", () => {
  it("always includes isNull(deletedAt) as the last condition for admin", () => {
    const scope = buildScopeContext(session({ role: "admin" }));
    const conditions = buildAssignmentListConditions(scope, {});
    expect(conditions.length).toBeGreaterThanOrEqual(1);
    const last = conditions[conditions.length - 1];
    expect(last).toBeDefined();
    expect(last).not.toBe(SQL_FALSE);
  });

  it("always includes isNull(deletedAt) as the last condition for student", () => {
    const scope = buildScopeContext(session({ role: "student", studentId: 5 }));
    const conditions = buildAssignmentListConditions(scope, {});
    expect(conditions).toHaveLength(2);
    const last = conditions[conditions.length - 1];
    expect(last).toBeDefined();
    expect(last).not.toBe(SQL_FALSE);
  });
});

// ── canAccessMixedResource — Layer 3 ownership (assignment context) ──────────

describe("canAccessMixedResource — admin", () => {
  it("admin can access any assignment regardless of studentId or courseId", () => {
    const scope = buildScopeContext(session({ role: "admin" }));
    expect(canAccessMixedResource(99, 1, scope)).toBe("allowed");
    expect(canAccessMixedResource(null, null, scope)).toBe("allowed");
  });
});

describe("canAccessMixedResource — teacher IDOR protection", () => {
  it("teacher can access assignment in owned course", () => {
    const scope = buildScopeContext(session({ role: "teacher", ownedCourseIds: [5, 10] }));
    expect(canAccessMixedResource(42, 5, scope)).toBe("allowed");
    expect(canAccessMixedResource(1, 10, scope)).toBe("allowed");
  });

  it("teacher IDOR blocked — cannot access assignment in non-owned course", () => {
    const scope = buildScopeContext(session({ role: "teacher", ownedCourseIds: [5] }));
    expect(canAccessMixedResource(1, 99, scope)).toBe("denied");
  });

  it("teacher with empty ownedCourseIds is always denied", () => {
    const scope = buildScopeContext(session({ role: "teacher", ownedCourseIds: [] }));
    expect(canAccessMixedResource(1, 5, scope)).toBe("denied");
  });

  it("teacher denied when courseId is null (resource integrity violation)", () => {
    const scope = buildScopeContext(session({ role: "teacher", ownedCourseIds: [1] }));
    expect(canAccessMixedResource(1, null, scope)).toBe("denied");
  });
});

describe("canAccessMixedResource — student IDOR protection", () => {
  it("student can access own assignment (matching studentId)", () => {
    const scope = buildScopeContext(session({ role: "student", studentId: 5 }));
    expect(canAccessMixedResource(5, 1, scope)).toBe("allowed");
  });

  it("student IDOR blocked — cannot access another student's assignment", () => {
    const scope = buildScopeContext(session({ role: "student", studentId: 5 }));
    expect(canAccessMixedResource(9, 1, scope)).toBe("denied");
  });

  it("student with null studentId is always denied (unlinked account)", () => {
    const scope = buildScopeContext(session({ role: "student", studentId: undefined }));
    expect(canAccessMixedResource(1, 1, scope)).toBe("denied");
  });
});

describe("canAccessMixedResource — parent IDOR protection", () => {
  it("parent can access child's assignment", () => {
    const scope = buildScopeContext(session({ role: "parent", childStudentIds: [2, 4, 6] }));
    expect(canAccessMixedResource(4, 1, scope)).toBe("allowed");
  });

  it("parent IDOR blocked — cannot access non-child's assignment", () => {
    const scope = buildScopeContext(session({ role: "parent", childStudentIds: [2, 4, 6] }));
    expect(canAccessMixedResource(7, 1, scope)).toBe("denied");
  });

  it("parent with empty childStudentIds is always denied", () => {
    const scope = buildScopeContext(session({ role: "parent", childStudentIds: [] }));
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

describe("assignmentsTable schema — column references", () => {
  it("assignmentsTable exposes the deletedAt column", () => {
    expect(assignmentsTable.deletedAt).toBeDefined();
    expect(assignmentsTable.deletedAt.name).toBe("deleted_at");
  });

  it("assignmentsTable exposes the studentId column for scope filter binding", () => {
    expect(assignmentsTable.studentId).toBeDefined();
    expect(assignmentsTable.studentId.name).toBe("student_id");
  });

  it("assignmentsTable exposes the courseId column for teacher scope filter binding", () => {
    expect(assignmentsTable.courseId).toBeDefined();
    expect(assignmentsTable.courseId.name).toBe("course_id");
  });
});
