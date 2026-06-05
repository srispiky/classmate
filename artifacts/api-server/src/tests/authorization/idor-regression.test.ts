/**
 * IDOR (Insecure Direct Object Reference) Regression Suite
 *
 * Verifies that incrementing or guessing a resource ID never grants
 * unauthorized access — at both the DB filter level (Layer 2) and the
 * post-fetch policy level (Layer 3).
 *
 * Simulated attack: an attacker (or misbehaving client) probes:
 *   GET /assignments/100
 *   GET /assignments/101
 *   GET /assignments/102
 *   ...
 *
 * The Layer 3 policy.validateAccess() call in the route handler is the
 * last line of defense. This suite confirms it holds for every resource.
 *
 * Resources covered: Assignments, Assessments, Notes, Announcements
 * Roles attacked from: student, parent, guest
 *
 * Expected outcome for all unauthorized accesses: PolicyAuthorizationError
 * which maps to HTTP 403 at the route layer — not 404.
 * (Returning 404 for auth failures enables resource enumeration.)
 */
import { describe, it } from "vitest";
import {
  createStudentScope,
  createParentScope,
  createGuestScope,
  expectForbidden,
  expectLayer2Blocks,
} from "../helpers/authorization";
import { buildAssignmentListConditions } from "../../lib/assignments.queries";
import { buildAssessmentListConditions } from "../../lib/assessments.queries";
import { buildNoteListConditions } from "../../lib/notes.queries";
import { buildAnnouncementListConditions } from "../../lib/announcements.queries";
import { assignmentPolicy } from "../../lib/policies/assignment-scope-policy";
import { assessmentPolicy } from "../../lib/policies/assessment-scope-policy";
import { notesPolicy } from "../../lib/policies/notes-scope-policy";
import { announcementPolicy } from "../../lib/policies/announcement-scope-policy";

// ── Assignment IDOR ───────────────────────────────────────────────────────────

describe("IDOR — Assignments (student-scoped)", () => {
  const student = createStudentScope({ studentId: 42, enrolledCourseIds: [1, 2] });
  const parent  = createParentScope({ childStudentIds: [10], childCourseIds: [1] });
  const guest   = createGuestScope();

  const FOREIGN_STUDENT_IDS = [1, 41, 43, 100, 101, 102, 999];

  describe("student probing foreign studentId resources", () => {
    FOREIGN_STUDENT_IDS.forEach((targetStudentId) => {
      it(`student(42) → assignment(studentId=${targetStudentId}) → DENY`, () => {
        expectForbidden(() => assignmentPolicy.validateAccess(student, { studentId: targetStudentId }));
      });
    });
  });

  describe("parent probing non-child studentId resources", () => {
    const nonChildIds = [1, 9, 12, 42, 100, 999];
    nonChildIds.forEach((targetStudentId) => {
      it(`parent(children=[10]) → assignment(studentId=${targetStudentId}) → DENY`, () => {
        expectForbidden(() => assignmentPolicy.validateAccess(parent, { studentId: targetStudentId }));
      });
    });
  });

  describe("guest probing any assignment", () => {
    [1, 42, 100].forEach((studentId) => {
      it(`guest → assignment(studentId=${studentId}) → DENY (Layer 3)`, () => {
        expectForbidden(() => assignmentPolicy.validateAccess(guest, { studentId }));
      });
    });

    it("guest → assignment list → BLOCK (Layer 2 SQL_FALSE)", () => {
      expectLayer2Blocks(buildAssignmentListConditions(guest, {}));
    });
  });
});

// ── Assessment IDOR ───────────────────────────────────────────────────────────

describe("IDOR — Assessments (student-scoped)", () => {
  const student = createStudentScope({ studentId: 7, enrolledCourseIds: [3] });
  const parent  = createParentScope({ childStudentIds: [20, 21], childCourseIds: [3] });
  const guest   = createGuestScope();

  const FOREIGN_STUDENT_IDS = [1, 6, 8, 100, 101, 102, 999];

  describe("student probing foreign studentId assessments", () => {
    FOREIGN_STUDENT_IDS.forEach((targetStudentId) => {
      it(`student(7) → assessment(studentId=${targetStudentId}) → DENY`, () => {
        expectForbidden(() => assessmentPolicy.validateAccess(student, { studentId: targetStudentId }));
      });
    });
  });

  describe("parent probing non-child studentId assessments", () => {
    const nonChildIds = [1, 7, 19, 22, 100];
    nonChildIds.forEach((targetStudentId) => {
      it(`parent(children=[20,21]) → assessment(studentId=${targetStudentId}) → DENY`, () => {
        expectForbidden(() => assessmentPolicy.validateAccess(parent, { studentId: targetStudentId }));
      });
    });
  });

  describe("guest probing any assessment", () => {
    [7, 20, 100].forEach((studentId) => {
      it(`guest → assessment(studentId=${studentId}) → DENY`, () => {
        expectForbidden(() => assessmentPolicy.validateAccess(guest, { studentId }));
      });
    });

    it("guest → assessment list → BLOCK (Layer 2 SQL_FALSE)", () => {
      expectLayer2Blocks(buildAssessmentListConditions(guest, {}));
    });
  });
});

