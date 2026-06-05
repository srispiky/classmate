/**
 * Cross-Role Authorization Access Matrix
 *
 * Validates the expected access behavior for every role × resource combination.
 * This is the primary regression guard — any future change that widens or narrows
 * access beyond the intended matrix will be caught here immediately.
 *
 * Matrix (Layer 2 — list-level access):
 * ┌──────────────┬────────────┬─────────────┬───────────┬───────────────┐
 * │ Role         │ Assignments│ Assessments │ Notes     │ Announcements │
 * ├──────────────┼────────────┼─────────────┼───────────┼───────────────┤
 * │ admin        │ ALLOW (all)│ ALLOW (all) │ ALLOW(all)│ ALLOW (all)   │
 * │ teacher      │ ALLOW (all)│ ALLOW (all) │ ALLOW(all)│ ALLOW (all)   │
 * │ student      │ ALLOW(own) │ ALLOW (own) │ ALLOW(enr)│ ALLOW (enr)   │
 * │ parent       │ ALLOW(child│ ALLOW(child)│ ALLOW(ch) │ ALLOW (child) │
 * │ guest        │ BLOCK      │ BLOCK       │ BLOCK     │ BLOCK         │
 * └──────────────┴────────────┴─────────────┴───────────┴───────────────┘
 *
 * Abbreviations: own=own student, enr=enrolled courses, ch=child courses
 *
 * Layer 3 (detail-level access) matrix:
 * ┌──────────────┬────────────────────────────────────────────────────┐
 * │ Role         │ Access to own resource    │ Access to other's      │
 * ├──────────────┼───────────────────────────┼────────────────────────┤
 * │ admin        │ ALLOW                     │ ALLOW                  │
 * │ teacher      │ ALLOW                     │ ALLOW                  │
 * │ student      │ ALLOW (own/enrolled)      │ DENY (403)             │
 * │ parent       │ ALLOW (child/childCourses)│ DENY (403)             │
 * │ guest        │ DENY (403)                │ DENY (403)             │
 * └──────────────┴───────────────────────────┴────────────────────────┘
 */
import { describe, it } from "vitest";
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
import { buildAssignmentListConditions } from "../../lib/assignments.queries";
import { buildAssessmentListConditions } from "../../lib/assessments.queries";
import { buildNoteListConditions } from "../../lib/notes.queries";
import { buildAnnouncementListConditions } from "../../lib/announcements.queries";
import { assignmentPolicy } from "../../lib/policies/assignment-scope-policy";
import { assessmentPolicy } from "../../lib/policies/assessment-scope-policy";
import { notesPolicy } from "../../lib/policies/notes-scope-policy";
import { announcementPolicy } from "../../lib/policies/announcement-scope-policy";

// ── Layer 2 Matrix — list-level DB filter ────────────────────────────────────

describe("Access Matrix — Layer 2 (list endpoint scope filters)", () => {
  describe("Assignments", () => {
    it("admin → ALLOW (no scope filter)", () => {
      expectLayer2Allows(buildAssignmentListConditions(createAdminScope(), {}));
    });
    it("teacher → ALLOW (no scope filter)", () => {
      expectLayer2Allows(buildAssignmentListConditions(createTeacherScope(), {}));
    });
    it("student → ALLOW (scoped to own studentId)", () => {
      expectLayer2Allows(buildAssignmentListConditions(createStudentScope(), {}));
    });
    it("parent → ALLOW (scoped to childStudentIds)", () => {
      expectLayer2Allows(buildAssignmentListConditions(createParentScope(), {}));
    });
    it("guest → BLOCK (SQL_FALSE)", () => {
      expectLayer2Blocks(buildAssignmentListConditions(createGuestScope(), {}));
    });
  });

  describe("Assessments", () => {
    it("admin → ALLOW (no scope filter)", () => {
      expectLayer2Allows(buildAssessmentListConditions(createAdminScope(), {}));
    });
    it("teacher → ALLOW (no scope filter)", () => {
      expectLayer2Allows(buildAssessmentListConditions(createTeacherScope(), {}));
    });
    it("student → ALLOW (scoped to own studentId)", () => {
      expectLayer2Allows(buildAssessmentListConditions(createStudentScope(), {}));
    });
    it("parent → ALLOW (scoped to childStudentIds)", () => {
      expectLayer2Allows(buildAssessmentListConditions(createParentScope(), {}));
    });
    it("guest → BLOCK (SQL_FALSE)", () => {
      expectLayer2Blocks(buildAssessmentListConditions(createGuestScope(), {}));
    });
  });

  describe("Notes", () => {
    it("admin → ALLOW (no scope filter)", () => {
      expectLayer2Allows(buildNoteListConditions(createAdminScope(), {}));
    });
    it("teacher → ALLOW (no scope filter)", () => {
      expectLayer2Allows(buildNoteListConditions(createTeacherScope(), {}));
    });
    it("student → ALLOW (scoped to enrolledCourseIds)", () => {
      expectLayer2Allows(buildNoteListConditions(createStudentScope(), {}));
    });
    it("parent → ALLOW (scoped to childCourseIds)", () => {
      expectLayer2Allows(buildNoteListConditions(createParentScope(), {}));
    });
    it("guest → BLOCK (SQL_FALSE)", () => {
      expectLayer2Blocks(buildNoteListConditions(createGuestScope(), {}));
    });
  });

  describe("Announcements", () => {
    it("admin → ALLOW (no scope filter)", () => {
      expectLayer2Allows(buildAnnouncementListConditions(createAdminScope(), {}));
    });
    it("teacher → ALLOW (no scope filter)", () => {
      expectLayer2Allows(buildAnnouncementListConditions(createTeacherScope(), {}));
    });
    it("student → ALLOW (scoped to enrolledCourseIds)", () => {
      expectLayer2Allows(buildAnnouncementListConditions(createStudentScope(), {}));
    });
    it("parent → ALLOW (scoped to childCourseIds)", () => {
      expectLayer2Allows(buildAnnouncementListConditions(createParentScope(), {}));
    });
    it("guest → BLOCK (SQL_FALSE)", () => {
      expectLayer2Blocks(buildAnnouncementListConditions(createGuestScope(), {}));
    });
  });
});

