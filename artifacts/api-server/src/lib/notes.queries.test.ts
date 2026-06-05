import { describe, it, expect } from "vitest";
import { notesTable } from "@workspace/db";
import { buildScopeContext, type ClassmateSession } from "./scope-context";
import { canAccessCourseResource } from "./ownership";
import { SQL_FALSE } from "./scope-filter";
import { buildNoteListConditions } from "./notes.queries";

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

// ── buildNoteListConditions — Layer 2 scope filtering ────────────────────────

describe("buildNoteListConditions — admin scope", () => {
  it("produces only the deletedAt guard (no scope filter) for admin", () => {
    const scope = buildScopeContext(session({ role: "admin" }));
    const conditions = buildNoteListConditions(scope, {});
    expect(conditions).toHaveLength(1);
    expect(conditions[0]).not.toBe(SQL_FALSE);
  });

  it("applies courseId filter for admin", () => {
    const scope = buildScopeContext(session({ role: "admin" }));
    const conditions = buildNoteListConditions(scope, { courseId: 3 });
    expect(conditions).toHaveLength(2);
    expect(conditions).not.toContain(SQL_FALSE);
  });
});

describe("buildNoteListConditions — teacher scope", () => {
  it("produces only the deletedAt guard (no scope filter) for teacher", () => {
    const scope = buildScopeContext(session({ role: "teacher" }));
    const conditions = buildNoteListConditions(scope, {});
    expect(conditions).toHaveLength(1);
    expect(conditions[0]).not.toBe(SQL_FALSE);
  });

  it("applies courseId filter for teacher", () => {
    const scope = buildScopeContext(session({ role: "teacher" }));
    const conditions = buildNoteListConditions(scope, { courseId: 7 });
    expect(conditions).toHaveLength(2);
    expect(conditions).not.toContain(SQL_FALSE);
  });
});

describe("buildNoteListConditions — student scope", () => {
  it("adds inArray(course_id, enrolledCourseIds) when enrollments are set", () => {
    const scope = buildScopeContext(session({ role: "student", enrolledCourseIds: [1, 3, 5] }));
    const conditions = buildNoteListConditions(scope, {});
    // [inArray(courseId, [1,3,5]), isNull(deletedAt)]
    expect(conditions).toHaveLength(2);
    expect(conditions[0]).not.toBe(SQL_FALSE);
  });

  it("returns SQL_FALSE when enrolledCourseIds is empty", () => {
    const scope = buildScopeContext(session({ role: "student", enrolledCourseIds: [] }));
    const conditions = buildNoteListConditions(scope, {});
    expect(conditions).toHaveLength(2);
    expect(conditions[0]).toBe(SQL_FALSE);
  });

  it("returns SQL_FALSE when enrolledCourseIds is undefined", () => {
    const scope = buildScopeContext(session({ role: "student", enrolledCourseIds: undefined }));
    const conditions = buildNoteListConditions(scope, {});
    expect(conditions).toHaveLength(2);
    expect(conditions[0]).toBe(SQL_FALSE);
  });

  it("applies courseId filter alongside enrollment scope", () => {
    const scope = buildScopeContext(session({ role: "student", enrolledCourseIds: [2, 4] }));
    const conditions = buildNoteListConditions(scope, { courseId: 2 });
    // [inArray(courseId, [2,4]), eq(courseId, 2), isNull(deletedAt)]
    expect(conditions).toHaveLength(3);
    expect(conditions[0]).not.toBe(SQL_FALSE);
  });

  it("courseId filter applied even for non-enrolled course (AND produces zero rows — correct)", () => {
    const scope = buildScopeContext(session({ role: "student", enrolledCourseIds: [2, 4] }));
    const conditions = buildNoteListConditions(scope, { courseId: 9 });
    // [inArray(courseId, [2,4]), eq(courseId, 9), isNull(deletedAt)] — impossible AND, zero rows
    expect(conditions).toHaveLength(3);
    expect(conditions[0]).not.toBe(SQL_FALSE);
  });
});

describe("buildNoteListConditions — parent scope", () => {
  it("adds parentCourseEnrollmentFilter subquery when childStudentIds is populated", () => {
    const scope = buildScopeContext(session({ role: "parent", childStudentIds: [2, 5] }));
    const conditions = buildNoteListConditions(scope, {});
    // [parentEnrollFilter (subquery), isNull(deletedAt)]
    expect(conditions).toHaveLength(2);
    expect(conditions[0]).not.toBe(SQL_FALSE);
  });

  it("returns SQL_FALSE when childStudentIds is empty", () => {
    const scope = buildScopeContext(session({ role: "parent", childStudentIds: [] }));
    const conditions = buildNoteListConditions(scope, {});
    expect(conditions).toHaveLength(2);
    expect(conditions[0]).toBe(SQL_FALSE);
  });

  it("returns SQL_FALSE when childStudentIds is undefined", () => {
    const scope = buildScopeContext(session({ role: "parent", childStudentIds: undefined }));
    const conditions = buildNoteListConditions(scope, {});
    expect(conditions).toHaveLength(2);
    expect(conditions[0]).toBe(SQL_FALSE);
  });

  it("applies courseId filter alongside parent subquery", () => {
    const scope = buildScopeContext(session({ role: "parent", childStudentIds: [3] }));
    const conditions = buildNoteListConditions(scope, { courseId: 1 });
    // [parentEnrollFilter, eq(courseId, 1), isNull(deletedAt)]
    expect(conditions).toHaveLength(3);
    expect(conditions[0]).not.toBe(SQL_FALSE);
  });
});

