/**
 * Scope Boundary Tests
 *
 * Verifies the exact boundary conditions of each role's access scope.
 * These tests ensure that a role can see precisely what it should —
 * not more, not less — at both Layer 2 and Layer 3.
 *
 * Boundary categories:
 *   Student — own records accessible; any other studentId inaccessible
 *   Parent  — child records accessible; non-child records inaccessible
 *   Course  — enrolled/child-enrolled course resources accessible; others blocked
 *   Global  — admin/teacher retain full access regardless of resource ownership
 *   Empty   — roles with no enrollments / no children are fully blocked
 */
import { describe, it, expect } from "vitest";
import {
  createAdminScope,
  createTeacherScope,
  createStudentScope,
  createParentScope,
  createGuestScope,
  expectLayer2Allows,
  expectLayer2Blocks,
  expectAuthorized,
  expectForbidden,
} from "../helpers/authorization";
import { SQL_FALSE } from "../../lib/scope-filter";
import { buildAssignmentListConditions } from "../../lib/assignments.queries";
import { buildAssessmentListConditions } from "../../lib/assessments.queries";
import { buildNoteListConditions } from "../../lib/notes.queries";
import { buildAnnouncementListConditions } from "../../lib/announcements.queries";
import { assignmentPolicy } from "../../lib/policies/assignment-scope-policy";
import { assessmentPolicy } from "../../lib/policies/assessment-scope-policy";
import { notesPolicy } from "../../lib/policies/notes-scope-policy";
import { announcementPolicy } from "../../lib/policies/announcement-scope-policy";

// ── Admin / Teacher — Global Scope ────────────────────────────────────────────

describe("Scope Boundary — Global roles (admin, teacher)", () => {
  it("admin: Layer 2 produces no scope filter for assignments", () => {
    const conditions = buildAssignmentListConditions(createAdminScope(), {});
    expect(conditions).toHaveLength(1); // only soft-delete guard
    expect(conditions[0]).not.toBe(SQL_FALSE);
  });

  it("teacher: Layer 2 produces no scope filter for assessments", () => {
    const conditions = buildAssessmentListConditions(createTeacherScope(), {});
    expect(conditions).toHaveLength(1);
    expect(conditions[0]).not.toBe(SQL_FALSE);
  });

  it("admin: Layer 2 produces no scope filter for notes", () => {
    const conditions = buildNoteListConditions(createAdminScope(), {});
    expect(conditions).toHaveLength(1);
    expect(conditions[0]).not.toBe(SQL_FALSE);
  });

  it("teacher (with courses): Layer 2 scopes announcements to ownedCourseIds", () => {
    const conditions = buildAnnouncementListConditions(createTeacherScope({ ownedCourseIds: [1, 2] }), {});
    expect(conditions).toHaveLength(2);
    expect(conditions[0]).not.toBe(SQL_FALSE);
  });
  it("teacher (no courses): Layer 2 returns SQL_FALSE for announcements", () => {
    const conditions = buildAnnouncementListConditions(createTeacherScope(), {});
    expect(conditions).toHaveLength(2);
    expect(conditions[0]).toBe(SQL_FALSE);
  });

  it("admin: Layer 3 allows access to any student-scoped resource", () => {
    const scope = createAdminScope();
    expectAuthorized(() => assignmentPolicy.validateAccess(scope, { studentId: 1 }));
    expectAuthorized(() => assignmentPolicy.validateAccess(scope, { studentId: 999 }));
    expectAuthorized(() => assessmentPolicy.validateAccess(scope, { studentId: 500 }));
  });

  it("teacher: Layer 3 allows access only to owned course-scoped resources", () => {
    const scope = createTeacherScope({ ownedCourseIds: [1, 9999, 42] });
    expectAuthorized(() => notesPolicy.validateAccess(scope, { courseId: 1 }));
    expectAuthorized(() => notesPolicy.validateAccess(scope, { courseId: 9999 }));
    expectAuthorized(() => announcementPolicy.validateAccess(scope, { courseId: 42 }));
  });
  it("teacher: Layer 3 denies access to non-owned course-scoped resources", () => {
    const scope = createTeacherScope({ ownedCourseIds: [1] });
    expectForbidden(() => notesPolicy.validateAccess(scope, { courseId: 999 }));
    expectForbidden(() => announcementPolicy.validateAccess(scope, { courseId: 999 }));
  });
});

