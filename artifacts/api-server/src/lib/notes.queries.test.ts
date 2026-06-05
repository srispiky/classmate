import { describe, it, expect } from "vitest";
import { notesTable } from "@workspace/db";
import { buildScopeContext, type ClassmateSession } from "./scope-context";
import { canAccessCourse } from "./course-scope-validator";
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
    childCourseIds: undefined,
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

  it("courseId filter applied even for non-enrolled course — AND produces zero rows (correct)", () => {
    const scope = buildScopeContext(session({ role: "student", enrolledCourseIds: [2, 4] }));
    const conditions = buildNoteListConditions(scope, { courseId: 9 });
    // [inArray(courseId, [2,4]), eq(courseId, 9), isNull(deletedAt)] — impossible AND, zero rows
    expect(conditions).toHaveLength(3);
    expect(conditions[0]).not.toBe(SQL_FALSE);
  });
});

describe("buildNoteListConditions — parent scope", () => {
  it("adds inArray(course_id, childCourseIds) when childCourseIds is populated", () => {
    // Parent scope now uses pre-computed childCourseIds (Sprint 3 §9e).
    // No subquery at query time — childCourseIds was resolved by SessionEnricher at login.
    const scope = buildScopeContext(
      session({ role: "parent", childStudentIds: [2, 5], childCourseIds: [1, 3, 7] }),
    );
    const conditions = buildNoteListConditions(scope, {});
    // [inArray(courseId, [1,3,7]), isNull(deletedAt)]
    expect(conditions).toHaveLength(2);
    expect(conditions[0]).not.toBe(SQL_FALSE);
  });

  it("returns SQL_FALSE when childCourseIds is empty", () => {
    const scope = buildScopeContext(
      session({ role: "parent", childStudentIds: [3], childCourseIds: [] }),
    );
    const conditions = buildNoteListConditions(scope, {});
    expect(conditions).toHaveLength(2);
    expect(conditions[0]).toBe(SQL_FALSE);
  });

  it("returns SQL_FALSE when childCourseIds is undefined (no children or unlinked parent)", () => {
    const scope = buildScopeContext(
      session({ role: "parent", childStudentIds: [3], childCourseIds: undefined }),
    );
    const conditions = buildNoteListConditions(scope, {});
    expect(conditions).toHaveLength(2);
    expect(conditions[0]).toBe(SQL_FALSE);
  });

  it("returns SQL_FALSE when both childStudentIds and childCourseIds are absent", () => {
    const scope = buildScopeContext(session({ role: "parent" }));
    const conditions = buildNoteListConditions(scope, {});
    expect(conditions).toHaveLength(2);
    expect(conditions[0]).toBe(SQL_FALSE);
  });

  it("applies courseId filter alongside inArray scope condition", () => {
    const scope = buildScopeContext(
      session({ role: "parent", childCourseIds: [3, 5] }),
    );
    const conditions = buildNoteListConditions(scope, { courseId: 3 });
    // [inArray(courseId, [3,5]), eq(courseId, 3), isNull(deletedAt)]
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

// ── canAccessCourse — Layer 3 ownership (note context) ───────────────────────

describe("canAccessCourse — admin and teacher (note context)", () => {
  it("admin can access any note regardless of course_id", () => {
    const scope = buildScopeContext(session({ role: "admin" }));
    expect(canAccessCourse(scope, 5)).toBe(true);
    expect(canAccessCourse(scope, 99)).toBe(true);
  });

  it("teacher can access any note regardless of course_id", () => {
    const scope = buildScopeContext(session({ role: "teacher" }));
    expect(canAccessCourse(scope, 3)).toBe(true);
  });
});

describe("canAccessCourse — student enrollment-based access (note context)", () => {
  it("student can access note from enrolled course", () => {
    const scope = buildScopeContext(session({ role: "student", enrolledCourseIds: [2, 4, 6] }));
    expect(canAccessCourse(scope, 4)).toBe(true);
  });

  it("student CANNOT access note from non-enrolled course (IDOR denied)", () => {
    const scope = buildScopeContext(session({ role: "student", enrolledCourseIds: [2, 4, 6] }));
    expect(canAccessCourse(scope, 9)).toBe(false);
  });

  it("student with empty enrolledCourseIds cannot access any note", () => {
    const scope = buildScopeContext(session({ role: "student", enrolledCourseIds: [] }));
    expect(canAccessCourse(scope, 1)).toBe(false);
  });
});

describe("canAccessCourse — parent childCourseIds (note context)", () => {
  it("parent can access note from a child-enrolled course", () => {
    const scope = buildScopeContext(
      session({ role: "parent", childCourseIds: [2, 6, 9] }),
    );
    expect(canAccessCourse(scope, 6)).toBe(true);
  });

  it("parent CANNOT access note from a non-child course (IDOR denied)", () => {
    const scope = buildScopeContext(
      session({ role: "parent", childCourseIds: [2, 6, 9] }),
    );
    expect(canAccessCourse(scope, 10)).toBe(false);
  });

  it("parent with empty childCourseIds cannot access any note", () => {
    const scope = buildScopeContext(session({ role: "parent", childCourseIds: [] }));
    expect(canAccessCourse(scope, 1)).toBe(false);
  });
});

describe("canAccessCourse — guest (note context)", () => {
  it("guest is always denied", () => {
    const scope = buildScopeContext(session({ role: "guest" }));
    expect(canAccessCourse(scope, 1)).toBe(false);
  });
});
