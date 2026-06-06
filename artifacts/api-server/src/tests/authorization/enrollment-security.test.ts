/**
 * Enrollment Management — Authorization Security Tests
 *
 * Verifies the authorization rules for enrollment endpoints at every layer:
 *
 *   Layer 1 — Role gating: student and parent are blocked by requireRole.
 *             Simulated here by checking scope.role (same logic as the middleware).
 *
 *   Layer 3 — Teacher IDOR: a teacher may only manage enrollments for courses
 *             they own. Attempts against non-owned courses must throw
 *             PolicyAuthorizationError → HTTP 403.
 *
 * No DB access — all checks use pure ScopeContext objects and coursePolicy.
 *
 * Attack model:
 *   Teacher A (ownedCourseIds=[10]) attempts to enroll/unenroll from Course 99
 *   owned by Teacher B. Layer 3 must reject this.
 *
 * Spec reference: Chunk 8 §Security Tests
 */
import { describe, it, expect } from "vitest";
import {
  createAdminScope,
  createTeacherScope,
  createStudentScope,
  createParentScope,
  createGuestScope,
  expectAuthorized,
  expectForbidden,
} from "../helpers/authorization";
import { coursePolicy } from "../../shared/auth/policies/course-scope-policy";
import { PolicyAuthorizationError } from "../../lib/policies";

// ── Layer 1 simulation — role gating ─────────────────────────────────────────
//
// requireRole("admin", "teacher") blocks any caller whose scope.role is not
// "admin" or "teacher". The tests below confirm that student, parent, and
// guest scopes would fail this check.

const ENROLLMENT_ALLOWED_ROLES = ["admin", "teacher"] as const;

describe("Enrollment Management — Layer 1 role gating", () => {
  it("admin role passes the role gate", () => {
    const scope = createAdminScope();
    expect(ENROLLMENT_ALLOWED_ROLES.includes(scope.role as (typeof ENROLLMENT_ALLOWED_ROLES)[number])).toBe(true);
  });

  it("teacher role passes the role gate", () => {
    const scope = createTeacherScope({ ownedCourseIds: [1] });
    expect(ENROLLMENT_ALLOWED_ROLES.includes(scope.role as (typeof ENROLLMENT_ALLOWED_ROLES)[number])).toBe(true);
  });

  it("student role is blocked at Layer 1", () => {
    const scope = createStudentScope();
    expect(ENROLLMENT_ALLOWED_ROLES.includes(scope.role as (typeof ENROLLMENT_ALLOWED_ROLES)[number])).toBe(false);
  });

  it("parent role is blocked at Layer 1", () => {
    const scope = createParentScope();
    expect(ENROLLMENT_ALLOWED_ROLES.includes(scope.role as (typeof ENROLLMENT_ALLOWED_ROLES)[number])).toBe(false);
  });

  it("guest role is blocked at Layer 1", () => {
    const scope = createGuestScope();
    expect(ENROLLMENT_ALLOWED_ROLES.includes(scope.role as (typeof ENROLLMENT_ALLOWED_ROLES)[number])).toBe(false);
  });
});

// ── Layer 3 — Teacher IDOR: POST /courses/:courseId/enrollments ───────────────
//
// Teacher A must not be able to enroll a student into Course B (owned by Teacher B).
// coursePolicy.validateAccess(scope, { id: courseId }) is the gate.

