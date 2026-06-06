import { describe, it, expect } from "vitest";
import { notesTable } from "@workspace/db";
import { buildScopeContext, type ClassmateSession } from "./scope-context";
import { canAccessCourse, validateCourseAccess, CourseAuthorizationError } from "./course-scope-validator";
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
  it("teacher with owned courses: 2 conditions (scope + soft-delete)", () => {
    const scope = buildScopeContext(session({ role: "teacher", ownedCourseIds: [1, 2] }));
    const conditions = buildNoteListConditions(scope, {});
    expect(conditions).toHaveLength(2);
    expect(conditions[0]).not.toBe(SQL_FALSE);
  });

  it("teacher with no courses: SQL_FALSE at position 0", () => {
    const scope = buildScopeContext(session({ role: "teacher" }));
    const conditions = buildNoteListConditions(scope, {});
    expect(conditions).toHaveLength(2);
    expect(conditions[0]).toBe(SQL_FALSE);
  });

  it("teacher with owned courses + courseId filter: 3 conditions", () => {
    const scope = buildScopeContext(session({ role: "teacher", ownedCourseIds: [7] }));
    const conditions = buildNoteListConditions(scope, { courseId: 7 });
    expect(conditions).toHaveLength(3);
    expect(conditions[0]).not.toBe(SQL_FALSE);
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
    expect(conditions).toHaveLength(3);
    expect(conditions[0]).not.toBe(SQL_FALSE);
  });
});

