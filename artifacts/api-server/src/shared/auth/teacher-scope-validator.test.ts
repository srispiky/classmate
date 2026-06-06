import { describe, it, expect } from "vitest";
import { notesTable } from "@workspace/db";
import { buildScopeContext, type ClassmateSession } from "../../lib/scope-context";
import { SQL_FALSE } from "../../lib/scope-filter";
import { CourseAuthorizationError } from "../../lib/course-scope-validator";
import {
  canAccessCourse,
  validateCourseAccess,
  isTeacherOwnedCourse,
  applyTeacherScopeFilter,
} from "./teacher-scope-validator";

// ── helpers ──────────────────────────────────────────────────────────────────

function session(overrides: Partial<ClassmateSession> = {}): ClassmateSession {
  return {
    userId: 1,
    username: "test",
    displayName: "Test",
    role: "admin",
    studentId: undefined,
    enrolledCourseIds: undefined,
    childStudentIds: undefined,
    childCourseIds: undefined,
    teacherId: undefined,
    ownedCourseIds: undefined,
    ...overrides,
  } as ClassmateSession;
}

// ── canAccessCourse — admin ───────────────────────────────────────────────────

describe("canAccessCourse — admin", () => {
  it("returns true for any courseId", () => {
    const scope = buildScopeContext(session({ role: "admin" }));
    expect(canAccessCourse(scope, 1)).toBe(true);
    expect(canAccessCourse(scope, 99)).toBe(true);
    expect(canAccessCourse(scope, 999)).toBe(true);
  });
});

// ── canAccessCourse — teacher ─────────────────────────────────────────────────

describe("canAccessCourse — teacher", () => {
  it("returns true for an owned course", () => {
    const scope = buildScopeContext(session({ role: "teacher", teacherId: 10, ownedCourseIds: [3, 7, 12] }));
    expect(canAccessCourse(scope, 3)).toBe(true);
    expect(canAccessCourse(scope, 7)).toBe(true);
    expect(canAccessCourse(scope, 12)).toBe(true);
  });

  it("returns false for a non-owned course", () => {
    const scope = buildScopeContext(session({ role: "teacher", teacherId: 10, ownedCourseIds: [3, 7] }));
    expect(canAccessCourse(scope, 1)).toBe(false);
    expect(canAccessCourse(scope, 99)).toBe(false);
  });

  it("returns false when ownedCourseIds is empty", () => {
    const scope = buildScopeContext(session({ role: "teacher", teacherId: 10, ownedCourseIds: [] }));
    expect(canAccessCourse(scope, 1)).toBe(false);
  });

  it("returns false when ownedCourseIds is undefined (normalised to [])", () => {
    const scope = buildScopeContext(session({ role: "teacher", teacherId: 10, ownedCourseIds: undefined }));
    expect(canAccessCourse(scope, 1)).toBe(false);
  });

  it("handles duplicate courseIds in ownedCourseIds correctly", () => {
    const scope = buildScopeContext(session({ role: "teacher", teacherId: 10, ownedCourseIds: [5, 5, 9] }));
    expect(canAccessCourse(scope, 5)).toBe(true);
    expect(canAccessCourse(scope, 9)).toBe(true);
    expect(canAccessCourse(scope, 4)).toBe(false);
  });
});

// ── canAccessCourse — student ─────────────────────────────────────────────────