// ── Layer 3 Matrix — detail-level policy validation ──────────────────────────

describe("Access Matrix — Layer 3 (detail endpoint policy validation)", () => {
  // Student-scoped resources (Assignments, Assessments)
  describe("Assignments — student-scoped resource", () => {
    const owned = { studentId: 42 };   // matches default createStudentScope().studentId
    const other = { studentId: 999 };  // never matches any default scope

    it("admin → own resource ALLOW", () => expectAuthorized(() => assignmentPolicy.validateAccess(createAdminScope(), owned)));
    it("admin → other resource ALLOW (global)", () => expectAuthorized(() => assignmentPolicy.validateAccess(createAdminScope(), other)));
    it("teacher → own resource ALLOW", () => expectAuthorized(() => assignmentPolicy.validateAccess(createTeacherScope(), owned)));
    it("teacher → other resource ALLOW (global)", () => expectAuthorized(() => assignmentPolicy.validateAccess(createTeacherScope(), other)));
    it("student → own resource ALLOW", () => expectAuthorized(() => assignmentPolicy.validateAccess(createStudentScope(), owned)));
    it("student → other resource DENY", () => expectForbidden(() => assignmentPolicy.validateAccess(createStudentScope(), other)));
    it("parent → child resource ALLOW", () => expectAuthorized(() => assignmentPolicy.validateAccess(createParentScope(), { studentId: 10 })));
    it("parent → non-child resource DENY", () => expectForbidden(() => assignmentPolicy.validateAccess(createParentScope(), other)));
    it("guest → any resource DENY", () => expectForbidden(() => assignmentPolicy.validateAccess(createGuestScope(), owned)));
  });

  describe("Assessments — student-scoped resource", () => {
    const owned = { studentId: 42 };
    const other = { studentId: 999 };

    it("admin → any resource ALLOW", () => expectAuthorized(() => assessmentPolicy.validateAccess(createAdminScope(), other)));
    it("teacher → any resource ALLOW", () => expectAuthorized(() => assessmentPolicy.validateAccess(createTeacherScope(), other)));
    it("student → own resource ALLOW", () => expectAuthorized(() => assessmentPolicy.validateAccess(createStudentScope(), owned)));
    it("student → other resource DENY", () => expectForbidden(() => assessmentPolicy.validateAccess(createStudentScope(), other)));
    it("parent → child resource ALLOW", () => expectAuthorized(() => assessmentPolicy.validateAccess(createParentScope(), { studentId: 10 })));
    it("parent → non-child resource DENY", () => expectForbidden(() => assessmentPolicy.validateAccess(createParentScope(), other)));
    it("guest → any resource DENY", () => expectForbidden(() => assessmentPolicy.validateAccess(createGuestScope(), owned)));
  });

  // Course-scoped resources (Notes, Announcements)
  describe("Notes — course-scoped resource", () => {
    const enrolled = { courseId: 1 };    // within default enrolledCourseIds=[1,2,3]
    const foreign  = { courseId: 999 };  // outside any default scope

    it("admin → any course ALLOW", () => expectAuthorized(() => notesPolicy.validateAccess(createAdminScope(), foreign)));
    it("teacher → any course ALLOW", () => expectAuthorized(() => notesPolicy.validateAccess(createTeacherScope(), foreign)));
    it("student → enrolled course ALLOW", () => expectAuthorized(() => notesPolicy.validateAccess(createStudentScope(), enrolled)));
    it("student → non-enrolled course DENY", () => expectForbidden(() => notesPolicy.validateAccess(createStudentScope(), foreign)));
    it("parent → child course ALLOW", () => expectAuthorized(() => notesPolicy.validateAccess(createParentScope(), enrolled)));
    it("parent → non-child course DENY", () => expectForbidden(() => notesPolicy.validateAccess(createParentScope(), foreign)));
    it("guest → any course DENY", () => expectForbidden(() => notesPolicy.validateAccess(createGuestScope(), enrolled)));
  });

  describe("Announcements — course-scoped resource", () => {
    const enrolled = { courseId: 1 };
    const foreign  = { courseId: 999 };

    it("admin → any course ALLOW", () => expectAuthorized(() => announcementPolicy.validateAccess(createAdminScope(), foreign)));
    it("teacher → any course ALLOW", () => expectAuthorized(() => announcementPolicy.validateAccess(createTeacherScope(), foreign)));
    it("student → enrolled course ALLOW", () => expectAuthorized(() => announcementPolicy.validateAccess(createStudentScope(), enrolled)));
    it("student → non-enrolled course DENY", () => expectForbidden(() => announcementPolicy.validateAccess(createStudentScope(), foreign)));
    it("parent → child course ALLOW", () => expectAuthorized(() => announcementPolicy.validateAccess(createParentScope(), enrolled)));
    it("parent → non-child course DENY", () => expectForbidden(() => announcementPolicy.validateAccess(createParentScope(), foreign)));
    it("guest → any course DENY", () => expectForbidden(() => announcementPolicy.validateAccess(createGuestScope(), enrolled)));
  });
});
