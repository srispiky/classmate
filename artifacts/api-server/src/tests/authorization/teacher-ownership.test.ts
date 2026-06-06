/**
 * Teacher Ownership Unification — IDOR + Regression Tests
 *
 * Sprint 4 Chunk 9: All resource policies (Assignments, Assessments, Notes,
 * Announcements) now enforce teacher course-ownership. This file verifies:
 *
 * 1. Regression: teacher sees owned-course resources, not non-owned ones (Layer 2+3)
 * 2. IDOR: Teacher A cannot access Teacher B's course resources at Layer 3
 * 3. Cross-policy consistency: all four policies behave identically for teachers
 * 4. Student/parent access rules remain unchanged after the refactor
 */

import { describe, it, expect } from "vitest";
import { SQL_FALSE } from "../../lib/scope-filter";
import { PolicyAuthorizationError } from "../../lib/policies";
import { assignmentPolicy } from "../../lib/policies/assignment-scope-policy";
import { assessmentPolicy } from "../../lib/policies/assessment-scope-policy";
import { notesPolicy } from "../../lib/policies/notes-scope-policy";
import { announcementPolicy } from "../../lib/policies/announcement-scope-policy";
import {
  createAdminScope,
  createTeacherScope,
  createStudentScope,
  createParentScope,
} from "../helpers/authorization/sessions";

// ── Cross-policy consistency ──────────────────────────────────────────────────
//
// All four policies must behave identically for teachers at Layer 2 and Layer 3.
// This section verifies there is no "global access" survivor hiding in any policy.

describe("Cross-policy consistency — teacher Layer 2 (getScopeCondition)", () => {
  const OWNED = [10, 20];

  it("AssignmentScopePolicy: teacher with owned courses → non-SQL_FALSE condition", () => {
    const scope = createTeacherScope({ ownedCourseIds: OWNED });
    expect(assignmentPolicy.getScopeCondition(scope)).not.toBe(SQL_FALSE);
    expect(assignmentPolicy.getScopeCondition(scope)).toBeDefined();
  });

  it("AssignmentScopePolicy: teacher with no owned courses → SQL_FALSE", () => {
    expect(assignmentPolicy.getScopeCondition(createTeacherScope({ ownedCourseIds: [] }))).toBe(SQL_FALSE);
  });

  it("AssessmentScopePolicy: teacher with owned courses → non-SQL_FALSE condition", () => {
    const scope = createTeacherScope({ ownedCourseIds: OWNED });
    expect(assessmentPolicy.getScopeCondition(scope)).not.toBe(SQL_FALSE);
    expect(assessmentPolicy.getScopeCondition(scope)).toBeDefined();
  });

  it("AssessmentScopePolicy: teacher with no owned courses → SQL_FALSE", () => {
    expect(assessmentPolicy.getScopeCondition(createTeacherScope({ ownedCourseIds: [] }))).toBe(SQL_FALSE);
  });

  it("NotesScopePolicy: teacher with owned courses → non-SQL_FALSE condition", () => {
    const scope = createTeacherScope({ ownedCourseIds: OWNED });
    expect(notesPolicy.getScopeCondition(scope)).not.toBe(SQL_FALSE);
    expect(notesPolicy.getScopeCondition(scope)).toBeDefined();
  });

  it("NotesScopePolicy: teacher with no owned courses → SQL_FALSE", () => {
    expect(notesPolicy.getScopeCondition(createTeacherScope({ ownedCourseIds: [] }))).toBe(SQL_FALSE);
  });

  it("AnnouncementScopePolicy: teacher with owned courses → non-SQL_FALSE condition", () => {
    const scope = createTeacherScope({ ownedCourseIds: OWNED });
    expect(announcementPolicy.getScopeCondition(scope)).not.toBe(SQL_FALSE);
    expect(announcementPolicy.getScopeCondition(scope)).toBeDefined();
  });

  it("AnnouncementScopePolicy: teacher with no owned courses → SQL_FALSE", () => {
    expect(announcementPolicy.getScopeCondition(createTeacherScope({ ownedCourseIds: [] }))).toBe(SQL_FALSE);
  });

  it("admin → undefined (no filter) across all four policies", () => {
    const admin = createAdminScope();
    expect(assignmentPolicy.getScopeCondition(admin)).toBeUndefined();
    expect(assessmentPolicy.getScopeCondition(admin)).toBeUndefined();
    expect(notesPolicy.getScopeCondition(admin)).toBeUndefined();
    expect(announcementPolicy.getScopeCondition(admin)).toBeUndefined();
  });
});

