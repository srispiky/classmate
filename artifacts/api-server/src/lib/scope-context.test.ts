import { describe, it, expect } from "vitest";
import { buildScopeContext, type ClassmateSession } from "./scope-context";

function makeSession(overrides: Partial<ClassmateSession>): ClassmateSession {
  return {
    userId: 1,
    role: "admin",
    permissions: [],
    permissionsVersion: 0,
    ...overrides,
  };
}

describe("buildScopeContext", () => {
  it("student session — sets studentId, enrolledCourseIds, isGlobal=false", () => {
    const session = makeSession({
      role: "student",
      studentId: 5,
      enrolledCourseIds: [1, 3],
    });

    const scope = buildScopeContext(session);

    expect(scope.role).toBe("student");
    expect(scope.isGlobal).toBe(false);
    expect(scope.studentId).toBe(5);
    expect(scope.enrolledCourseIds).toEqual([1, 3]);
    expect(scope.childStudentIds).toEqual([]);
    expect(scope.userId).toBe(1);
  });

  it("parent session — sets childStudentIds, isGlobal=false, clears student fields", () => {
    const session = makeSession({
      role: "parent",
      childStudentIds: [7, 12],
    });

    const scope = buildScopeContext(session);

    expect(scope.role).toBe("parent");
    expect(scope.isGlobal).toBe(false);
    expect(scope.studentId).toBeNull();
    expect(scope.enrolledCourseIds).toEqual([]);
    expect(scope.childStudentIds).toEqual([7, 12]);
    expect(scope.userId).toBe(1);
  });

  it("teacher session — isGlobal=true, all scoped arrays empty", () => {
    const session = makeSession({ role: "teacher" });

    const scope = buildScopeContext(session);

    expect(scope.role).toBe("teacher");
    expect(scope.isGlobal).toBe(true);
    expect(scope.studentId).toBeNull();
    expect(scope.enrolledCourseIds).toEqual([]);
    expect(scope.childStudentIds).toEqual([]);
    expect(scope.userId).toBe(1);
  });

  it("admin session — isGlobal=true, all scoped arrays empty", () => {
    const session = makeSession({ role: "admin", userId: 99 });

    const scope = buildScopeContext(session);

    expect(scope.role).toBe("admin");
    expect(scope.isGlobal).toBe(true);
    expect(scope.studentId).toBeNull();
    expect(scope.enrolledCourseIds).toEqual([]);
    expect(scope.childStudentIds).toEqual([]);
    expect(scope.userId).toBe(99);
  });

  it("missing studentId — unlinked student account returns studentId=null", () => {
    const session = makeSession({
      role: "student",
      // studentId intentionally absent — account not yet linked by admin
      enrolledCourseIds: [],
    });

    const scope = buildScopeContext(session);

    expect(scope.studentId).toBeNull();
    expect(scope.enrolledCourseIds).toEqual([]);
    expect(scope.isGlobal).toBe(false);
  });

  it("empty childStudentIds — parent with no linked children", () => {
    const session = makeSession({
      role: "parent",
      childStudentIds: [],
    });

    const scope = buildScopeContext(session);

    expect(scope.childStudentIds).toEqual([]);
    expect(scope.isGlobal).toBe(false);
    expect(scope.studentId).toBeNull();
  });

  it("empty enrolledCourseIds — student enrolled in zero courses", () => {
    const session = makeSession({
      role: "student",
      studentId: 8,
      enrolledCourseIds: [],
    });

    const scope = buildScopeContext(session);

    expect(scope.studentId).toBe(8);
    expect(scope.enrolledCourseIds).toEqual([]);
    expect(scope.isGlobal).toBe(false);
  });
});