describe("canAccessCourse — student", () => {
  it("returns true for an enrolled course", () => {
    const scope = buildScopeContext(session({ role: "student", enrolledCourseIds: [2, 5, 8] }));
    expect(canAccessCourse(scope, 2)).toBe(true);
    expect(canAccessCourse(scope, 5)).toBe(true);
    expect(canAccessCourse(scope, 8)).toBe(true);
  });

  it("returns false for a non-enrolled course", () => {
    const scope = buildScopeContext(session({ role: "student", enrolledCourseIds: [2, 5, 8] }));
    expect(canAccessCourse(scope, 1)).toBe(false);
    expect(canAccessCourse(scope, 9)).toBe(false);
  });

  it("returns false when enrolledCourseIds is empty", () => {
    const scope = buildScopeContext(session({ role: "student", enrolledCourseIds: [] }));
    expect(canAccessCourse(scope, 1)).toBe(false);
  });

  it("returns false when enrolledCourseIds is undefined (normalised to [])", () => {
    const scope = buildScopeContext(session({ role: "student", enrolledCourseIds: undefined }));
    expect(canAccessCourse(scope, 1)).toBe(false);
  });

  it("handles duplicate courseIds in enrolledCourseIds", () => {
    const scope = buildScopeContext(session({ role: "student", enrolledCourseIds: [3, 3, 5] }));
    expect(canAccessCourse(scope, 3)).toBe(true);
    expect(canAccessCourse(scope, 5)).toBe(true);
    expect(canAccessCourse(scope, 4)).toBe(false);
  });
});

// ── canAccessCourse — parent ──────────────────────────────────────────────────

describe("canAccessCourse — parent", () => {
  it("returns true when courseId is in childCourseIds", () => {
    const scope = buildScopeContext(session({ role: "parent", childStudentIds: [1], childCourseIds: [3, 7, 11] }));
    expect(canAccessCourse(scope, 3)).toBe(true);
    expect(canAccessCourse(scope, 7)).toBe(true);
    expect(canAccessCourse(scope, 11)).toBe(true);
  });

  it("returns false when courseId is not in childCourseIds", () => {
    const scope = buildScopeContext(session({ role: "parent", childStudentIds: [1], childCourseIds: [3, 7] }));
    expect(canAccessCourse(scope, 1)).toBe(false);
    expect(canAccessCourse(scope, 10)).toBe(false);
  });

  it("returns false when childCourseIds is empty", () => {
    const scope = buildScopeContext(session({ role: "parent", childStudentIds: [2], childCourseIds: [] }));
    expect(canAccessCourse(scope, 1)).toBe(false);
  });

  it("returns false when childCourseIds is undefined (normalised to [])", () => {
    const scope = buildScopeContext(session({ role: "parent", childStudentIds: [2], childCourseIds: undefined }));
    expect(canAccessCourse(scope, 1)).toBe(false);
  });

  it("handles duplicate courseIds in childCourseIds", () => {
    const scope = buildScopeContext(session({ role: "parent", childCourseIds: [5, 5, 9] }));
    expect(canAccessCourse(scope, 5)).toBe(true);
    expect(canAccessCourse(scope, 9)).toBe(true);
    expect(canAccessCourse(scope, 1)).toBe(false);
  });
});

// ── canAccessCourse — guest / other roles ─────────────────────────────────────

describe("canAccessCourse — guest and other roles", () => {
  it("returns false for guest", () => {
    const scope = buildScopeContext(session({ role: "guest" }));
    expect(canAccessCourse(scope, 1)).toBe(false);
    expect(canAccessCourse(scope, 99)).toBe(false);
  });
});

// ── validateCourseAccess ──────────────────────────────────────────────────────