describe("Enrollment Creation — Layer 3 teacher IDOR protection", () => {
  const TEACHER_A_COURSES = [10, 20, 30];
  const NON_OWNED_COURSES = [1, 9, 11, 99, 100, 200, 999];

  it("admin can create enrollment in any course", () => {
    const scope = createAdminScope();
    NON_OWNED_COURSES.forEach((courseId) => {
      expectAuthorized(() => coursePolicy.validateAccess(scope, { id: courseId }));
    });
  });

  it("teacher can create enrollment in their own courses", () => {
    const scope = createTeacherScope({ ownedCourseIds: TEACHER_A_COURSES });
    TEACHER_A_COURSES.forEach((courseId) => {
      expectAuthorized(() => coursePolicy.validateAccess(scope, { id: courseId }));
    });
  });

  it("teacher cannot create enrollment in courses they do not own", () => {
    const scope = createTeacherScope({ ownedCourseIds: TEACHER_A_COURSES });
    NON_OWNED_COURSES.forEach((courseId) => {
      expectForbidden(() => coursePolicy.validateAccess(scope, { id: courseId }));
    });
  });

  it("teacher with no owned courses is blocked from all courses", () => {
    const scope = createTeacherScope({ ownedCourseIds: [] });
    [1, 10, 99, 999].forEach((courseId) => {
      expectForbidden(() => coursePolicy.validateAccess(scope, { id: courseId }));
    });
  });

  it("thrown error is a PolicyAuthorizationError (maps to HTTP 403 in route handler)", () => {
    const scope = createTeacherScope({ ownedCourseIds: [10] });
    expect(() => coursePolicy.validateAccess(scope, { id: 99 })).toThrow(PolicyAuthorizationError);
  });
});

// ── Layer 3 — Teacher IDOR: DELETE /courses/:courseId/enrollments/:studentId ──
//
// Same ownership gate applies to unenrollment.

describe("Enrollment Removal — Layer 3 teacher IDOR protection", () => {
  const TEACHER_B_COURSES = [50, 60];
  const TEACHER_A_COURSES = [10, 20];

  it("admin can remove enrollment from any course", () => {
    const scope = createAdminScope();
    [...TEACHER_A_COURSES, ...TEACHER_B_COURSES, 999].forEach((courseId) => {
      expectAuthorized(() => coursePolicy.validateAccess(scope, { id: courseId }));
    });
  });

  it("teacher can remove enrollment from their own courses", () => {
    const scope = createTeacherScope({ ownedCourseIds: TEACHER_B_COURSES });
    TEACHER_B_COURSES.forEach((courseId) => {
      expectAuthorized(() => coursePolicy.validateAccess(scope, { id: courseId }));
    });
  });

  it("Teacher A cannot remove enrollment from course owned by Teacher B", () => {
    const scopeA = createTeacherScope({ ownedCourseIds: TEACHER_A_COURSES });
    TEACHER_B_COURSES.forEach((courseId) => {
      expectForbidden(() => coursePolicy.validateAccess(scopeA, { id: courseId }));
    });
  });

  it("Teacher B cannot remove enrollment from course owned by Teacher A", () => {
    const scopeB = createTeacherScope({ ownedCourseIds: TEACHER_B_COURSES });
    TEACHER_A_COURSES.forEach((courseId) => {
      expectForbidden(() => coursePolicy.validateAccess(scopeB, { id: courseId }));
    });
  });
});

// ── Cross-role IDOR — non-admin, non-teacher roles ────────────────────────────
//
// Student and parent are blocked at Layer 1 (requireRole) for enrollment management.
// At Layer 3, coursePolicy.validateAccess allows students/parents to access
// their own enrolled/child courses (for read operations) but denies access
// to courses they are not enrolled in.
//
// These tests verify Layer 3 behavior for non-enrolled/non-child courses,
// confirming there is no path to access foreign course enrollment endpoints.

describe("Enrollment — defense in depth: non-enrolled courses denied at Layer 3", () => {
  it("student denied for courses they are not enrolled in", () => {
    // Student enrolled in [1] — cannot access course 99 at Layer 3
    const scope = createStudentScope({ enrolledCourseIds: [1] });
    const foreignCourses = [99, 100, 999];
    foreignCourses.forEach((courseId) => {
      expectForbidden(() => coursePolicy.validateAccess(scope, { id: courseId }));
    });
  });

  it("parent denied for courses their children are not enrolled in", () => {
    // Parent with child in [1] — cannot access course 99 at Layer 3
    const scope = createParentScope({ childCourseIds: [1] });
    const foreignCourses = [99, 100, 999];
    foreignCourses.forEach((courseId) => {
      expectForbidden(() => coursePolicy.validateAccess(scope, { id: courseId }));
    });
  });

  it("guest is denied at Layer 3 for all courses", () => {
    const scope = createGuestScope();
    [1, 10, 99].forEach((courseId) => {
      expectForbidden(() => coursePolicy.validateAccess(scope, { id: courseId }));
    });
  });
});
