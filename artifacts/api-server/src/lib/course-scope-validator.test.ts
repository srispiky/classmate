import { describe, it, expect } from "vitest";
import { notesTable } from "@workspace/db";
import { buildScopeContext, type ClassmateSession } from "./scope-context";
import { SQL_FALSE } from "./scope-filter";
import {
  canAccessCourse,
  validateCourseAccess,
  applyCourseScopeFilter,
  CourseAuthorizationError,
} from "./course-scope-validator";

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
  it("returns true for any courseId", () => {
    const scope = buildScopeContext(session({ role: "teacher" }));
    expect(canAccessCourse(scope, 5)).toBe(true);
    expect(canAccessCourse(scope, 0)).toBe(true);
  });
});

// ── canAccessCourse — student ─────────────────────────────────────────────────

describe("canAccessCourse — student enrolled courses", () => {
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

  it("handles duplicate courseIds correctly (set membership, not indexOf)", () => {
    const scope = buildScopeContext(
      session({ role: "student", enrolledCourseIds: [3, 3, 5] }),
    );
    expect(canAccessCourse(scope, 3)).toBe(true);
    expect(canAccessCourse(scope, 5)).toBe(true);
    expect(canAccessCourse(scope, 4)).toBe(false);
  });
});

// ── canAccessCourse — parent ──────────────────────────────────────────────────

describe("canAccessCourse — parent childCourseIds", () => {
  it("returns true when courseId is in childCourseIds", () => {
    const scope = buildScopeContext(
      session({ role: "parent", childStudentIds: [1], childCourseIds: [3, 7, 11] }),
    );
    expect(canAccessCourse(scope, 3)).toBe(true);
    expect(canAccessCourse(scope, 7)).toBe(true);
    expect(canAccessCourse(scope, 11)).toBe(true);
  });

  it("returns false when courseId is not in childCourseIds", () => {
    const scope = buildScopeContext(
      session({ role: "parent", childStudentIds: [1], childCourseIds: [3, 7] }),
    );
    expect(canAccessCourse(scope, 1)).toBe(false);
    expect(canAccessCourse(scope, 10)).toBe(false);
  });

  it("returns false when childCourseIds is empty", () => {
    const scope = buildScopeContext(
      session({ role: "parent", childStudentIds: [2], childCourseIds: [] }),
    );
    expect(canAccessCourse(scope, 1)).toBe(false);
  });

  it("returns false when childCourseIds is undefined (normalised to [])", () => {
    const scope = buildScopeContext(
      session({ role: "parent", childStudentIds: [2], childCourseIds: undefined }),
    );
    expect(canAccessCourse(scope, 1)).toBe(false);
  });

  it("handles duplicate courseIds in childCourseIds (deduplicated at enrichment time, still works)", () => {
    const scope = buildScopeContext(
      session({ role: "parent", childCourseIds: [5, 5, 9] }),
    );
    expect(canAccessCourse(scope, 5)).toBe(true);
    expect(canAccessCourse(scope, 9)).toBe(true);
    expect(canAccessCourse(scope, 1)).toBe(false);
  });
});

// ── canAccessCourse — guest / unknown roles ───────────────────────────────────

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

  it("does not throw when teacher accesses any course", () => {
    const scope = buildScopeContext(session({ role: "teacher" }));
    expect(() => validateCourseAccess(scope, 7)).not.toThrow();
  });

  it("does not throw when student accesses enrolled course", () => {
    const scope = buildScopeContext(session({ role: "student", enrolledCourseIds: [4, 6] }));
    expect(() => validateCourseAccess(scope, 4)).not.toThrow();
  });

  it("throws CourseAuthorizationError when student accesses non-enrolled course", () => {
    const scope = buildScopeContext(session({ role: "student", enrolledCourseIds: [4, 6] }));
    expect(() => validateCourseAccess(scope, 9)).toThrow(CourseAuthorizationError);
  });

  it("throws CourseAuthorizationError when parent accesses non-child course", () => {
    const scope = buildScopeContext(
      session({ role: "parent", childCourseIds: [2, 5] }),
    );
    expect(() => validateCourseAccess(scope, 8)).toThrow(CourseAuthorizationError);
  });

  it("thrown error carries the denied courseId", () => {
    const scope = buildScopeContext(session({ role: "student", enrolledCourseIds: [] }));
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

  it("throws CourseAuthorizationError for guest", () => {
    const scope = buildScopeContext(session({ role: "guest" }));
    expect(() => validateCourseAccess(scope, 1)).toThrow(CourseAuthorizationError);
  });
});

// ── applyCourseScopeFilter — Layer 2 WHERE condition builder ─────────────────

describe("applyCourseScopeFilter — admin", () => {
  it("returns undefined for admin (no filter)", () => {
    const scope = buildScopeContext(session({ role: "admin" }));
    expect(applyCourseScopeFilter(notesTable.courseId, scope)).toBeUndefined();
  });
});

describe("applyCourseScopeFilter — teacher", () => {
  it("returns undefined for teacher (no filter)", () => {
    const scope = buildScopeContext(session({ role: "teacher" }));
    expect(applyCourseScopeFilter(notesTable.courseId, scope)).toBeUndefined();
  });
});

describe("applyCourseScopeFilter — student", () => {
  it("returns a SQL condition (not SQL_FALSE) for enrolled student", () => {
    const scope = buildScopeContext(session({ role: "student", enrolledCourseIds: [1, 3] }));
    const result = applyCourseScopeFilter(notesTable.courseId, scope);
    expect(result).toBeDefined();
    expect(result).not.toBe(SQL_FALSE);
  });

  it("returns SQL_FALSE for student with empty enrolledCourseIds", () => {
    const scope = buildScopeContext(session({ role: "student", enrolledCourseIds: [] }));
    expect(applyCourseScopeFilter(notesTable.courseId, scope)).toBe(SQL_FALSE);
  });
});

describe("applyCourseScopeFilter — parent", () => {
  it("returns a SQL condition (not SQL_FALSE) when parent has childCourseIds", () => {
    const scope = buildScopeContext(
      session({ role: "parent", childCourseIds: [2, 4, 6] }),
    );
    const result = applyCourseScopeFilter(notesTable.courseId, scope);
    expect(result).toBeDefined();
    expect(result).not.toBe(SQL_FALSE);
  });

  it("returns SQL_FALSE when parent has empty childCourseIds", () => {
    const scope = buildScopeContext(session({ role: "parent", childCourseIds: [] }));
    expect(applyCourseScopeFilter(notesTable.courseId, scope)).toBe(SQL_FALSE);
  });

  it("returns SQL_FALSE when parent has undefined childCourseIds", () => {
    const scope = buildScopeContext(session({ role: "parent", childCourseIds: undefined }));
    expect(applyCourseScopeFilter(notesTable.courseId, scope)).toBe(SQL_FALSE);
  });
});

describe("applyCourseScopeFilter — guest", () => {
  it("returns SQL_FALSE for guest", () => {
    const scope = buildScopeContext(session({ role: "guest" }));
    expect(applyCourseScopeFilter(notesTable.courseId, scope)).toBe(SQL_FALSE);
  });
});
