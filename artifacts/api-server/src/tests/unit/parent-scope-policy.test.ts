import { describe, it, expect } from "vitest";
import { ParentScopePolicy } from "../../lib/policies/parent-scope-policy";
import { PolicyAuthorizationError } from "../../lib/policies/resource-scope-policy";
import { SQL_FALSE } from "../../lib/scope-filter";
import type { ScopeContext } from "../../lib/scope-context";

function makeScope(overrides: Partial<ScopeContext> = {}): ScopeContext {
  return {
    role: "parent",
    isGlobal: false,
    studentId: null,
    enrolledCourseIds: [],
    childStudentIds: [10, 20, 30],
    childCourseIds: [100, 200],
    teacherId: null,
    ownedCourseIds: [],
    userId: 999,
    ...overrides,
  };
}

const policy = new ParentScopePolicy();

describe("ParentScopePolicy — getScopeCondition", () => {
  it("returns a SQL condition for a parent with linked children", () => {
    const scope = makeScope({ childStudentIds: [1, 2, 3] });
    const sql = policy.getScopeCondition(scope);
    expect(sql).toBeDefined();
    expect(sql).not.toBeNull();
  });

  it("returns SQL_FALSE when parent has no linked children", () => {
    const scope = makeScope({ childStudentIds: [] });
    const sql = policy.getScopeCondition(scope);
    expect(sql).toBe(SQL_FALSE);
  });

  it("returns SQL_FALSE for admin role", () => {
    const scope = makeScope({ role: "admin", childStudentIds: [1] });
    const sql = policy.getScopeCondition(scope);
    expect(sql).toBe(SQL_FALSE);
  });

  it("returns SQL_FALSE for teacher role", () => {
    const scope = makeScope({ role: "teacher", childStudentIds: [1] });
    const sql = policy.getScopeCondition(scope);
    expect(sql).toBe(SQL_FALSE);
  });

  it("returns SQL_FALSE for student role", () => {
    const scope = makeScope({ role: "student", childStudentIds: [1] });
    const sql = policy.getScopeCondition(scope);
    expect(sql).toBe(SQL_FALSE);
  });
});

describe("ParentScopePolicy — validateAccess", () => {
  it("allows access when student is in childStudentIds", () => {
    const scope = makeScope({ childStudentIds: [10, 20, 30] });
    expect(() => policy.validateAccess(scope, { id: 10 })).not.toThrow();
    expect(() => policy.validateAccess(scope, { id: 20 })).not.toThrow();
    expect(() => policy.validateAccess(scope, { id: 30 })).not.toThrow();
  });

  it("throws PolicyAuthorizationError when student is not linked to parent", () => {
    const scope = makeScope({ childStudentIds: [10, 20] });
    expect(() => policy.validateAccess(scope, { id: 99 })).toThrow(PolicyAuthorizationError);
  });

  it("throws PolicyAuthorizationError for admin role", () => {
    const scope = makeScope({ role: "admin", childStudentIds: [10] });
    expect(() => policy.validateAccess(scope, { id: 10 })).toThrow(PolicyAuthorizationError);
  });

  it("throws PolicyAuthorizationError for teacher role", () => {
    const scope = makeScope({ role: "teacher", ownedCourseIds: [100], childStudentIds: [10] });
    expect(() => policy.validateAccess(scope, { id: 10 })).toThrow(PolicyAuthorizationError);
  });

  it("throws PolicyAuthorizationError for student role", () => {
    const scope = makeScope({ role: "student", studentId: 10, childStudentIds: [10] });
    expect(() => policy.validateAccess(scope, { id: 10 })).toThrow(PolicyAuthorizationError);
  });

  it("throws when parent has empty childStudentIds", () => {
    const scope = makeScope({ childStudentIds: [] });
    expect(() => policy.validateAccess(scope, { id: 10 })).toThrow(PolicyAuthorizationError);
  });

  it("is exact — does not allow parent B to access parent A's student", () => {
    const parentA = makeScope({ userId: 1, childStudentIds: [10] });
    const parentB = makeScope({ userId: 2, childStudentIds: [20] });
    expect(() => policy.validateAccess(parentA, { id: 10 })).not.toThrow();
    expect(() => policy.validateAccess(parentB, { id: 10 })).toThrow(PolicyAuthorizationError);
  });
});