// ── Student — Own Records Boundary ────────────────────────────────────────────

describe("Scope Boundary — Student (student-scoped resources)", () => {
  describe("own studentId at the exact boundary", () => {
    it("studentId=42: own assignment ALLOW (Layer 3)", () => {
      const scope = createStudentScope({ studentId: 42 });
      expectAuthorized(() => assignmentPolicy.validateAccess(scope, { studentId: 42 }));
    });

    it("studentId=42: adjacent studentId=41 DENY (Layer 3)", () => {
      const scope = createStudentScope({ studentId: 42 });
      expectForbidden(() => assignmentPolicy.validateAccess(scope, { studentId: 41 }));
    });

    it("studentId=42: adjacent studentId=43 DENY (Layer 3)", () => {
      const scope = createStudentScope({ studentId: 42 });
      expectForbidden(() => assignmentPolicy.validateAccess(scope, { studentId: 43 }));
    });
  });

  describe("Layer 2 scope filter is present (not undefined) when studentId is set", () => {
    it("student with studentId produces non-SQL_FALSE scope condition", () => {
      const scope = createStudentScope({ studentId: 10 });
      const conditions = buildAssignmentListConditions(scope, {});
      expect(conditions[0]).not.toBe(SQL_FALSE);
    });
  });

  describe("empty enrollments → SQL_FALSE for course-scoped resources", () => {
    it("student with enrolledCourseIds=[] → notes list BLOCK (SQL_FALSE)", () => {
      const scope = createStudentScope({ enrolledCourseIds: [] });
      expectLayer2Blocks(buildNoteListConditions(scope, {}));
    });

    it("student with enrolledCourseIds=[] → announcement list BLOCK (SQL_FALSE)", () => {
      const scope = createStudentScope({ enrolledCourseIds: [] });
      expectLayer2Blocks(buildAnnouncementListConditions(scope, {}));
    });

    it("student with enrolledCourseIds=[] → Layer 3 DENY for any courseId", () => {
      const scope = createStudentScope({ enrolledCourseIds: [] });
      expectForbidden(() => notesPolicy.validateAccess(scope, { courseId: 1 }));
      expectForbidden(() => announcementPolicy.validateAccess(scope, { courseId: 1 }));
    });
  });

  describe("enrolled course boundary — exact in/out", () => {
    const enrolled = [10, 20, 30];
    const scope = createStudentScope({ enrolledCourseIds: enrolled });

    enrolled.forEach((courseId) => {
      it(`enrolled courseId=${courseId} → note ALLOW (Layer 3)`, () => {
        expectAuthorized(() => notesPolicy.validateAccess(scope, { courseId }));
      });
    });

    [9, 11, 19, 21, 29, 31, 99].forEach((courseId) => {
      it(`non-enrolled courseId=${courseId} → note DENY (Layer 3)`, () => {
        expectForbidden(() => notesPolicy.validateAccess(scope, { courseId }));
      });
    });
  });
});

// ── Parent — Child Records Boundary ───────────────────────────────────────────

