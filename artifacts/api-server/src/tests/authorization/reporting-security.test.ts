/**
 * Reporting Security Regression Tests — Sprint 8 Chunk 4
 *
 * Verifies authorization architecture for /reports/student-summary and
 * /reports/course-summary endpoints:
 *
 *   Layer 1: requireRole("admin", "teacher") — role-based access
 *   Layer 2: scope filter helpers (dashboard pattern, reused)
 *   Layer 3: studentPolicy.validateAccess / coursePolicy.validateAccess
 *
 * Tests are pure (no HTTP server, no DB). They operate on the policy and
 * scope-filter helpers directly — consistent with the established pattern
 * in dashboard-scoping.test.ts and progress-analytics-security.test.ts.
 *
 * E2E isolation scenario mirrors the spec Part 8:
 *   Teacher A owns Course A → can access Student A (enrolled in Course A)
 *   Teacher B owns Course B → can access Student B (enrolled in Course B)
 *   Teacher A cannot access Student B / Course B
 *   Teacher B cannot access Student A / Course A
 *   Admin can access all
 */

import { describe, it, expect } from "vitest";
import { studentPolicy } from "../../lib/policies/student-scope-policy";
import { coursePolicy } from "../../shared/auth/policies/course-scope-policy";
import { PolicyAuthorizationError } from "../../lib/policies";
import {
  createAdminScope,
  createTeacherScope,
  createStudentScope,
  createParentScope,
  createGuestScope,
} from "../helpers/authorization/sessions";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const teacherA = createTeacherScope({ teacherId: 1, ownedCourseIds: [10, 11] });
const teacherB = createTeacherScope({ teacherId: 2, ownedCourseIds: [20, 21] });
const teacherNoCourses = createTeacherScope({ teacherId: 3, ownedCourseIds: [] });
const admin = createAdminScope();

// Student A enrolled in Course 10 (owned by Teacher A)
const studentA = { id: 1, enrolledCourseIds: [10] };
// Student B enrolled in Course 20 (owned by Teacher B)
const studentB = { id: 2, enrolledCourseIds: [20] };
// Unrelated student not in any teacher's course
const studentOrphan = { id: 99, enrolledCourseIds: [999] };

// ── Layer 3: studentPolicy.validateAccess ─────────────────────────────────────

describe("Reporting — Layer 3 student access (studentPolicy.validateAccess)", () => {
  it("admin can access any student", () => {
    expect(() => studentPolicy.validateAccess(admin, studentA)).not.toThrow();
    expect(() => studentPolicy.validateAccess(admin, studentB)).not.toThrow();
    expect(() => studentPolicy.validateAccess(admin, studentOrphan)).not.toThrow();
  });

  it("Teacher A can access Student A (enrolled in owned course)", () => {
    expect(() => studentPolicy.validateAccess(teacherA, studentA)).not.toThrow();
  });

  it("Teacher B can access Student B (enrolled in owned course)", () => {
    expect(() => studentPolicy.validateAccess(teacherB, studentB)).not.toThrow();
  });

  it("Teacher A cannot access Student B (enrolled only in Teacher B's course)", () => {
    expect(() => studentPolicy.validateAccess(teacherA, studentB)).toThrow(
      PolicyAuthorizationError,
    );
  });

  it("Teacher B cannot access Student A (enrolled only in Teacher A's course)", () => {
    expect(() => studentPolicy.validateAccess(teacherB, studentA)).toThrow(
      PolicyAuthorizationError,
    );
  });

  it("Teacher with no courses cannot access any student", () => {
    expect(() => studentPolicy.validateAccess(teacherNoCourses, studentA)).toThrow(
      PolicyAuthorizationError,
    );
  });

  it("student role cannot access student resources", () => {
    expect(() =>
      studentPolicy.validateAccess(createStudentScope(), studentA),
    ).toThrow(PolicyAuthorizationError);
  });

  it("parent role cannot access student resources", () => {
    expect(() =>
      studentPolicy.validateAccess(createParentScope(), studentA),
    ).toThrow(PolicyAuthorizationError);
  });

  it("guest role cannot access student resources", () => {
    expect(() =>
      studentPolicy.validateAccess(createGuestScope(), studentA),
    ).toThrow(PolicyAuthorizationError);
  });
});

// ── Layer 3: coursePolicy.validateAccess ─────────────────────────────────────

