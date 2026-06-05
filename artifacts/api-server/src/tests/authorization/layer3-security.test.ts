/**
 * Layer 3 Security Tests — Post-Fetch Defense-in-Depth
 *
 * Verifies that policy.validateAccess() prevents unauthorized access even when
 * a caller bypasses Layer 2 filtering (e.g. service-to-service calls, future
 * integrations, or query builder bugs that omit the scope condition).
 *
 * Layer 3 is defense-in-depth. It operates on an already-fetched resource and
 * must NEVER delegate authorization back to the caller.
 *
 * Key contract:
 *   - validateAccess(scope, resource) returns void on success
 *   - validateAccess(scope, resource) throws PolicyAuthorizationError on denial
 *   - It must throw even if Layer 2 was bypassed (tested here by calling it directly)
 *
 * Error subclass chain:
 *   PolicyAuthorizationError (base)
 *     └─ CourseAuthorizationError (course-scoped policies: notes, announcements)
 *
 * Route handlers catch PolicyAuthorizationError → respond 403.
 * This means catching the base class catches all subclass denials too.
 *
 * Simulated attack surface: an attacker gains direct access to a service
 * method (e.g. via a future background job or misconfigured route) that
 * skips Layer 2. Layer 3 must still block unauthorized resource access.
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
import { PolicyAuthorizationError } from "../../lib/policies";
import { CourseAuthorizationError } from "../../lib/course-scope-validator";
import { assignmentPolicy } from "../../lib/policies/assignment-scope-policy";
import { assessmentPolicy } from "../../lib/policies/assessment-scope-policy";
import { notesPolicy } from "../../lib/policies/notes-scope-policy";
import { announcementPolicy } from "../../lib/policies/announcement-scope-policy";

// ── Layer 3 — Assignments ─────────────────────────────────────────────────────

describe("Layer 3 — assignmentPolicy.validateAccess (defense-in-depth)", () => {
  describe("Global access (admin, teacher) — bypass simulation succeeds for authorized roles", () => {
    it("admin accessing any studentId resource: ALLOW", () => {
      const admin = createAdminScope();
      expectAuthorized(() => assignmentPolicy.validateAccess(admin, { studentId: 1 }));
      expectAuthorized(() => assignmentPolicy.validateAccess(admin, { studentId: 1000 }));
    });

    it("teacher accessing any studentId resource: ALLOW", () => {
      const teacher = createTeacherScope();
      expectAuthorized(() => assignmentPolicy.validateAccess(teacher, { studentId: 500 }));
    });
  });

  describe("Unauthorized access — Layer 3 blocks even when Layer 2 is bypassed", () => {
    it("student bypassing Layer 2: different studentId → DENY", () => {
      const scope = createStudentScope({ studentId: 42 });
      // Simulate: student directly calls service.getAssignment(99) — bypass of Layer 2 scope filter
      expectForbidden(() => assignmentPolicy.validateAccess(scope, { studentId: 99 }));
    });

    it("student: null studentId (unlinked account) bypassing Layer 2 → always DENY", () => {
      const scope = createStudentScope({ studentId: undefined });
      expectForbidden(() => assignmentPolicy.validateAccess(scope, { studentId: 1 }));
    });

    it("parent bypassing Layer 2: non-child studentId → DENY", () => {
      const scope = createParentScope({ childStudentIds: [10, 11], childCourseIds: [] });
      expectForbidden(() => assignmentPolicy.validateAccess(scope, { studentId: 99 }));
    });

    it("guest bypassing Layer 2: any studentId → always DENY", () => {
      const guest = createGuestScope();
      [1, 10, 42, 100, 999].forEach((studentId) => {
        expectForbidden(() => assignmentPolicy.validateAccess(guest, { studentId }));
      });
    });
  });

  describe("Error type guarantees", () => {
    it("denied access throws PolicyAuthorizationError (base class, catchable by route handlers)", () => {
      const scope = createStudentScope({ studentId: 1 });
      expect(() => assignmentPolicy.validateAccess(scope, { studentId: 2 })).toThrow(
        PolicyAuthorizationError,
      );
    });

    it("error.name is set (not just constructor name) — important for instanceof check in catch blocks", () => {
      const scope = createStudentScope({ studentId: 1 });
      try {
        assignmentPolicy.validateAccess(scope, { studentId: 99 });
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PolicyAuthorizationError);
        expect((err as PolicyAuthorizationError).name).toBeTruthy();
      }
    });
  });
});

// ── Layer 3 — Assessments ─────────────────────────────────────────────────────

describe("Layer 3 — assessmentPolicy.validateAccess (defense-in-depth)", () => {
  it("admin: any studentId → ALLOW (no defense needed)", () => {
    expectAuthorized(() => assessmentPolicy.validateAccess(createAdminScope(), { studentId: 500 }));
  });

  it("student bypassing Layer 2: foreign studentId → DENY", () => {
    const scope = createStudentScope({ studentId: 7 });
    expectForbidden(() => assessmentPolicy.validateAccess(scope, { studentId: 8 }));
  });

  it("parent bypassing Layer 2: non-child studentId → DENY", () => {
    const scope = createParentScope({ childStudentIds: [20], childCourseIds: [] });
    expectForbidden(() => assessmentPolicy.validateAccess(scope, { studentId: 21 }));
  });

  it("guest bypassing Layer 2: any studentId → DENY", () => {
    const guest = createGuestScope();
    expectForbidden(() => assessmentPolicy.validateAccess(guest, { studentId: 1 }));
  });

  it("simultaneous bypass attempts: each must fail independently", () => {
    const scope = createStudentScope({ studentId: 5 });
    const forbiddenIds = [1, 4, 6, 100, 999];
    forbiddenIds.forEach((studentId) => {
      expectForbidden(() => assessmentPolicy.validateAccess(scope, { studentId }));
    });
  });
});

// ── Layer 3 — Notes ───────────────────────────────────────────────────────────

describe("Layer 3 — notesPolicy.validateAccess (defense-in-depth)", () => {
  it("admin: any courseId → ALLOW", () => {
    expectAuthorized(() => notesPolicy.validateAccess(createAdminScope(), { courseId: 9999 }));
  });

  it("teacher: any courseId → ALLOW", () => {
    expectAuthorized(() => notesPolicy.validateAccess(createTeacherScope(), { courseId: 1 }));
  });

  it("student bypassing Layer 2: non-enrolled courseId → DENY", () => {
    const scope = createStudentScope({ enrolledCourseIds: [1, 2, 3] });
    // Simulate: student somehow fetches note from courseId=50 without Layer 2
    expectForbidden(() => notesPolicy.validateAccess(scope, { courseId: 50 }));
  });

  it("student: enrolled course → ALLOW (correct access even after bypass attempt)", () => {
    const scope = createStudentScope({ enrolledCourseIds: [1, 2, 3] });
    expectAuthorized(() => notesPolicy.validateAccess(scope, { courseId: 2 }));
  });

  it("parent bypassing Layer 2: non-child courseId → DENY", () => {
    const scope = createParentScope({ childStudentIds: [10], childCourseIds: [4, 5] });
    expectForbidden(() => notesPolicy.validateAccess(scope, { courseId: 6 }));
  });

  it("parent: child courseId → ALLOW", () => {
    const scope = createParentScope({ childStudentIds: [10], childCourseIds: [4, 5] });
    expectAuthorized(() => notesPolicy.validateAccess(scope, { courseId: 4 }));
  });

  it("guest bypassing Layer 2: any courseId → DENY", () => {
    const guest = createGuestScope();
    [1, 50, 999].forEach((courseId) => {
      expectForbidden(() => notesPolicy.validateAccess(guest, { courseId }));
    });
  });

  it("error is a CourseAuthorizationError (subclass) AND PolicyAuthorizationError (base)", () => {
    const scope = createStudentScope({ enrolledCourseIds: [1] });
    const fn = () => notesPolicy.validateAccess(scope, { courseId: 99 });
    expect(fn).toThrow(CourseAuthorizationError);
    expect(fn).toThrow(PolicyAuthorizationError);
  });
});

// ── Layer 3 — Announcements ───────────────────────────────────────────────────

describe("Layer 3 — announcementPolicy.validateAccess (defense-in-depth)", () => {
  it("admin: any courseId → ALLOW", () => {
    expectAuthorized(() => announcementPolicy.validateAccess(createAdminScope(), { courseId: 42 }));
  });

  it("teacher: any courseId → ALLOW", () => {
    expectAuthorized(() => announcementPolicy.validateAccess(createTeacherScope(), { courseId: 99 }));
  });

  it("student bypassing Layer 2: non-enrolled courseId → DENY", () => {
    const scope = createStudentScope({ enrolledCourseIds: [10, 11] });
    expectForbidden(() => announcementPolicy.validateAccess(scope, { courseId: 12 }));
  });

  it("parent bypassing Layer 2: non-child courseId → DENY", () => {
    const scope = createParentScope({ childStudentIds: [30], childCourseIds: [10, 11] });
    expectForbidden(() => announcementPolicy.validateAccess(scope, { courseId: 99 }));
  });

  it("guest bypassing Layer 2: any courseId → DENY", () => {
    [1, 10, 100].forEach((courseId) => {
      expectForbidden(() => announcementPolicy.validateAccess(createGuestScope(), { courseId }));
    });
  });

  it("error is CourseAuthorizationError AND PolicyAuthorizationError", () => {
    const scope = createStudentScope({ enrolledCourseIds: [1] });
    const fn = () => announcementPolicy.validateAccess(scope, { courseId: 50 });
    expect(fn).toThrow(CourseAuthorizationError);
    expect(fn).toThrow(PolicyAuthorizationError);
  });
});

// ── Cross-policy consistency ───────────────────────────────────────────────────

describe("Layer 3 — Cross-policy defense-in-depth consistency", () => {
  it("all four policies: admin is never denied regardless of resource identifier", () => {
    const admin = createAdminScope();
    expectAuthorized(() => assignmentPolicy.validateAccess(admin, { studentId: 9999 }));
    expectAuthorized(() => assessmentPolicy.validateAccess(admin, { studentId: 9999 }));
    expectAuthorized(() => notesPolicy.validateAccess(admin, { courseId: 9999 }));
    expectAuthorized(() => announcementPolicy.validateAccess(admin, { courseId: 9999 }));
  });

  it("all four policies: guest is always denied regardless of resource identifier", () => {
    const guest = createGuestScope();
    expectForbidden(() => assignmentPolicy.validateAccess(guest, { studentId: 1 }));
    expectForbidden(() => assessmentPolicy.validateAccess(guest, { studentId: 1 }));
    expectForbidden(() => notesPolicy.validateAccess(guest, { courseId: 1 }));
    expectForbidden(() => announcementPolicy.validateAccess(guest, { courseId: 1 }));
  });

  it("student-scoped policies: student can access own resource but not after incrementing ID", () => {
    const student = createStudentScope({ studentId: 50 });
    expectAuthorized(() => assignmentPolicy.validateAccess(student, { studentId: 50 }));
    expectForbidden(() => assignmentPolicy.validateAccess(student, { studentId: 51 }));
    expectAuthorized(() => assessmentPolicy.validateAccess(student, { studentId: 50 }));
    expectForbidden(() => assessmentPolicy.validateAccess(student, { studentId: 51 }));
  });

  it("course-scoped policies: student can access enrolled course but not adjacent course", () => {
    const student = createStudentScope({ enrolledCourseIds: [10] });
    expectAuthorized(() => notesPolicy.validateAccess(student, { courseId: 10 }));
    expectForbidden(() => notesPolicy.validateAccess(student, { courseId: 11 }));
    expectAuthorized(() => announcementPolicy.validateAccess(student, { courseId: 10 }));
    expectForbidden(() => announcementPolicy.validateAccess(student, { courseId: 11 }));
  });
});