// ── Notes IDOR ────────────────────────────────────────────────────────────────

describe("IDOR — Notes (course-scoped)", () => {
  const student = createStudentScope({ studentId: 42, enrolledCourseIds: [1, 2, 3] });
  const parent  = createParentScope({ childStudentIds: [10], childCourseIds: [1, 2, 3] });
  const guest   = createGuestScope();

  const FOREIGN_COURSE_IDS = [4, 5, 50, 100, 101, 102, 999];

  describe("student probing notes from non-enrolled courses", () => {
    FOREIGN_COURSE_IDS.forEach((courseId) => {
      it(`student(enrolled=[1,2,3]) → note(courseId=${courseId}) → DENY (Layer 3)`, () => {
        expectForbidden(() => notesPolicy.validateAccess(student, { courseId }));
      });
    });
  });

  describe("student probing notes via list — non-enrolled courses yield SQL_FALSE", () => {
    it("student with no enrollments → list query BLOCK (SQL_FALSE)", () => {
      const emptyStudent = createStudentScope({ enrolledCourseIds: [] });
      expectLayer2Blocks(buildNoteListConditions(emptyStudent, {}));
    });
  });

  describe("parent probing notes from non-child courses", () => {
    const nonChildCourses = [4, 5, 50, 100, 999];
    nonChildCourses.forEach((courseId) => {
      it(`parent(childCourses=[1,2,3]) → note(courseId=${courseId}) → DENY`, () => {
        expectForbidden(() => notesPolicy.validateAccess(parent, { courseId }));
      });
    });
  });

  describe("guest probing any note", () => {
    [1, 2, 100].forEach((courseId) => {
      it(`guest → note(courseId=${courseId}) → DENY`, () => {
        expectForbidden(() => notesPolicy.validateAccess(guest, { courseId }));
      });
    });

    it("guest → notes list → BLOCK (Layer 2 SQL_FALSE)", () => {
      expectLayer2Blocks(buildNoteListConditions(guest, {}));
    });
  });
});

// ── Announcement IDOR ─────────────────────────────────────────────────────────

describe("IDOR — Announcements (course-scoped)", () => {
  const student = createStudentScope({ studentId: 5, enrolledCourseIds: [10, 11] });
  const parent  = createParentScope({ childStudentIds: [30], childCourseIds: [10, 11] });
  const guest   = createGuestScope();

  const FOREIGN_COURSE_IDS = [1, 9, 12, 50, 100, 101, 102, 999];

  describe("student probing announcements from non-enrolled courses", () => {
    FOREIGN_COURSE_IDS.forEach((courseId) => {
      it(`student(enrolled=[10,11]) → announcement(courseId=${courseId}) → DENY`, () => {
        expectForbidden(() => announcementPolicy.validateAccess(student, { courseId }));
      });
    });
  });

  describe("student probing via list — non-enrolled courses produce SQL_FALSE", () => {
    it("student with no enrollments → list query BLOCK (SQL_FALSE)", () => {
      const emptyStudent = createStudentScope({ enrolledCourseIds: [] });
      expectLayer2Blocks(buildAnnouncementListConditions(emptyStudent, {}));
    });
  });

  describe("parent probing announcements from non-child courses", () => {
    const nonChildCourses = [1, 9, 12, 50, 999];
    nonChildCourses.forEach((courseId) => {
      it(`parent(childCourses=[10,11]) → announcement(courseId=${courseId}) → DENY`, () => {
        expectForbidden(() => announcementPolicy.validateAccess(parent, { courseId }));
      });
    });
  });

  describe("guest probing any announcement", () => {
    [10, 11, 100].forEach((courseId) => {
      it(`guest → announcement(courseId=${courseId}) → DENY`, () => {
        expectForbidden(() => announcementPolicy.validateAccess(guest, { courseId }));
      });
    });

    it("guest → announcements list → BLOCK (Layer 2 SQL_FALSE)", () => {
      expectLayer2Blocks(buildAnnouncementListConditions(guest, {}));
    });
  });
});