describe("validateCourseAccess", () => {
  it("does not throw when admin accesses any course", () => {
    const scope = buildScopeContext(session({ role: "admin" }));
    expect(() => validateCourseAccess(scope, 42)).not.toThrow();
  });

  it("does not throw when teacher accesses an owned course", () => {
    const scope = buildScopeContext(session({ role: "teacher", teacherId: 10, ownedCourseIds: [5, 8] }));
    expect(() => validateCourseAccess(scope, 5)).not.toThrow();
    expect(() => validateCourseAccess(scope, 8)).not.toThrow();
  });

  it("throws CourseAuthorizationError when teacher accesses a non-owned course", () => {
    const scope = buildScopeContext(session({ role: "teacher", teacherId: 10, ownedCourseIds: [5] }));
    expect(() => validateCourseAccess(scope, 99)).toThrow(CourseAuthorizationError);
  });

  it("does not throw when student accesses enrolled course", () => {
    const scope = buildScopeContext(session({ role: "student", enrolledCourseIds: [4, 6] }));
    expect(() => validateCourseAccess(scope, 4)).not.toThrow();
  });

  it("throws CourseAuthorizationError when student accesses non-enrolled course", () => {
    const scope = buildScopeContext(session({ role: "student", enrolledCourseIds: [4, 6] }));
    expect(() => validateCourseAccess(scope, 9)).toThrow(CourseAuthorizationError);
  });

  it("does not throw when parent accesses a child course", () => {
    const scope = buildScopeContext(session({ role: "parent", childCourseIds: [2, 5] }));
    expect(() => validateCourseAccess(scope, 2)).not.toThrow();
  });

  it("throws CourseAuthorizationError when parent accesses non-child course", () => {
    const scope = buildScopeContext(session({ role: "parent", childCourseIds: [2, 5] }));
    expect(() => validateCourseAccess(scope, 8)).toThrow(CourseAuthorizationError);
  });

  it("throws CourseAuthorizationError for guest", () => {
    const scope = buildScopeContext(session({ role: "guest" }));
    expect(() => validateCourseAccess(scope, 1)).toThrow(CourseAuthorizationError);
  });

  it("thrown error carries the denied courseId and correct name", () => {
    const scope = buildScopeContext(session({ role: "teacher", teacherId: 10, ownedCourseIds: [] }));
    let err: CourseAuthorizationError | null = null;
    try {
      validateCourseAccess(scope, 13);
    } catch (e) {
      err = e as CourseAuthorizationError;
    }
    expect(err).not.toBeNull();
    expect(err!.courseId).toBe(13);
    expect(err!.name).toBe("CourseAuthorizationError");
  });
});

// ── isTeacherOwnedCourse ──────────────────────────────────────────────────────

describe("isTeacherOwnedCourse — admin", () => {
  it("returns true for any course (admin acts on any teacher-owned resource)", () => {
    const scope = buildScopeContext(session({ role: "admin" }));
    expect(isTeacherOwnedCourse(scope, 1)).toBe(true);
    expect(isTeacherOwnedCourse(scope, 99)).toBe(true);
  });
});

describe("isTeacherOwnedCourse — teacher", () => {
  it("returns true for an owned course", () => {
    const scope = buildScopeContext(session({ role: "teacher", teacherId: 10, ownedCourseIds: [3, 8] }));
    expect(isTeacherOwnedCourse(scope, 3)).toBe(true);
    expect(isTeacherOwnedCourse(scope, 8)).toBe(true);
  });

  it("returns false for a non-owned course", () => {
    const scope = buildScopeContext(session({ role: "teacher", teacherId: 10, ownedCourseIds: [3] }));
    expect(isTeacherOwnedCourse(scope, 99)).toBe(false);
  });

  it("returns false when ownedCourseIds is empty", () => {
    const scope = buildScopeContext(session({ role: "teacher", teacherId: 10, ownedCourseIds: [] }));
    expect(isTeacherOwnedCourse(scope, 1)).toBe(false);
  });
});

describe("isTeacherOwnedCourse — student", () => {
  it("returns false regardless of enrolledCourseIds", () => {
    const scope = buildScopeContext(session({ role: "student", enrolledCourseIds: [1, 2, 3] }));
    expect(isTeacherOwnedCourse(scope, 1)).toBe(false);
    expect(isTeacherOwnedCourse(scope, 99)).toBe(false);
  });
});

describe("isTeacherOwnedCourse — parent", () => {
  it("returns false regardless of childCourseIds", () => {
    const scope = buildScopeContext(session({ role: "parent", childCourseIds: [5, 6] }));
    expect(isTeacherOwnedCourse(scope, 5)).toBe(false);
    expect(isTeacherOwnedCourse(scope, 99)).toBe(false);
  });
});

