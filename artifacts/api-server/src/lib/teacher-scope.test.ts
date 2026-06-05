/**
 * Teacher Scope Helper Tests — Sprint 4 Chunk 4
 *
 * Pure unit tests for isOwnedCourse(), hasOwnedCourses(), and getOwnedCourseIds().
 * No database access — helpers are pure functions of ScopeContext.
 *
 * Coverage:
 *   isOwnedCourse()
 *     - admin: always true (global access, no ownership boundary)
 *     - teacher: true when courseId is in ownedCourseIds, false otherwise
 *     - student: always false
 *     - parent: always false
 *     - guest: always false
 *
 *   hasOwnedCourses()
 *     - returns true when ownedCourseIds.length > 0
 *     - returns false when ownedCourseIds is empty
 *     - returns false for non-teacher roles (ownedCourseIds always [])
 *
 *   getOwnedCourseIds()
 *     - returns scope.ownedCourseIds directly
 *     - returns [] for non-teacher roles
 */
import { describe, it, expect } from "vitest";
import type { ScopeContext, RoleKey } from "./scope-context";
import { isOwnedCourse, hasOwnedCourses, getOwnedCourseIds } from "./teacher-scope";

// ── Fixtures ───────────────────────────────────────────────────────────────────

function makeScope(overrides: Partial<ScopeContext> = {}): ScopeContext {
  return {
    role: "teacher",
    isGlobal: true,
    userId: 1,
    studentId: null,
    enrolledCourseIds: [],
    childStudentIds: [],
    childCourseIds: [],
    teacherId: 1,
    ownedCourseIds: [],
    ...overrides,
  };
}

function scopeFor(role: RoleKey, ownedCourseIds: number[] = []): ScopeContext {
  return makeScope({
    role,
    isGlobal: role === "admin" || role === "teacher",
    teacherId: role === "teacher" ? 1 : null,
    ownedCourseIds: role === "teacher" ? ownedCourseIds : [],
  });
}

// ── isOwnedCourse ─────────────────────────────────────────────────────────────

describe("isOwnedCourse", () => {
  describe("Admin role — global access", () => {
    it("returns true for any courseId", () => {
      const scope = scopeFor("admin");
      expect(isOwnedCourse(scope, 1)).toBe(true);
      expect(isOwnedCourse(scope, 999)).toBe(true);
    });

    it("returns true even when ownedCourseIds is empty (admin is not limited by it)", () => {
      const scope = scopeFor("admin");
      expect(scope.ownedCourseIds).toEqual([]);
      expect(isOwnedCourse(scope, 42)).toBe(true);
    });
  });

  describe("Teacher role — owns specific courses", () => {
    it("returns true when courseId is in ownedCourseIds", () => {
      const scope = scopeFor("teacher", [10, 20, 30]);
      expect(isOwnedCourse(scope, 10)).toBe(true);
      expect(isOwnedCourse(scope, 20)).toBe(true);
      expect(isOwnedCourse(scope, 30)).toBe(true);
    });

    it("returns false when courseId is not in ownedCourseIds", () => {
      const scope = scopeFor("teacher", [10, 20, 30]);
      expect(isOwnedCourse(scope, 11)).toBe(false);
      expect(isOwnedCourse(scope, 99)).toBe(false);
    });

    it("returns false when ownedCourseIds is empty", () => {
      const scope = scopeFor("teacher", []);
      expect(isOwnedCourse(scope, 1)).toBe(false);
    });

    it("returns false for courseId=0 (invalid ID, not in array)", () => {
      const scope = scopeFor("teacher", [1, 2, 3]);
      expect(isOwnedCourse(scope, 0)).toBe(false);
    });

    it("is a strict equality check (no coercion)", () => {
      const scope = scopeFor("teacher", [5]);
      expect(isOwnedCourse(scope, 5)).toBe(true);
      expect(isOwnedCourse(scope, 4)).toBe(false);
      expect(isOwnedCourse(scope, 6)).toBe(false);
    });
  });

  describe("Student role — never owns courses", () => {
    it("returns false for any courseId", () => {
      const scope = scopeFor("student");
      expect(isOwnedCourse(scope, 1)).toBe(false);
      expect(isOwnedCourse(scope, 999)).toBe(false);
    });
  });

  describe("Parent role — never owns courses", () => {
    it("returns false for any courseId", () => {
      const scope = scopeFor("parent");
      expect(isOwnedCourse(scope, 1)).toBe(false);
      expect(isOwnedCourse(scope, 999)).toBe(false);
    });
  });

  describe("Guest role — never owns courses", () => {
    it("returns false for any courseId", () => {
      const scope = scopeFor("guest");
      expect(isOwnedCourse(scope, 1)).toBe(false);
      expect(isOwnedCourse(scope, 999)).toBe(false);
    });
  });

  describe("Role boundary isolation", () => {
    it("student with a matching courseId does not leak into teacher check", () => {
      const scope = makeScope({
        role: "student",
        isGlobal: false,
        teacherId: null,
        ownedCourseIds: [],
        studentId: 1,
        enrolledCourseIds: [5, 10],
      });
      expect(isOwnedCourse(scope, 5)).toBe(false);
    });

    it("parent's childCourseIds do not count as owned courses", () => {
      const scope = makeScope({
        role: "parent",
        isGlobal: false,
        teacherId: null,
        ownedCourseIds: [],
        childStudentIds: [1],
        childCourseIds: [5, 10],
      });
      expect(isOwnedCourse(scope, 5)).toBe(false);
    });
  });
});

