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
    expect(scope.childCourseIds).toEqual([]);
    expect(scope.userId).toBe(1);
  });

  it("parent session — sets childStudentIds and childCourseIds, isGlobal=false, clears student fields", () => {
    const session = makeSession({
      role: "parent",
      childStudentIds: [7, 12],
      childCourseIds: [2, 5, 9],
    });

    const scope = buildScopeContext(session);

    expect(scope.role).toBe("parent");
    expect(scope.isGlobal).toBe(false);
    expect(scope.studentId).toBeNull();
    expect(scope.enrolledCourseIds).toEqual([]);
    expect(scope.childStudentIds).toEqual([7, 12]);
    expect(scope.childCourseIds).toEqual([2, 5, 9]);
    expect(scope.userId).toBe(1);
  });

  it("parent session — childCourseIds undefined normalises to []", () => {
    const session = makeSession({
      role: "parent",
      childStudentIds: [7],
      // childCourseIds intentionally absent — enrichment may not have populated it yet
    });

    const scope = buildScopeContext(session);

    expect(scope.childStudentIds).toEqual([7]);
    expect(scope.childCourseIds).toEqual([]);
  });

  it("teacher session — isGlobal=true, all scoped arrays empty, teacherId/ownedCourseIds null/[]", () => {
    const session = makeSession({ role: "teacher" });

    const scope = buildScopeContext(session);

    expect(scope.role).toBe("teacher");
    expect(scope.isGlobal).toBe(true);
    expect(scope.studentId).toBeNull();
    expect(scope.enrolledCourseIds).toEqual([]);
    expect(scope.childStudentIds).toEqual([]);
    expect(scope.childCourseIds).toEqual([]);
    expect(scope.teacherId).toBeNull();
    expect(scope.ownedCourseIds).toEqual([]);
    expect(scope.userId).toBe(1);
  });

  it("teacher session — teacherId populated from session", () => {
    const session = makeSession({ role: "teacher", teacherId: 42 });

    const scope = buildScopeContext(session);

    expect(scope.teacherId).toBe(42);
    expect(scope.ownedCourseIds).toEqual([]);
  });

  it("teacher session — ownedCourseIds populated from session", () => {
    const session = makeSession({ role: "teacher", teacherId: 7, ownedCourseIds: [1, 3, 5] });

    const scope = buildScopeContext(session);

    expect(scope.teacherId).toBe(7);
    expect(scope.ownedCourseIds).toEqual([1, 3, 5]);
  });

  it("teacher session — ownedCourseIds undefined in session normalises to []", () => {
    const session = makeSession({ role: "teacher", teacherId: 7, ownedCourseIds: undefined });

    const scope = buildScopeContext(session);

    expect(scope.ownedCourseIds).toEqual([]);
  });

  it("teacher session — teacherId undefined in session normalises to null", () => {
    const session = makeSession({ role: "teacher", teacherId: undefined });

    const scope = buildScopeContext(session);

    expect(scope.teacherId).toBeNull();
  });

  it("admin session — isGlobal=true, all scoped arrays empty, no teacher fields", () => {
    const session = makeSession({ role: "admin", userId: 99 });

    const scope = buildScopeContext(session);

    expect(scope.role).toBe("admin");
    expect(scope.isGlobal).toBe(true);
    expect(scope.studentId).toBeNull();
    expect(scope.enrolledCourseIds).toEqual([]);
    expect(scope.childStudentIds).toEqual([]);
    expect(scope.childCourseIds).toEqual([]);
    expect(scope.teacherId).toBeNull();
    expect(scope.ownedCourseIds).toEqual([]);
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
    expect(scope.childCourseIds).toEqual([]);
    expect(scope.isGlobal).toBe(false);
  });

  it("empty childStudentIds — parent with no linked children", () => {
    const session = makeSession({
      role: "parent",
      childStudentIds: [],
      childCourseIds: [],
    });

    const scope = buildScopeContext(session);

    expect(scope.childStudentIds).toEqual([]);
    expect(scope.childCourseIds).toEqual([]);
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
    expect(scope.childCourseIds).toEqual([]);
    expect(scope.isGlobal).toBe(false);
  });

  it("student session — childCourseIds always [] regardless of session value", () => {
    // childCourseIds is only populated for parent role — ignored for other roles
    const session = makeSession({
      role: "student",
      studentId: 3,
      enrolledCourseIds: [1],
      childCourseIds: [99], // should be ignored
    });

    const scope = buildScopeContext(session);

    expect(scope.childCourseIds).toEqual([]);
  });

  it("non-teacher roles — teacherId always null, ownedCourseIds always []", () => {
    const roles = ["admin", "student", "parent", "guest"] as const;
    roles.forEach((role) => {
      const session = makeSession({ role, teacherId: 99, ownedCourseIds: [1, 2] });
      const scope = buildScopeContext(session);
      expect(scope.teacherId).toBeNull();
      expect(scope.ownedCourseIds).toEqual([]);
    });
  });
});