describe("isTeacherOwnedCourse — guest", () => {
  it("returns false", () => {
    const scope = buildScopeContext(session({ role: "guest" }));
    expect(isTeacherOwnedCourse(scope, 1)).toBe(false);
  });
});

// ── applyTeacherScopeFilter ───────────────────────────────────────────────────

describe("applyTeacherScopeFilter — admin", () => {
  it("returns undefined (no filter — full table access)", () => {
    const scope = buildScopeContext(session({ role: "admin" }));
    expect(applyTeacherScopeFilter(notesTable.courseId, scope)).toBeUndefined();
  });
});

describe("applyTeacherScopeFilter — teacher", () => {
  it("returns a SQL condition (not SQL_FALSE) when teacher owns courses", () => {
    const scope = buildScopeContext(session({ role: "teacher", teacherId: 10, ownedCourseIds: [1, 3] }));
    const result = applyTeacherScopeFilter(notesTable.courseId, scope);
    expect(result).toBeDefined();
    expect(result).not.toBe(SQL_FALSE);
  });

  it("returns SQL_FALSE when ownedCourseIds is empty", () => {
    const scope = buildScopeContext(session({ role: "teacher", teacherId: 10, ownedCourseIds: [] }));
    expect(applyTeacherScopeFilter(notesTable.courseId, scope)).toBe(SQL_FALSE);
  });

  it("returns SQL_FALSE when ownedCourseIds is undefined (normalised to [])", () => {
    const scope = buildScopeContext(session({ role: "teacher", teacherId: 10, ownedCourseIds: undefined }));
    expect(applyTeacherScopeFilter(notesTable.courseId, scope)).toBe(SQL_FALSE);
  });
});

describe("applyTeacherScopeFilter — student", () => {
  it("returns a SQL condition (not SQL_FALSE) for enrolled student", () => {
    const scope = buildScopeContext(session({ role: "student", enrolledCourseIds: [1, 3] }));
    const result = applyTeacherScopeFilter(notesTable.courseId, scope);
    expect(result).toBeDefined();
    expect(result).not.toBe(SQL_FALSE);
  });

  it("returns SQL_FALSE for student with empty enrolledCourseIds", () => {
    const scope = buildScopeContext(session({ role: "student", enrolledCourseIds: [] }));
    expect(applyTeacherScopeFilter(notesTable.courseId, scope)).toBe(SQL_FALSE);
  });

  it("returns SQL_FALSE for student with undefined enrolledCourseIds", () => {
    const scope = buildScopeContext(session({ role: "student", enrolledCourseIds: undefined }));
    expect(applyTeacherScopeFilter(notesTable.courseId, scope)).toBe(SQL_FALSE);
  });
});

describe("applyTeacherScopeFilter — parent", () => {
  it("returns a SQL condition (not SQL_FALSE) when parent has childCourseIds", () => {
    const scope = buildScopeContext(session({ role: "parent", childCourseIds: [2, 4, 6] }));
    const result = applyTeacherScopeFilter(notesTable.courseId, scope);
    expect(result).toBeDefined();
    expect(result).not.toBe(SQL_FALSE);
  });

  it("returns SQL_FALSE when parent has empty childCourseIds", () => {
    const scope = buildScopeContext(session({ role: "parent", childCourseIds: [] }));
    expect(applyTeacherScopeFilter(notesTable.courseId, scope)).toBe(SQL_FALSE);
  });

  it("returns SQL_FALSE when parent has undefined childCourseIds", () => {
    const scope = buildScopeContext(session({ role: "parent", childCourseIds: undefined }));
    expect(applyTeacherScopeFilter(notesTable.courseId, scope)).toBe(SQL_FALSE);
  });
});

describe("applyTeacherScopeFilter — guest", () => {
  it("returns SQL_FALSE", () => {
    const scope = buildScopeContext(session({ role: "guest" }));
    expect(applyTeacherScopeFilter(notesTable.courseId, scope)).toBe(SQL_FALSE);
  });
});