// ── Teacher IDOR — Assignment ─────────────────────────────────────────────────
//
// Teacher A owns Course A. Teacher B owns Course B.
// Teacher A must be denied access to any resource from Course B at Layer 3.

describe("Teacher IDOR — Assignment (Layer 3 validateAccess)", () => {
  const COURSE_A = 10;
  const COURSE_B = 20;
  const STUDENT_ID = 5;

  const teacherA = createTeacherScope({ ownedCourseIds: [COURSE_A] });
  const admin = createAdminScope();

  it("Teacher A: passes for assignment in Course A (owned)", () => {
    expect(() =>
      assignmentPolicy.validateAccess(teacherA, { studentId: STUDENT_ID, courseId: COURSE_A }),
    ).not.toThrow();
  });

  it("Teacher A IDOR: throws PolicyAuthorizationError for assignment in Course B (not owned)", () => {
    expect(() =>
      assignmentPolicy.validateAccess(teacherA, { studentId: STUDENT_ID, courseId: COURSE_B }),
    ).toThrow(PolicyAuthorizationError);
  });

  it("Teacher A: denied even if studentId would pass — courseId governs for teachers", () => {
    expect(() =>
      assignmentPolicy.validateAccess(teacherA, { studentId: 1, courseId: COURSE_B }),
    ).toThrow(PolicyAuthorizationError);
  });

  it("admin: passes for both Course A and Course B assignments", () => {
    expect(() =>
      assignmentPolicy.validateAccess(admin, { studentId: STUDENT_ID, courseId: COURSE_A }),
    ).not.toThrow();
    expect(() =>
      assignmentPolicy.validateAccess(admin, { studentId: STUDENT_ID, courseId: COURSE_B }),
    ).not.toThrow();
  });
});

// ── Teacher IDOR — Assessment ─────────────────────────────────────────────────

describe("Teacher IDOR — Assessment (Layer 3 validateAccess)", () => {
  const COURSE_A = 10;
  const COURSE_B = 20;

  const teacherA = createTeacherScope({ ownedCourseIds: [COURSE_A] });
  const admin = createAdminScope();

  it("Teacher A: passes for assessment in Course A (owned)", () => {
    expect(() =>
      assessmentPolicy.validateAccess(teacherA, { studentId: 3, courseId: COURSE_A }),
    ).not.toThrow();
  });

  it("Teacher A IDOR: throws PolicyAuthorizationError for assessment in Course B (not owned)", () => {
    expect(() =>
      assessmentPolicy.validateAccess(teacherA, { studentId: 3, courseId: COURSE_B }),
    ).toThrow(PolicyAuthorizationError);
  });

  it("admin: passes for both Course A and Course B assessments", () => {
    expect(() =>
      assessmentPolicy.validateAccess(admin, { studentId: 3, courseId: COURSE_A }),
    ).not.toThrow();
    expect(() =>
      assessmentPolicy.validateAccess(admin, { studentId: 3, courseId: COURSE_B }),
    ).not.toThrow();
  });
});

// ── Teacher IDOR — Notes ──────────────────────────────────────────────────────

describe("Teacher IDOR — Notes (Layer 3 validateAccess)", () => {
  const COURSE_A = 10;
  const COURSE_B = 20;

  const teacherA = createTeacherScope({ ownedCourseIds: [COURSE_A] });

  it("Teacher A: passes for note in Course A (owned)", () => {
    expect(() => notesPolicy.validateAccess(teacherA, { courseId: COURSE_A })).not.toThrow();
  });

  it("Teacher A IDOR: throws PolicyAuthorizationError for note in Course B (not owned)", () => {
    expect(() =>
      notesPolicy.validateAccess(teacherA, { courseId: COURSE_B }),
    ).toThrow(PolicyAuthorizationError);
  });
});

// ── Teacher IDOR — Announcements ──────────────────────────────────────────────

