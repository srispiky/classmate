/**
 * Policy Framework Validation Tests
 *
 * Dedicated tests for all four ResourceScopePolicy implementations.
 * Validates the contract of both policy methods for every supported role:
 *
 *   getScopeCondition(scope) — returns SQL condition for Layer 2 or undefined
 *   validateAccess(scope, resource) — throws PolicyAuthorizationError on denial
 *
 * Policies covered:
 *   AssignmentScopePolicy   — student-scoped, ownership via studentId
 *   AssessmentScopePolicy   — student-scoped, ownership via studentId
 *   NotesScopePolicy        — course-scoped, access via enrolledCourseIds / childCourseIds
 *   AnnouncementScopePolicy — course-scoped, access via enrolledCourseIds / childCourseIds
 *
 * This file is distinct from the per-resource query test files — it tests
 * the policy objects in isolation, not the query builder functions that use them.
 *
 * Error hierarchy:
 *   PolicyAuthorizationError (base)
 *     └─ CourseAuthorizationError (course-scoped policies)
 * Catching the base class is sufficient; all route handlers use the base.
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
import { SQL_FALSE } from "../../lib/scope-filter";
import { PolicyAuthorizationError } from "../../lib/policies";
import { CourseAuthorizationError } from "../../lib/course-scope-validator";
import { assignmentPolicy } from "../../lib/policies/assignment-scope-policy";
import { assessmentPolicy } from "../../lib/policies/assessment-scope-policy";
import { notesPolicy } from "../../lib/policies/notes-scope-policy";
import { announcementPolicy } from "../../lib/policies/announcement-scope-policy";

// ── AssignmentScopePolicy ─────────────────────────────────────────────────────

describe("AssignmentScopePolicy.getScopeCondition", () => {
  it("admin → undefined (no filter — full table access)", () => {
    expect(assignmentPolicy.getScopeCondition(createAdminScope())).toBeUndefined();
  });

  it("teacher → undefined (no filter — full table access)", () => {
    expect(assignmentPolicy.getScopeCondition(createTeacherScope())).toBeUndefined();
  });

  it("student with studentId → eq(student_id, X) condition (not undefined, not SQL_FALSE)", () => {
    const cond = assignmentPolicy.getScopeCondition(createStudentScope({ studentId: 42 }));
    expect(cond).toBeDefined();
    expect(cond).not.toBe(SQL_FALSE);
  });

  it("parent with childStudentIds → inArray(student_id, [...]) condition", () => {
    const cond = assignmentPolicy.getScopeCondition(createParentScope({ childStudentIds: [10, 11] }));
    expect(cond).toBeDefined();
    expect(cond).not.toBe(SQL_FALSE);
  });

  it("parent with empty childStudentIds → SQL_FALSE", () => {
    const cond = assignmentPolicy.getScopeCondition(createParentScope({ childStudentIds: [], childCourseIds: [] }));
    expect(cond).toBe(SQL_FALSE);
  });

  it("guest → SQL_FALSE (no access)", () => {
    expect(assignmentPolicy.getScopeCondition(createGuestScope())).toBe(SQL_FALSE);
  });
});

describe("AssignmentScopePolicy.validateAccess", () => {
  it("admin → any studentId → ALLOW", () => {
    expectAuthorized(() => assignmentPolicy.validateAccess(createAdminScope(), { studentId: 1 }));
    expectAuthorized(() => assignmentPolicy.validateAccess(createAdminScope(), { studentId: 9999 }));
  });

  it("teacher → any studentId → ALLOW", () => {
    expectAuthorized(() => assignmentPolicy.validateAccess(createTeacherScope(), { studentId: 500 }));
  });

  it("student: own studentId → ALLOW", () => {
    expectAuthorized(() => assignmentPolicy.validateAccess(createStudentScope({ studentId: 42 }), { studentId: 42 }));
  });

  it("student: foreign studentId → PolicyAuthorizationError", () => {
    expectForbidden(() => assignmentPolicy.validateAccess(createStudentScope({ studentId: 42 }), { studentId: 43 }));
  });

  it("student: null studentId in scope → always denied (unlinked account)", () => {
    const scope = createStudentScope({ studentId: undefined });
    expectForbidden(() => assignmentPolicy.validateAccess(scope, { studentId: 1 }));
  });

  it("parent: child studentId → ALLOW", () => {
    const scope = createParentScope({ childStudentIds: [10, 11], childCourseIds: [] });
    expectAuthorized(() => assignmentPolicy.validateAccess(scope, { studentId: 10 }));
    expectAuthorized(() => assignmentPolicy.validateAccess(scope, { studentId: 11 }));
  });

  it("parent: non-child studentId → PolicyAuthorizationError", () => {
    const scope = createParentScope({ childStudentIds: [10], childCourseIds: [] });
    expectForbidden(() => assignmentPolicy.validateAccess(scope, { studentId: 9 }));
  });

  it("guest → any studentId → PolicyAuthorizationError", () => {
    expectForbidden(() => assignmentPolicy.validateAccess(createGuestScope(), { studentId: 1 }));
  });

  it("thrown error IS a PolicyAuthorizationError (base class check)", () => {
    expect(() =>
      assignmentPolicy.validateAccess(createStudentScope({ studentId: 1 }), { studentId: 99 })
    ).toThrow(PolicyAuthorizationError);
  });
});

// ── AssessmentScopePolicy ─────────────────────────────────────────────────────

describe("AssessmentScopePolicy.getScopeCondition", () => {
  it("admin → undefined", () => {
    expect(assessmentPolicy.getScopeCondition(createAdminScope())).toBeUndefined();
  });
  it("teacher → undefined", () => {
    expect(assessmentPolicy.getScopeCondition(createTeacherScope())).toBeUndefined();
  });
  it("student → real SQL condition", () => {
    const cond = assessmentPolicy.getScopeCondition(createStudentScope({ studentId: 5 }));
    expect(cond).toBeDefined();
    expect(cond).not.toBe(SQL_FALSE);
  });
  it("parent with children → real SQL condition", () => {
    const cond = assessmentPolicy.getScopeCondition(createParentScope({ childStudentIds: [1] }));
    expect(cond).toBeDefined();
    expect(cond).not.toBe(SQL_FALSE);
  });
  it("parent with no children → SQL_FALSE", () => {
    expect(assessmentPolicy.getScopeCondition(createParentScope({ childStudentIds: [], childCourseIds: [] }))).toBe(SQL_FALSE);
  });
  it("guest → SQL_FALSE", () => {
    expect(assessmentPolicy.getScopeCondition(createGuestScope())).toBe(SQL_FALSE);
  });
});

describe("AssessmentScopePolicy.validateAccess", () => {
  it("admin/teacher → any studentId → ALLOW", () => {
    expectAuthorized(() => assessmentPolicy.validateAccess(createAdminScope(), { studentId: 1 }));
    expectAuthorized(() => assessmentPolicy.validateAccess(createTeacherScope(), { studentId: 999 }));
  });
  it("student: own → ALLOW, foreign → DENY", () => {
    const scope = createStudentScope({ studentId: 7 });
    expectAuthorized(() => assessmentPolicy.validateAccess(scope, { studentId: 7 }));
    expectForbidden(() => assessmentPolicy.validateAccess(scope, { studentId: 8 }));
  });
  it("parent: child → ALLOW, non-child → DENY", () => {
    const scope = createParentScope({ childStudentIds: [20], childCourseIds: [] });
    expectAuthorized(() => assessmentPolicy.validateAccess(scope, { studentId: 20 }));
    expectForbidden(() => assessmentPolicy.validateAccess(scope, { studentId: 21 }));
  });
  it("guest → DENY", () => {
    expectForbidden(() => assessmentPolicy.validateAccess(createGuestScope(), { studentId: 1 }));
  });
});

// ── NotesScopePolicy ──────────────────────────────────────────────────────────

describe("NotesScopePolicy.getScopeCondition", () => {
  it("admin → undefined", () => {
    expect(notesPolicy.getScopeCondition(createAdminScope())).toBeUndefined();
  });
  it("teacher with courses → real SQL condition", () => {
    const cond = notesPolicy.getScopeCondition(createTeacherScope({ ownedCourseIds: [1, 2] }));
    expect(cond).toBeDefined();
    expect(cond).not.toBe(SQL_FALSE);
  });
  it("teacher with no courses → SQL_FALSE", () => {
    expect(notesPolicy.getScopeCondition(createTeacherScope())).toBe(SQL_FALSE);
  });
  it("student with enrolledCourseIds → real SQL condition", () => {
    const cond = notesPolicy.getScopeCondition(createStudentScope({ enrolledCourseIds: [1, 2] }));
    expect(cond).toBeDefined();
    expect(cond).not.toBe(SQL_FALSE);
  });
  it("student with empty enrolledCourseIds → SQL_FALSE", () => {
    expect(notesPolicy.getScopeCondition(createStudentScope({ enrolledCourseIds: [] }))).toBe(SQL_FALSE);
  });
  it("parent with childCourseIds → real SQL condition", () => {
    const cond = notesPolicy.getScopeCondition(createParentScope({ childCourseIds: [3] }));
    expect(cond).toBeDefined();
    expect(cond).not.toBe(SQL_FALSE);
  });
  it("parent with empty childCourseIds → SQL_FALSE", () => {
    expect(notesPolicy.getScopeCondition(createParentScope({ childStudentIds: [], childCourseIds: [] }))).toBe(SQL_FALSE);
  });
  it("guest → SQL_FALSE", () => {
    expect(notesPolicy.getScopeCondition(createGuestScope())).toBe(SQL_FALSE);
  });
});

describe("NotesScopePolicy.validateAccess", () => {
  it("admin → any courseId → ALLOW", () => {
    expectAuthorized(() => notesPolicy.validateAccess(createAdminScope(), { courseId: 1 }));
  });
  it("teacher → owned courseId → ALLOW", () => {
    expectAuthorized(() => notesPolicy.validateAccess(createTeacherScope({ ownedCourseIds: [9999] }), { courseId: 9999 }));
  });
  it("teacher → non-owned courseId → DENY", () => {
    expectForbidden(() => notesPolicy.validateAccess(createTeacherScope({ ownedCourseIds: [1] }), { courseId: 9999 }));
  });
  it("student: enrolled course → ALLOW, non-enrolled → DENY", () => {
    const scope = createStudentScope({ enrolledCourseIds: [5, 6] });
    expectAuthorized(() => notesPolicy.validateAccess(scope, { courseId: 5 }));
    expectForbidden(() => notesPolicy.validateAccess(scope, { courseId: 7 }));
  });
  it("parent: child course → ALLOW, non-child course → DENY", () => {
    const scope = createParentScope({ childStudentIds: [1], childCourseIds: [8] });
    expectAuthorized(() => notesPolicy.validateAccess(scope, { courseId: 8 }));
    expectForbidden(() => notesPolicy.validateAccess(scope, { courseId: 9 }));
  });
  it("guest → DENY", () => {
    expectForbidden(() => notesPolicy.validateAccess(createGuestScope(), { courseId: 1 }));
  });
  it("thrown error IS a CourseAuthorizationError (subclass of PolicyAuthorizationError)", () => {
    const scope = createStudentScope({ enrolledCourseIds: [1] });
    expect(() => notesPolicy.validateAccess(scope, { courseId: 99 })).toThrow(CourseAuthorizationError);
    expect(() => notesPolicy.validateAccess(scope, { courseId: 99 })).toThrow(PolicyAuthorizationError);
  });
});

// ── AnnouncementScopePolicy ───────────────────────────────────────────────────

describe("AnnouncementScopePolicy.getScopeCondition", () => {
  it("admin → undefined", () => {
    expect(announcementPolicy.getScopeCondition(createAdminScope())).toBeUndefined();
  });
  it("teacher with courses → real SQL condition", () => {
    const cond = announcementPolicy.getScopeCondition(createTeacherScope({ ownedCourseIds: [1, 2] }));
    expect(cond).toBeDefined();
    expect(cond).not.toBe(SQL_FALSE);
  });
  it("teacher with no courses → SQL_FALSE", () => {
    expect(announcementPolicy.getScopeCondition(createTeacherScope())).toBe(SQL_FALSE);
  });
  it("student with enrolled courses → real SQL condition", () => {
    const cond = announcementPolicy.getScopeCondition(createStudentScope({ enrolledCourseIds: [2, 3] }));
    expect(cond).toBeDefined();
    expect(cond).not.toBe(SQL_FALSE);
  });
  it("student with no enrolled courses → SQL_FALSE", () => {
    expect(announcementPolicy.getScopeCondition(createStudentScope({ enrolledCourseIds: [] }))).toBe(SQL_FALSE);
  });
  it("parent with child courses → real SQL condition", () => {
    const cond = announcementPolicy.getScopeCondition(createParentScope({ childCourseIds: [1, 4] }));
    expect(cond).toBeDefined();
    expect(cond).not.toBe(SQL_FALSE);
  });
  it("parent with no child courses → SQL_FALSE", () => {
    expect(announcementPolicy.getScopeCondition(createParentScope({ childStudentIds: [], childCourseIds: [] }))).toBe(SQL_FALSE);
  });
  it("guest → SQL_FALSE", () => {
    expect(announcementPolicy.getScopeCondition(createGuestScope())).toBe(SQL_FALSE);
  });
});

describe("AnnouncementScopePolicy.validateAccess", () => {
  it("admin → any courseId → ALLOW", () => {
    expectAuthorized(() => announcementPolicy.validateAccess(createAdminScope(), { courseId: 42 }));
  });
  it("teacher → owned courseId → ALLOW", () => {
    expectAuthorized(() => announcementPolicy.validateAccess(createTeacherScope({ ownedCourseIds: [99] }), { courseId: 99 }));
  });
  it("teacher → non-owned courseId → DENY", () => {
    expectForbidden(() => announcementPolicy.validateAccess(createTeacherScope({ ownedCourseIds: [1] }), { courseId: 99 }));
  });
  it("student: enrolled course → ALLOW, non-enrolled → DENY", () => {
    const scope = createStudentScope({ enrolledCourseIds: [10, 11] });
    expectAuthorized(() => announcementPolicy.validateAccess(scope, { courseId: 10 }));
    expectForbidden(() => announcementPolicy.validateAccess(scope, { courseId: 12 }));
  });
  it("parent: child course → ALLOW, other course → DENY", () => {
    const scope = createParentScope({ childStudentIds: [5], childCourseIds: [3, 4] });
    expectAuthorized(() => announcementPolicy.validateAccess(scope, { courseId: 3 }));
    expectForbidden(() => announcementPolicy.validateAccess(scope, { courseId: 5 }));
  });
  it("guest → DENY", () => {
    expectForbidden(() => announcementPolicy.validateAccess(createGuestScope(), { courseId: 1 }));
  });
  it("thrown error IS a CourseAuthorizationError and a PolicyAuthorizationError", () => {
    const scope = createStudentScope({ enrolledCourseIds: [1] });
    expect(() => announcementPolicy.validateAccess(scope, { courseId: 99 })).toThrow(CourseAuthorizationError);
    expect(() => announcementPolicy.validateAccess(scope, { courseId: 99 })).toThrow(PolicyAuthorizationError);
  });
});

// ── Policy interface contract ─────────────────────────────────────────────────

describe("ResourceScopePolicy interface contract", () => {
  const policies = [
    { name: "assignmentPolicy", policy: assignmentPolicy },
    { name: "assessmentPolicy", policy: assessmentPolicy },
    { name: "notesPolicy", policy: notesPolicy },
    { name: "announcementPolicy", policy: announcementPolicy },
  ] as const;

  policies.forEach(({ name, policy }) => {
    it(`${name}: implements getScopeCondition (function)`, () => {
      expect(typeof policy.getScopeCondition).toBe("function");
    });
    it(`${name}: implements validateAccess (function)`, () => {
      expect(typeof policy.validateAccess).toBe("function");
    });
    it(`${name}: getScopeCondition(adminScope) returns undefined (global = no filter)`, () => {
      expect(policy.getScopeCondition(createAdminScope())).toBeUndefined();
    });
    it(`${name}: getScopeCondition(guestScope) returns SQL_FALSE (total deny)`, () => {
      expect(policy.getScopeCondition(createGuestScope())).toBe(SQL_FALSE);
    });
  });
});