describe("buildNoteListConditions — guest scope", () => {
  it("produces SQL_FALSE for guest", () => {
    const scope = buildScopeContext(session({ role: "guest" }));
    const conditions = buildNoteListConditions(scope, {});
    expect(conditions).toHaveLength(2);
    expect(conditions[0]).toBe(SQL_FALSE);
  });
});

describe("buildNoteListConditions — soft-delete guard", () => {
  it("always includes isNull(deletedAt) as last condition for admin", () => {
    const scope = buildScopeContext(session({ role: "admin" }));
    const conditions = buildNoteListConditions(scope, {});
    const last = conditions[conditions.length - 1];
    expect(last).toBeDefined();
    expect(last).not.toBe(SQL_FALSE);
  });

  it("always includes isNull(deletedAt) as last condition for student", () => {
    const scope = buildScopeContext(session({ role: "student", enrolledCourseIds: [1] }));
    const conditions = buildNoteListConditions(scope, {});
    expect(conditions).toHaveLength(2);
    const last = conditions[conditions.length - 1];
    expect(last).toBeDefined();
    expect(last).not.toBe(SQL_FALSE);
  });
});

// ── schema column reference sanity check ─────────────────────────────────────

describe("notesTable schema — deletedAt and courseId columns", () => {
  it("notesTable exposes the deletedAt column", () => {
    expect(notesTable.deletedAt).toBeDefined();
    expect(notesTable.deletedAt.name).toBe("deleted_at");
  });

  it("notesTable exposes the courseId column for scope filter binding", () => {
    expect(notesTable.courseId).toBeDefined();
    expect(notesTable.courseId.name).toBe("course_id");
  });
});

// ── canAccessCourseResource — Layer 3 ownership (note context) ────────────────

describe("canAccessCourseResource — admin and teacher", () => {
  it("admin can access any note regardless of course_id", () => {
    const scope = buildScopeContext(session({ role: "admin" }));
    expect(canAccessCourseResource(5, scope)).toBe("allowed");
    expect(canAccessCourseResource(99, scope)).toBe("allowed");
  });

  it("teacher can access any note regardless of course_id", () => {
    const scope = buildScopeContext(session({ role: "teacher" }));
    expect(canAccessCourseResource(3, scope)).toBe("allowed");
  });
});

describe("canAccessCourseResource — student enrollment-based access", () => {
  it("student can access note from enrolled course", () => {
    const scope = buildScopeContext(session({ role: "student", enrolledCourseIds: [2, 4, 6] }));
    expect(canAccessCourseResource(4, scope)).toBe("allowed");
  });

  it("student CANNOT access note from non-enrolled course", () => {
    const scope = buildScopeContext(session({ role: "student", enrolledCourseIds: [2, 4, 6] }));
    expect(canAccessCourseResource(9, scope)).toBe("denied");
  });

  it("student with empty enrolledCourseIds is always denied", () => {
    const scope = buildScopeContext(session({ role: "student", enrolledCourseIds: [] }));
    expect(canAccessCourseResource(1, scope)).toBe("denied");
  });

  it("student with undefined enrolledCourseIds is always denied", () => {
    const scope = buildScopeContext(session({ role: "student", enrolledCourseIds: undefined }));
    expect(canAccessCourseResource(1, scope)).toBe("denied");
  });
});

describe("canAccessCourseResource — parent scope", () => {
  it("parent Layer 3 returns allowed — enforcement deferred to Layer 2 subquery (Sprint 3 §9e)", () => {
    // For parent, canAccessCourseResource always returns "allowed" because
    // childStudentIds' enrolled course IDs are not cached in scope.
    // The parentCourseEnrollmentFilter() subquery in the query builder is the
    // enforcement mechanism. This test documents the known behaviour.
    const scope = buildScopeContext(session({ role: "parent", childStudentIds: [1, 3] }));
    expect(canAccessCourseResource(5, scope)).toBe("allowed");
  });

  it("parent with empty childStudentIds still returns allowed at Layer 3", () => {
    // Empty childStudentIds means SQL_FALSE in Layer 2, so getNoteById returns null → 404.
    // Layer 3 is never reached. This test confirms the Layer 3 contract is stable.
    const scope = buildScopeContext(session({ role: "parent", childStudentIds: [] }));
    expect(canAccessCourseResource(1, scope)).toBe("allowed");
  });
});

describe("canAccessCourseResource — guest scope", () => {
  it("guest is always denied", () => {
    const scope = buildScopeContext(session({ role: "guest" }));
    expect(canAccessCourseResource(1, scope)).toBe("denied");
  });
});
