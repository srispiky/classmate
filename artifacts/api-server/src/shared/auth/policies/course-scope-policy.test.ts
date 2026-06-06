import { describe, it, expect } from "vitest";
import { buildScopeContext, type ClassmateSession } from "../../../lib/scope-context";
import { SQL_FALSE } from "../../../lib/scope-filter";
import { CourseAuthorizationError } from "../../../lib/course-scope-validator";
import { PolicyAuthorizationError } from "../../../lib/policies/resource-scope-policy";
import { CourseScopePolicy, coursePolicy } from "./course-scope-policy";

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

function course(id: number) {
  return { id };
}

// ── singleton ─────────────────────────────────────────────────────────────────

describe("coursePolicy singleton", () => {
  it("is an instance of CourseScopePolicy", () => {
    expect(coursePolicy).toBeInstanceOf(CourseScopePolicy);
  });

  it("exposes getScopeCondition and validateAccess", () => {
    expect(typeof coursePolicy.getScopeCondition).toBe("function");
    expect(typeof coursePolicy.validateAccess).toBe("function");
  });
});

// ── getScopeCondition — Layer 2 ───────────────────────────────────────────────

describe("CourseScopePolicy.getScopeCondition — admin", () => {
  it("returns undefined (full table access)", () => {
    const scope = buildScopeContext(session({ role: "admin" }));
    expect(coursePolicy.getScopeCondition(scope)).toBeUndefined();
  });
});

describe("CourseScopePolicy.getScopeCondition — teacher", () => {
  it("returns a SQL condition (not SQL_FALSE) when teacher owns courses", () => {
    const scope = buildScopeContext(session({ role: "teacher", teacherId: 10, ownedCourseIds: [3, 7] }));
    const result = coursePolicy.getScopeCondition(scope);
    expect(result).toBeDefined();
    expect(result).not.toBe(SQL_FALSE);
  });

  it("returns SQL_FALSE when ownedCourseIds is empty", () => {
    const scope = buildScopeContext(session({ role: "teacher", teacherId: 10, ownedCourseIds: [] }));
    expect(coursePolicy.getScopeCondition(scope)).toBe(SQL_FALSE);
  });

  it("returns SQL_FALSE when ownedCourseIds is undefined (normalised to [])", () => {
    const scope = buildScopeContext(session({ role: "teacher", teacherId: 10, ownedCourseIds: undefined }));
    expect(coursePolicy.getScopeCondition(scope)).toBe(SQL_FALSE);
  });

  it("teacher does NOT receive undefined (teacher is NOT global in this policy)", () => {
    const scope = buildScopeContext(session({ role: "teacher", teacherId: 10, ownedCourseIds: [1] }));
    expect(coursePolicy.getScopeCondition(scope)).not.toBeUndefined();
  });
});

describe("CourseScopePolicy.getScopeCondition — student", () => {
  it("returns a SQL condition (not SQL_FALSE) for enrolled student", () => {
    const scope = buildScopeContext(session({ role: "student", enrolledCourseIds: [1, 3] }));
    const result = coursePolicy.getScopeCondition(scope);
    expect(result).toBeDefined();
    expect(result).not.toBe(SQL_FALSE);
  });

  it("returns SQL_FALSE for student with empty enrolledCourseIds", () => {
    const scope = buildScopeContext(session({ role: "student", enrolledCourseIds: [] }));
    expect(coursePolicy.getScopeCondition(scope)).toBe(SQL_FALSE);
  });

  it("returns SQL_FALSE for student with undefined enrolledCourseIds", () => {
    const scope = buildScopeContext(session({ role: "student", enrolledCourseIds: undefined }));
    expect(coursePolicy.getScopeCondition(scope)).toBe(SQL_FALSE);
  });
});

describe("CourseScopePolicy.getScopeCondition — parent", () => {
  it("returns a SQL condition (not SQL_FALSE) when parent has childCourseIds", () => {
    const scope = buildScopeContext(session({ role: "parent", childCourseIds: [2, 4, 6] }));
    const result = coursePolicy.getScopeCondition(scope);
    expect(result).toBeDefined();
    expect(result).not.toBe(SQL_FALSE);
  });

  it("returns SQL_FALSE when childCourseIds is empty", () => {
    const scope = buildScopeContext(session({ role: "parent", childCourseIds: [] }));
    expect(coursePolicy.getScopeCondition(scope)).toBe(SQL_FALSE);
  });

  it("returns SQL_FALSE when childCourseIds is undefined", () => {
    const scope = buildScopeContext(session({ role: "parent", childCourseIds: undefined }));
    expect(coursePolicy.getScopeCondition(scope)).toBe(SQL_FALSE);
  });
});