describe("buildNoteListConditions — parent scope", () => {
  it("adds inArray(course_id, childCourseIds) when childCourseIds is populated", () => {
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

  it("returns SQL_FALSE when childCourseIds is undefined", () => {
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

// ── Layer 3: canAccessCourse — post-fetch validation (note detail endpoint) ───
//
// getNoteById() fetches WITHOUT scope filter. The route calls validateCourseAccess()
// after the fetch as a defense-in-depth safeguard (Sprint 3 Chunk 6 Layer 3 requirement).
// These tests document the Layer 3 decision logic applied to notes.

describe("Layer 3 — admin and teacher note access", () => {
  it("admin: canAccessCourse returns true for any courseId (global access)", () => {
    const scope = buildScopeContext(session({ role: "admin" }));
    expect(canAccessCourse(scope, 5)).toBe(true);
    expect(canAccessCourse(scope, 99)).toBe(true);
  });

  it("teacher: canAccessCourse returns true for any courseId (global access)", () => {
    const scope = buildScopeContext(session({ role: "teacher" }));
    expect(canAccessCourse(scope, 3)).toBe(true);
  });

  it("admin: validateCourseAccess does not throw", () => {
    const scope = buildScopeContext(session({ role: "admin" }));
    expect(() => validateCourseAccess(scope, 42)).not.toThrow();
  });
});

describe("Layer 3 — student note detail access (enrollment-based)", () => {
  it("student accessing enrolled course note: canAccessCourse returns true → 200", () => {
    const scope = buildScopeContext(session({ role: "student", enrolledCourseIds: [2, 4, 6] }));
    expect(canAccessCourse(scope, 4)).toBe(true);
  });

  it("student IDOR — non-enrolled course note: canAccessCourse returns false → 403", () => {
    const scope = buildScopeContext(session({ role: "student", enrolledCourseIds: [2, 4, 6] }));
    expect(canAccessCourse(scope, 9)).toBe(false);
  });

  it("student IDOR — validateCourseAccess throws CourseAuthorizationError for non-enrolled note", () => {
    const scope = buildScopeContext(session({ role: "student", enrolledCourseIds: [2, 4, 6] }));
    expect(() => validateCourseAccess(scope, 9)).toThrow(CourseAuthorizationError);
  });

  it("student IDOR — incrementing note IDs: each non-enrolled course yields 403 (never 200)", () => {
    // Simulates the IDOR test: student enumerates note/100, note/101, note/102.
    // All belong to courseId=7 which the student is NOT enrolled in.
    const scope = buildScopeContext(session({ role: "student", enrolledCourseIds: [1, 2, 3] }));
    const nonEnrolledCourseId = 7;
    // Each incremented note ID would resolve to the same courseId in real data.
    // The Layer 3 check fires on courseId, not noteId — so all are denied.
    expect(canAccessCourse(scope, nonEnrolledCourseId)).toBe(false);
    expect(() => validateCourseAccess(scope, nonEnrolledCourseId)).toThrow(CourseAuthorizationError);
  });

  it("student with empty enrolledCourseIds cannot access any note detail", () => {
    const scope = buildScopeContext(session({ role: "student", enrolledCourseIds: [] }));
    expect(canAccessCourse(scope, 1)).toBe(false);
    expect(() => validateCourseAccess(scope, 1)).toThrow(CourseAuthorizationError);
  });
});

describe("Layer 3 — parent note detail access (childCourseIds-based)", () => {
  it("parent accessing child-enrolled course note: canAccessCourse returns true → 200", () => {
    const scope = buildScopeContext(
      session({ role: "parent", childCourseIds: [2, 6, 9] }),
    );
    expect(canAccessCourse(scope, 6)).toBe(true);
  });

  it("parent IDOR — non-child course note: canAccessCourse returns false → 403", () => {
    const scope = buildScopeContext(
      session({ role: "parent", childCourseIds: [2, 6, 9] }),
    );
    expect(canAccessCourse(scope, 10)).toBe(false);
  });

  it("parent IDOR — validateCourseAccess throws CourseAuthorizationError for non-child note", () => {
    const scope = buildScopeContext(
      session({ role: "parent", childCourseIds: [2, 6, 9] }),
    );
    expect(() => validateCourseAccess(scope, 10)).toThrow(CourseAuthorizationError);
  });

  it("parent IDOR — enumerating notes outside childCourseIds: all denied", () => {
    // Simulates parent incrementing note IDs. Notes belonging to courseId=15
    // (not in childCourseIds) must be denied at Layer 3.
    const scope = buildScopeContext(
      session({ role: "parent", childCourseIds: [1, 3, 5] }),
    );
    const unrelatedCourseId = 15;
    expect(canAccessCourse(scope, unrelatedCourseId)).toBe(false);
    expect(() => validateCourseAccess(scope, unrelatedCourseId)).toThrow(CourseAuthorizationError);
  });

  it("parent with empty childCourseIds cannot access any note detail", () => {
    const scope = buildScopeContext(session({ role: "parent", childCourseIds: [] }));
    expect(canAccessCourse(scope, 1)).toBe(false);
    expect(() => validateCourseAccess(scope, 1)).toThrow(CourseAuthorizationError);
  });
});

describe("Layer 3 — guest note detail access", () => {
  it("guest: canAccessCourse always returns false", () => {
    const scope = buildScopeContext(session({ role: "guest" }));
    expect(canAccessCourse(scope, 1)).toBe(false);
  });

  it("guest: validateCourseAccess always throws", () => {
    const scope = buildScopeContext(session({ role: "guest" }));
    expect(() => validateCourseAccess(scope, 1)).toThrow(CourseAuthorizationError);
  });
});

// ── Layer 2 + Layer 3 interaction documentation ───────────────────────────────
//
// For notes:
//   LIST   → Layer 2 only (buildNoteListConditions → applyCourseScopeFilter)
//   DETAIL → getNoteById(id) [no scope] → Layer 3 validateCourseAccess()
//
// This is different from Assignments/Assessments which use canAccessStudentResource
// (studentId-based ownership). Notes use canAccessCourse (courseId-based enrollment).

describe("Layer 2 + Layer 3 interaction — architectural contract", () => {
  it("student: Layer 2 hides non-enrolled notes from list (SQL_FALSE when empty)", () => {
    const scope = buildScopeContext(session({ role: "student", enrolledCourseIds: [] }));
    const conditions = buildNoteListConditions(scope, {});
    // Layer 2: student with no enrollments gets SQL_FALSE → empty result set
    expect(conditions[0]).toBe(SQL_FALSE);
  });

  it("student: Layer 3 denies direct access to non-enrolled course note", () => {
    // Even if a student bypasses the list and hits /notes/:id directly with
    // a note from courseId=99, Layer 3 catches it.
    const scope = buildScopeContext(session({ role: "student", enrolledCourseIds: [1, 2, 3] }));
    const nonEnrolledCourse = 99;
    expect(() => validateCourseAccess(scope, nonEnrolledCourse)).toThrow(CourseAuthorizationError);
  });

  it("parent: Layer 2 hides non-child courses from list (SQL_FALSE when no childCourseIds)", () => {
    const scope = buildScopeContext(session({ role: "parent", childCourseIds: [] }));
    const conditions = buildNoteListConditions(scope, {});
    expect(conditions[0]).toBe(SQL_FALSE);
  });

  it("parent: Layer 3 denies direct access to non-child course note", () => {
    const scope = buildScopeContext(session({ role: "parent", childCourseIds: [4, 5, 6] }));
    const unrelatedCourse = 99;
    expect(() => validateCourseAccess(scope, unrelatedCourse)).toThrow(CourseAuthorizationError);
  });

  it("admin: Layer 2 has no scope filter, Layer 3 always passes", () => {
    const scope = buildScopeContext(session({ role: "admin" }));
    const conditions = buildNoteListConditions(scope, {});
    // No scope condition — only deletedAt guard
    expect(conditions).toHaveLength(1);
    expect(conditions[0]).not.toBe(SQL_FALSE);
    // Layer 3: never throws
    expect(() => validateCourseAccess(scope, 999)).not.toThrow();
  });
});