describe("Teacher IDOR — Announcements (Layer 3 validateAccess)", () => {
  const COURSE_A = 10;
  const COURSE_B = 20;

  const teacherA = createTeacherScope({ ownedCourseIds: [COURSE_A] });

  it("Teacher A: passes for announcement in Course A (owned)", () => {
    expect(() =>
      announcementPolicy.validateAccess(teacherA, { courseId: COURSE_A }),
    ).not.toThrow();
  });

  it("Teacher A IDOR: throws PolicyAuthorizationError for announcement in Course B (not owned)", () => {
    expect(() =>
      announcementPolicy.validateAccess(teacherA, { courseId: COURSE_B }),
    ).toThrow(PolicyAuthorizationError);
  });
});

// ── Regression — student access rules unchanged ───────────────────────────────

describe("Regression — student access rules after Chunk 9 refactor", () => {
  it("student sees own assignments (Layer 2 produces eq condition, not SQL_FALSE)", () => {
    const scope = createStudentScope({ studentId: 5, enrolledCourseIds: [10, 20] });
    expect(assignmentPolicy.getScopeCondition(scope)).toBeDefined();
    expect(assignmentPolicy.getScopeCondition(scope)).not.toBe(SQL_FALSE);
  });

  it("student passes Layer 3 for own assignment", () => {
    const scope = createStudentScope({ studentId: 5, enrolledCourseIds: [10] });
    expect(() =>
      assignmentPolicy.validateAccess(scope, { studentId: 5, courseId: 10 }),
    ).not.toThrow();
  });

  it("student IDOR blocked at Layer 3 for other student's assignment", () => {
    const scope = createStudentScope({ studentId: 5, enrolledCourseIds: [10] });
    expect(() =>
      assignmentPolicy.validateAccess(scope, { studentId: 9, courseId: 10 }),
    ).toThrow(PolicyAuthorizationError);
  });

  it("student sees own assessments (Layer 2 produces eq condition, not SQL_FALSE)", () => {
    const scope = createStudentScope({ studentId: 5, enrolledCourseIds: [10] });
    expect(assessmentPolicy.getScopeCondition(scope)).toBeDefined();
    expect(assessmentPolicy.getScopeCondition(scope)).not.toBe(SQL_FALSE);
  });

  it("student with empty enrolledCourseIds → SQL_FALSE for notes and announcements", () => {
    const scope = createStudentScope({ studentId: 5, enrolledCourseIds: [] });
    expect(notesPolicy.getScopeCondition(scope)).toBe(SQL_FALSE);
    expect(announcementPolicy.getScopeCondition(scope)).toBe(SQL_FALSE);
  });
});

// ── Regression — parent access rules unchanged ────────────────────────────────

describe("Regression — parent access rules after Chunk 9 refactor", () => {
  it("parent sees children's assignments (Layer 2 produces inArray, not SQL_FALSE)", () => {
    const scope = createParentScope({ childStudentIds: [2, 4], childCourseIds: [10, 20] });
    expect(assignmentPolicy.getScopeCondition(scope)).toBeDefined();
    expect(assignmentPolicy.getScopeCondition(scope)).not.toBe(SQL_FALSE);
  });

  it("parent passes Layer 3 for child's assignment", () => {
    const scope = createParentScope({ childStudentIds: [2, 4], childCourseIds: [10] });
    expect(() =>
      assignmentPolicy.validateAccess(scope, { studentId: 2, courseId: 10 }),
    ).not.toThrow();
  });

  it("parent IDOR blocked at Layer 3 for non-child assignment", () => {
    const scope = createParentScope({ childStudentIds: [2, 4], childCourseIds: [10] });
    expect(() =>
      assignmentPolicy.validateAccess(scope, { studentId: 7, courseId: 10 }),
    ).toThrow(PolicyAuthorizationError);
  });

  it("parent sees notes/announcements for child courses", () => {
    const scope = createParentScope({ childStudentIds: [2], childCourseIds: [10, 20] });
    expect(notesPolicy.getScopeCondition(scope)).toBeDefined();
    expect(notesPolicy.getScopeCondition(scope)).not.toBe(SQL_FALSE);
    expect(announcementPolicy.getScopeCondition(scope)).toBeDefined();
    expect(announcementPolicy.getScopeCondition(scope)).not.toBe(SQL_FALSE);
  });

  it("parent with no children → SQL_FALSE for assignments and assessments", () => {
    const scope = createParentScope({ childStudentIds: [], childCourseIds: [] });
    expect(assignmentPolicy.getScopeCondition(scope)).toBe(SQL_FALSE);
    expect(assessmentPolicy.getScopeCondition(scope)).toBe(SQL_FALSE);
  });
});