describe("CourseScopePolicy.getScopeCondition — guest", () => {
  it("returns SQL_FALSE", () => {
    const scope = buildScopeContext(session({ role: "guest" }));
    expect(coursePolicy.getScopeCondition(scope)).toBe(SQL_FALSE);
  });
});

// ── validateAccess — Layer 3 ──────────────────────────────────────────────────

describe("CourseScopePolicy.validateAccess — admin", () => {
  it("does not throw for any course", () => {
    const scope = buildScopeContext(session({ role: "admin" }));
    expect(() => coursePolicy.validateAccess(scope, course(1))).not.toThrow();
    expect(() => coursePolicy.validateAccess(scope, course(999))).not.toThrow();
  });
});

describe("CourseScopePolicy.validateAccess — teacher", () => {
  it("does not throw when course is in ownedCourseIds", () => {
    const scope = buildScopeContext(session({ role: "teacher", teacherId: 10, ownedCourseIds: [5, 8] }));
    expect(() => coursePolicy.validateAccess(scope, course(5))).not.toThrow();
    expect(() => coursePolicy.validateAccess(scope, course(8))).not.toThrow();
  });

  it("throws CourseAuthorizationError when course is not in ownedCourseIds", () => {
    const scope = buildScopeContext(session({ role: "teacher", teacherId: 10, ownedCourseIds: [5] }));
    expect(() => coursePolicy.validateAccess(scope, course(99))).toThrow(CourseAuthorizationError);
  });

  it("throws when ownedCourseIds is empty", () => {
    const scope = buildScopeContext(session({ role: "teacher", teacherId: 10, ownedCourseIds: [] }));
    expect(() => coursePolicy.validateAccess(scope, course(1))).toThrow(CourseAuthorizationError);
  });

  it("thrown error is also a PolicyAuthorizationError (subclass chain intact)", () => {
    const scope = buildScopeContext(session({ role: "teacher", teacherId: 10, ownedCourseIds: [] }));
    expect(() => coursePolicy.validateAccess(scope, course(1))).toThrow(PolicyAuthorizationError);
  });

  it("thrown error carries the denied courseId", () => {
    const scope = buildScopeContext(session({ role: "teacher", teacherId: 10, ownedCourseIds: [5] }));
    let err: CourseAuthorizationError | null = null;
    try {
      coursePolicy.validateAccess(scope, course(42));
    } catch (e) {
      err = e as CourseAuthorizationError;
    }
    expect(err).not.toBeNull();
    expect(err!.courseId).toBe(42);
  });
});

describe("CourseScopePolicy.validateAccess — student", () => {
  it("does not throw when course is in enrolledCourseIds", () => {
    const scope = buildScopeContext(session({ role: "student", enrolledCourseIds: [4, 6] }));
    expect(() => coursePolicy.validateAccess(scope, course(4))).not.toThrow();
    expect(() => coursePolicy.validateAccess(scope, course(6))).not.toThrow();
  });

  it("throws CourseAuthorizationError when course is not in enrolledCourseIds", () => {
    const scope = buildScopeContext(session({ role: "student", enrolledCourseIds: [4, 6] }));
    expect(() => coursePolicy.validateAccess(scope, course(9))).toThrow(CourseAuthorizationError);
  });

  it("throws when enrolledCourseIds is empty", () => {
    const scope = buildScopeContext(session({ role: "student", enrolledCourseIds: [] }));
    expect(() => coursePolicy.validateAccess(scope, course(1))).toThrow(CourseAuthorizationError);
  });
});

describe("CourseScopePolicy.validateAccess — parent", () => {
  it("does not throw when course is in childCourseIds", () => {
    const scope = buildScopeContext(session({ role: "parent", childCourseIds: [2, 5] }));
    expect(() => coursePolicy.validateAccess(scope, course(2))).not.toThrow();
  });

  it("throws CourseAuthorizationError when course is not in childCourseIds", () => {
    const scope = buildScopeContext(session({ role: "parent", childCourseIds: [2, 5] }));
    expect(() => coursePolicy.validateAccess(scope, course(8))).toThrow(CourseAuthorizationError);
  });

  it("throws when childCourseIds is empty", () => {
    const scope = buildScopeContext(session({ role: "parent", childCourseIds: [] }));
    expect(() => coursePolicy.validateAccess(scope, course(1))).toThrow(CourseAuthorizationError);
  });
});

describe("CourseScopePolicy.validateAccess — guest", () => {
  it("always throws CourseAuthorizationError", () => {
    const scope = buildScopeContext(session({ role: "guest" }));
    expect(() => coursePolicy.validateAccess(scope, course(1))).toThrow(CourseAuthorizationError);
  });
});