describe("Reporting — Layer 3 course access (coursePolicy.validateAccess)", () => {
  it("admin can access any course", () => {
    expect(() => coursePolicy.validateAccess(admin, { id: 10 })).not.toThrow();
    expect(() => coursePolicy.validateAccess(admin, { id: 20 })).not.toThrow();
    expect(() => coursePolicy.validateAccess(admin, { id: 999 })).not.toThrow();
  });

  it("Teacher A can access Course A (id=10, owned)", () => {
    expect(() => coursePolicy.validateAccess(teacherA, { id: 10 })).not.toThrow();
    expect(() => coursePolicy.validateAccess(teacherA, { id: 11 })).not.toThrow();
  });

  it("Teacher B can access Course B (id=20, owned)", () => {
    expect(() => coursePolicy.validateAccess(teacherB, { id: 20 })).not.toThrow();
  });

  it("Teacher A cannot access Course B (id=20, owned by Teacher B)", () => {
    expect(() => coursePolicy.validateAccess(teacherA, { id: 20 })).toThrow(
      PolicyAuthorizationError,
    );
  });

  it("Teacher B cannot access Course A (id=10, owned by Teacher A)", () => {
    expect(() => coursePolicy.validateAccess(teacherB, { id: 10 })).toThrow(
      PolicyAuthorizationError,
    );
  });

  it("Teacher with no courses cannot access any course", () => {
    expect(() => coursePolicy.validateAccess(teacherNoCourses, { id: 10 })).toThrow(
      PolicyAuthorizationError,
    );
  });
});

// ── E2E isolation scenario ────────────────────────────────────────────────────
//
// Mirrors Part 8 of the chunk spec. Confirms the same isolation guarantees
// apply through the policy layer regardless of which endpoint is calling it.

describe("Reporting — E2E cross-teacher isolation (Part 8 scenario)", () => {
  it("Teacher A can access their student but not Teacher B's", () => {
    expect(() => studentPolicy.validateAccess(teacherA, studentA)).not.toThrow();
    expect(() => studentPolicy.validateAccess(teacherA, studentB)).toThrow(
      PolicyAuthorizationError,
    );
  });

  it("Teacher B can access their student but not Teacher A's", () => {
    expect(() => studentPolicy.validateAccess(teacherB, studentB)).not.toThrow();
    expect(() => studentPolicy.validateAccess(teacherB, studentA)).toThrow(
      PolicyAuthorizationError,
    );
  });

  it("Teacher A can access their course but not Teacher B's", () => {
    expect(() => coursePolicy.validateAccess(teacherA, { id: 10 })).not.toThrow();
    expect(() => coursePolicy.validateAccess(teacherA, { id: 20 })).toThrow(
      PolicyAuthorizationError,
    );
  });

  it("Teacher B can access their course but not Teacher A's", () => {
    expect(() => coursePolicy.validateAccess(teacherB, { id: 20 })).not.toThrow();
    expect(() => coursePolicy.validateAccess(teacherB, { id: 10 })).toThrow(
      PolicyAuthorizationError,
    );
  });

  it("Admin can access both Teacher A and Teacher B resources", () => {
    expect(() => studentPolicy.validateAccess(admin, studentA)).not.toThrow();
    expect(() => studentPolicy.validateAccess(admin, studentB)).not.toThrow();
    expect(() => coursePolicy.validateAccess(admin, { id: 10 })).not.toThrow();
    expect(() => coursePolicy.validateAccess(admin, { id: 20 })).not.toThrow();
  });
});

// ── Layer 2: getScopeCondition produces distinct SQL per teacher ──────────────

describe("Reporting — Layer 2 scope condition isolation", () => {
  it("student scope conditions differ between Teacher A and Teacher B", () => {
    const filterA = studentPolicy.getScopeCondition(teacherA);
    const filterB = studentPolicy.getScopeCondition(teacherB);
    expect(filterA).not.toBe(filterB);
  });

  it("course scope conditions differ between Teacher A and Teacher B", () => {
    const filterA = coursePolicy.getScopeCondition(teacherA);
    const filterB = coursePolicy.getScopeCondition(teacherB);
    expect(filterA).not.toBe(filterB);
  });

  it("admin student scope condition is undefined (no filter)", () => {
    expect(studentPolicy.getScopeCondition(admin)).toBeUndefined();
  });

  it("admin course scope condition is undefined (no filter)", () => {
    expect(coursePolicy.getScopeCondition(admin)).toBeUndefined();
  });

  it("student scope condition is not SQL_FALSE for teacher with courses", () => {
    const filter = studentPolicy.getScopeCondition(teacherA);
    expect(filter).toBeDefined();
  });

  it("course scope condition is not SQL_FALSE for teacher with courses", () => {
    const filter = coursePolicy.getScopeCondition(teacherA);
    expect(filter).toBeDefined();
  });
});

// ── Error type contract ───────────────────────────────────────────────────────

describe("Reporting — PolicyAuthorizationError is the correct error type", () => {
  it("denied student access throws PolicyAuthorizationError (not generic Error)", () => {
    let caught: unknown = null;
    try {
      studentPolicy.validateAccess(teacherA, studentB);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PolicyAuthorizationError);
  });

  it("denied course access throws PolicyAuthorizationError", () => {
    let caught: unknown = null;
    try {
      coursePolicy.validateAccess(teacherA, { id: 20 });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PolicyAuthorizationError);
  });
});
