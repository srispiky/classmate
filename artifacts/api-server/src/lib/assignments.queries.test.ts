import { describe, it, expect } from "vitest";
import { assignmentsTable } from "@workspace/db";
import { buildScopeContext, type ClassmateSession } from "./scope-context";
import { canAccessStudentResource } from "./ownership";
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
  it("produces only the deletedAt guard (no scope filter) for teacher", () => {
    const scope = buildScopeContext(session({ role: "teacher" }));
    const conditions = buildAssignmentListConditions(scope, {});
    expect(conditions).toHaveLength(1);
    expect(conditions[0]).not.toBe(SQL_FALSE);
  });

  it("applies studentId filter for teacher (global role)", () => {
    const scope = buildScopeContext(session({ role: "teacher" }));
    const conditions = buildAssignmentListConditions(scope, { studentId: 9 });
    expect(conditions).toHaveLength(2);
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
    // studentId filter param is ignored for scoped roles — scope filter already constrains
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
    // studentId filter is ignored for non-global roles
    expect(conditions).toHaveLength(2);
  });
});

describe("buildAssignmentListConditions — soft-delete guard", () => {
  it("always includes isNull(deletedAt) as the last condition for admin", () => {
    const scope = buildScopeContext(session({ role: "admin" }));
    const conditions = buildAssignmentListConditions(scope, {});
    // The last condition is isNull(deletedAt) — verify the array is non-empty and last item is defined
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

// ── canAccessStudentResource — Layer 3 ownership (assignment context) ─────────

describe("canAccessStudentResource — admin and teacher", () => {
  it("admin can access any assignment regardless of student_id", () => {
    const scope = buildScopeContext(session({ role: "admin" }));
    expect(canAccessStudentResource(99, scope)).toBe("allowed");
    expect(canAccessStudentResource(1, scope)).toBe("allowed");
  });

  it("teacher can access any assignment regardless of student_id", () => {
    const scope = buildScopeContext(session({ role: "teacher" }));
    expect(canAccessStudentResource(42, scope)).toBe("allowed");
  });
});

describe("canAccessStudentResource — student IDOR protection", () => {
  it("student can access own assignment (matching studentId)", () => {
    const scope = buildScopeContext(session({ role: "student", studentId: 5 }));
    expect(canAccessStudentResource(5, scope)).toBe("allowed");
  });

  it("student IDOR blocked — cannot access another student's assignment", () => {
    const scope = buildScopeContext(session({ role: "student", studentId: 5 }));
    expect(canAccessStudentResource(9, scope)).toBe("denied");
  });

  it("student with null studentId is always denied (unlinked account)", () => {
    const scope = buildScopeContext(session({ role: "student", studentId: undefined }));
    expect(canAccessStudentResource(1, scope)).toBe("denied");
  });
});

describe("canAccessStudentResource — parent IDOR protection", () => {
  it("parent can access child's assignment", () => {
    const scope = buildScopeContext(session({ role: "parent", childStudentIds: [2, 4, 6] }));
    expect(canAccessStudentResource(4, scope)).toBe("allowed");
  });

  it("parent IDOR blocked — cannot access non-child's assignment", () => {
    const scope = buildScopeContext(session({ role: "parent", childStudentIds: [2, 4, 6] }));
    expect(canAccessStudentResource(7, scope)).toBe("denied");
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

// ── schema column reference sanity check ─────────────────────────────────────

describe("assignmentsTable schema — deletedAt column", () => {
  it("assignmentsTable exposes the deletedAt column", () => {
    expect(assignmentsTable.deletedAt).toBeDefined();
    expect(assignmentsTable.deletedAt.name).toBe("deleted_at");
  });

  it("assignmentsTable exposes the studentId column for scope filter binding", () => {
    expect(assignmentsTable.studentId).toBeDefined();
    expect(assignmentsTable.studentId.name).toBe("student_id");
  });
});