// ── hasOwnedCourses ───────────────────────────────────────────────────────────

describe("hasOwnedCourses", () => {
  it("returns true when teacher has at least one owned course", () => {
    expect(hasOwnedCourses(scopeFor("teacher", [1]))).toBe(true);
    expect(hasOwnedCourses(scopeFor("teacher", [1, 2, 3]))).toBe(true);
  });

  it("returns false when teacher has no owned courses", () => {
    expect(hasOwnedCourses(scopeFor("teacher", []))).toBe(false);
  });

  it("returns false for admin (ownedCourseIds is always [])", () => {
    expect(hasOwnedCourses(scopeFor("admin"))).toBe(false);
  });

  it("returns false for student (ownedCourseIds is always [])", () => {
    expect(hasOwnedCourses(scopeFor("student"))).toBe(false);
  });

  it("returns false for parent (ownedCourseIds is always [])", () => {
    expect(hasOwnedCourses(scopeFor("parent"))).toBe(false);
  });

  it("returns false for guest (ownedCourseIds is always [])", () => {
    expect(hasOwnedCourses(scopeFor("guest"))).toBe(false);
  });
});

// ── getOwnedCourseIds ─────────────────────────────────────────────────────────

describe("getOwnedCourseIds", () => {
  it("returns ownedCourseIds for teacher", () => {
    const ids = [10, 20, 30];
    const scope = scopeFor("teacher", ids);
    expect(getOwnedCourseIds(scope)).toEqual(ids);
  });

  it("returns [] when teacher has no owned courses", () => {
    expect(getOwnedCourseIds(scopeFor("teacher", []))).toEqual([]);
  });

  it("returns [] for admin (ownedCourseIds is always [])", () => {
    expect(getOwnedCourseIds(scopeFor("admin"))).toEqual([]);
  });

  it("returns [] for student (ownedCourseIds is always [])", () => {
    expect(getOwnedCourseIds(scopeFor("student"))).toEqual([]);
  });

  it("returns [] for parent (ownedCourseIds is always [])", () => {
    expect(getOwnedCourseIds(scopeFor("parent"))).toEqual([]);
  });

  it("returns [] for guest (ownedCourseIds is always [])", () => {
    expect(getOwnedCourseIds(scopeFor("guest"))).toEqual([]);
  });

  it("returns the same reference (not a copy)", () => {
    const scope = scopeFor("teacher", [1, 2, 3]);
    expect(getOwnedCourseIds(scope)).toBe(scope.ownedCourseIds);
  });

  it("preserves order of ownedCourseIds", () => {
    const scope = scopeFor("teacher", [30, 10, 20]);
    expect(getOwnedCourseIds(scope)).toEqual([30, 10, 20]);
  });
});