describe("Scope Boundary — Parent (child-scoped resources)", () => {
  describe("childStudentIds boundary (student-scoped resources)", () => {
    it("parent(children=[10,11]) → child 10 assessment ALLOW (Layer 3)", () => {
      const scope = createParentScope({ childStudentIds: [10, 11], childCourseIds: [] });
      expectAuthorized(() => assessmentPolicy.validateAccess(scope, { studentId: 10 }));
    });

    it("parent(children=[10,11]) → child 11 assessment ALLOW (Layer 3)", () => {
      const scope = createParentScope({ childStudentIds: [10, 11], childCourseIds: [] });
      expectAuthorized(() => assessmentPolicy.validateAccess(scope, { studentId: 11 }));
    });

    it("parent(children=[10,11]) → adjacent 9 assessment DENY (Layer 3)", () => {
      const scope = createParentScope({ childStudentIds: [10, 11], childCourseIds: [] });
      expectForbidden(() => assessmentPolicy.validateAccess(scope, { studentId: 9 }));
    });

    it("parent(children=[10,11]) → adjacent 12 assessment DENY (Layer 3)", () => {
      const scope = createParentScope({ childStudentIds: [10, 11], childCourseIds: [] });
      expectForbidden(() => assessmentPolicy.validateAccess(scope, { studentId: 12 }));
    });
  });

  describe("childCourseIds boundary (course-scoped resources)", () => {
    const childCourses = [5, 6, 7];
    const scope = createParentScope({ childStudentIds: [10], childCourseIds: childCourses });

    childCourses.forEach((courseId) => {
      it(`parent(childCourses=[5,6,7]) → courseId=${courseId} note ALLOW (Layer 3)`, () => {
        expectAuthorized(() => notesPolicy.validateAccess(scope, { courseId }));
      });
    });

    [4, 8, 99].forEach((courseId) => {
      it(`parent(childCourses=[5,6,7]) → courseId=${courseId} note DENY (Layer 3)`, () => {
        expectForbidden(() => notesPolicy.validateAccess(scope, { courseId }));
      });
    });
  });

  describe("no children → fully blocked", () => {
    it("parent with childStudentIds=[] → Layer 2 BLOCK (SQL_FALSE) for assignments", () => {
      const scope = createParentScope({ childStudentIds: [], childCourseIds: [] });
      expectLayer2Blocks(buildAssignmentListConditions(scope, {}));
    });

    it("parent with childCourseIds=[] → Layer 2 BLOCK (SQL_FALSE) for notes", () => {
      const scope = createParentScope({ childStudentIds: [], childCourseIds: [] });
      expectLayer2Blocks(buildNoteListConditions(scope, {}));
    });

    it("parent with childStudentIds=[] → Layer 3 DENY for any studentId", () => {
      const scope = createParentScope({ childStudentIds: [], childCourseIds: [] });
      expectForbidden(() => assignmentPolicy.validateAccess(scope, { studentId: 1 }));
    });

    it("parent with childCourseIds=[] → Layer 3 DENY for any courseId", () => {
      const scope = createParentScope({ childStudentIds: [], childCourseIds: [] });
      expectForbidden(() => announcementPolicy.validateAccess(scope, { courseId: 1 }));
    });
  });
});

// ── Guest — Fully Blocked ─────────────────────────────────────────────────────

describe("Scope Boundary — Guest (no access)", () => {
  const guest = createGuestScope();

  it("guest → assignments list → SQL_FALSE (Layer 2)", () => {
    expectLayer2Blocks(buildAssignmentListConditions(guest, {}));
  });

  it("guest → assessments list → SQL_FALSE (Layer 2)", () => {
    expectLayer2Blocks(buildAssessmentListConditions(guest, {}));
  });

  it("guest → notes list → SQL_FALSE (Layer 2)", () => {
    expectLayer2Blocks(buildNoteListConditions(guest, {}));
  });

  it("guest → announcements list → SQL_FALSE (Layer 2)", () => {
    expectLayer2Blocks(buildAnnouncementListConditions(guest, {}));
  });

  it("guest → any assignment detail → DENY (Layer 3)", () => {
    expectForbidden(() => assignmentPolicy.validateAccess(guest, { studentId: 1 }));
  });

  it("guest → any assessment detail → DENY (Layer 3)", () => {
    expectForbidden(() => assessmentPolicy.validateAccess(guest, { studentId: 1 }));
  });

  it("guest → any note detail → DENY (Layer 3)", () => {
    expectForbidden(() => notesPolicy.validateAccess(guest, { courseId: 1 }));
  });

  it("guest → any announcement detail → DENY (Layer 3)", () => {
    expectForbidden(() => announcementPolicy.validateAccess(guest, { courseId: 1 }));
  });
});
