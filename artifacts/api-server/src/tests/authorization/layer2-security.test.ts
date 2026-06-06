/**
 * Layer 2 Security Tests — Query-Level Scope Filtering
 *
 * Verifies that unauthorized records are filtered OUT at the database level
 * before they reach application memory. This is the "deny by query" guarantee.
 *
 * Layer 2 contract:
 *   buildXListConditions(scope, filters) returns a SQL[] array where:
 *   - conditions[0] is the scope filter (undefined omitted, SQL_FALSE = total block)
 *   - conditions[last] is always isNull(deletedAt) (soft-delete guard)
 *   - optional filter conditions (courseId, studentId) are between them
 *
 * Key property being tested: if a role should be blocked, the FIRST condition
 * returned MUST be SQL_FALSE. This ensures the DB executes `WHERE false AND ...`
 * which yields zero rows — no post-query filtering needed or performed.
 *
 * Resources: Assignments, Assessments, Notes, Announcements
 * All four buildXListConditions functions follow the same contract.
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
  expectSoftDeleteGuard,
} from "../helpers/authorization";
import { SQL_FALSE } from "../../lib/scope-filter";
import { buildAssignmentListConditions } from "../../lib/assignments.queries";
import { buildAssessmentListConditions } from "../../lib/assessments.queries";
import { buildNoteListConditions } from "../../lib/notes.queries";
import { buildAnnouncementListConditions } from "../../lib/announcements.queries";

// ── Layer 2 — Assignments ──────────────────────────────────────────────────────

describe("Layer 2 — Assignments: buildAssignmentListConditions", () => {
  describe("Scope conditions", () => {
    it("admin: 1 condition (soft-delete only), no scope filter", () => {
      const c = buildAssignmentListConditions(createAdminScope(), {});
      expect(c).toHaveLength(1);
      expectLayer2Allows(c);
    });

    it("teacher with owned courses: 2 conditions (course scope + soft-delete)", () => {
      const c = buildAssignmentListConditions(createTeacherScope({ ownedCourseIds: [1, 2] }), {});
      expect(c).toHaveLength(2);
      expectLayer2Allows(c);
      expectSoftDeleteGuard(c);
    });

    it("teacher with no courses: 2 conditions (SQL_FALSE + soft-delete)", () => {
      const c = buildAssignmentListConditions(createTeacherScope(), {});
      expect(c).toHaveLength(2);
      expectLayer2Blocks(c);
      expectSoftDeleteGuard(c);
    });

    it("student with studentId: 2 conditions (eq scope + soft-delete)", () => {
      const c = buildAssignmentListConditions(createStudentScope({ studentId: 5 }), {});
      expect(c).toHaveLength(2);
      expectLayer2Allows(c);
      expectSoftDeleteGuard(c);
    });

    it("parent with childStudentIds: 2 conditions (inArray scope + soft-delete)", () => {
      const c = buildAssignmentListConditions(createParentScope({ childStudentIds: [1, 2] }), {});
      expect(c).toHaveLength(2);
      expectLayer2Allows(c);
      expectSoftDeleteGuard(c);
    });

    it("guest: 2 conditions (SQL_FALSE + soft-delete)", () => {
      const c = buildAssignmentListConditions(createGuestScope(), {});
      expect(c).toHaveLength(2);
      expectLayer2Blocks(c);
      expectSoftDeleteGuard(c);
    });
  });

  describe("Filter interactions", () => {
    it("admin + courseId filter: 2 conditions (courseId eq + soft-delete)", () => {
      const c = buildAssignmentListConditions(createAdminScope(), { courseId: 3 });
      expect(c).toHaveLength(2);
      expectLayer2Allows(c);
    });

    it("admin + studentId filter: 2 conditions", () => {
      const c = buildAssignmentListConditions(createAdminScope(), { studentId: 7 });
      expect(c).toHaveLength(2);
      expectLayer2Allows(c);
    });

    it("admin + both filters: 3 conditions (courseId + studentId + soft-delete)", () => {
      const c = buildAssignmentListConditions(createAdminScope(), { courseId: 1, studentId: 2 });
      expect(c).toHaveLength(3);
      expectLayer2Allows(c);
    });

    it("student + studentId filter: 2 conditions (scope only — explicit studentId filter is skipped for non-global roles)", () => {
      // buildAssignmentListConditions skips the explicit studentId filter when !scope.isGlobal.
      // The scope condition eq(student_id, studentId) already handles this — no redundant filter.
      const c = buildAssignmentListConditions(createStudentScope(), { studentId: 42 });
      expect(c).toHaveLength(2);
      expectLayer2Allows(c);
    });
  });

  describe("Scope positions are independent of filter positions", () => {
    it("scope filter is always at index 0 for student", () => {
      const c = buildAssignmentListConditions(createStudentScope({ studentId: 1 }), {});
      expect(c[0]).not.toBe(SQL_FALSE);
    });

    it("soft-delete is always the last condition", () => {
      const c = buildAssignmentListConditions(createAdminScope(), { courseId: 1, studentId: 2 });
      expect(c[c.length - 1]).not.toBe(SQL_FALSE);
    });
  });
});

// ── Layer 2 — Assessments ─────────────────────────────────────────────────────

describe("Layer 2 — Assessments: buildAssessmentListConditions", () => {
  it("admin: 1 condition, allows all", () => {
    const c = buildAssessmentListConditions(createAdminScope(), {});
    expect(c).toHaveLength(1);
    expectLayer2Allows(c);
  });

  it("teacher with owned courses: 2 conditions (course scope + soft-delete), allows owned", () => {
    const c = buildAssessmentListConditions(createTeacherScope({ ownedCourseIds: [1, 2] }), {});
    expect(c).toHaveLength(2);
    expectLayer2Allows(c);
  });

  it("teacher with no courses: SQL_FALSE at position 0", () => {
    expectLayer2Blocks(buildAssessmentListConditions(createTeacherScope(), {}));
  });

  it("student: 2 conditions (scope + deletedAt), allows own", () => {
    const c = buildAssessmentListConditions(createStudentScope({ studentId: 3 }), {});
    expect(c).toHaveLength(2);
    expectLayer2Allows(c);
  });

  it("parent with children: 2 conditions, allows child records", () => {
    const c = buildAssessmentListConditions(createParentScope({ childStudentIds: [5, 6] }), {});
    expect(c).toHaveLength(2);
    expectLayer2Allows(c);
  });

  it("parent with no children: SQL_FALSE at position 0", () => {
    const c = buildAssessmentListConditions(createParentScope({ childStudentIds: [], childCourseIds: [] }), {});
    expectLayer2Blocks(c);
  });

  it("guest: SQL_FALSE at position 0", () => {
    expectLayer2Blocks(buildAssessmentListConditions(createGuestScope(), {}));
  });

  it("admin + filters: 3 conditions total", () => {
    const c = buildAssessmentListConditions(createAdminScope(), { studentId: 1, courseId: 2 });
    expect(c).toHaveLength(3);
    expectLayer2Allows(c);
  });
});

// ── Layer 2 — Notes ───────────────────────────────────────────────────────────

describe("Layer 2 — Notes: buildNoteListConditions", () => {
  it("admin: 1 condition, allows all", () => {
    const c = buildNoteListConditions(createAdminScope(), {});
    expect(c).toHaveLength(1);
    expectLayer2Allows(c);
  });

  it("teacher with owned courses: 2 conditions, allows", () => {
    const c = buildNoteListConditions(createTeacherScope({ ownedCourseIds: [1, 2] }), {});
    expect(c).toHaveLength(2);
    expectLayer2Allows(c);
  });

  it("teacher with no courses: SQL_FALSE at position 0", () => {
    expectLayer2Blocks(buildNoteListConditions(createTeacherScope(), {}));
  });

  it("student with enrolled courses: 2 conditions, allows enrolled", () => {
    const c = buildNoteListConditions(createStudentScope({ enrolledCourseIds: [4, 5] }), {});
    expect(c).toHaveLength(2);
    expectLayer2Allows(c);
  });

  it("student with no enrollments: SQL_FALSE at position 0", () => {
    expectLayer2Blocks(buildNoteListConditions(createStudentScope({ enrolledCourseIds: [] }), {}));
  });

  it("parent with child courses: 2 conditions, allows child courses", () => {
    const c = buildNoteListConditions(createParentScope({ childCourseIds: [2] }), {});
    expect(c).toHaveLength(2);
    expectLayer2Allows(c);
  });

  it("parent with no child courses: SQL_FALSE at position 0", () => {
    expectLayer2Blocks(buildNoteListConditions(createParentScope({ childStudentIds: [], childCourseIds: [] }), {}));
  });

  it("guest: SQL_FALSE at position 0", () => {
    expectLayer2Blocks(buildNoteListConditions(createGuestScope(), {}));
  });

  it("admin + courseId filter: 2 conditions", () => {
    const c = buildNoteListConditions(createAdminScope(), { courseId: 5 });
    expect(c).toHaveLength(2);
    expectLayer2Allows(c);
  });

  it("student + courseId filter: 3 conditions (scope + courseId + deletedAt)", () => {
    const c = buildNoteListConditions(createStudentScope({ enrolledCourseIds: [3] }), { courseId: 3 });
    expect(c).toHaveLength(3);
    expectLayer2Allows(c);
  });
});

// ── Layer 2 — Announcements ───────────────────────────────────────────────────

describe("Layer 2 — Announcements: buildAnnouncementListConditions", () => {
  it("admin: 1 condition, allows all", () => {
    const c = buildAnnouncementListConditions(createAdminScope(), {});
    expect(c).toHaveLength(1);
    expectLayer2Allows(c);
  });

  it("teacher with owned courses: 2 conditions, allows", () => {
    const c = buildAnnouncementListConditions(createTeacherScope({ ownedCourseIds: [3, 4] }), {});
    expect(c).toHaveLength(2);
    expectLayer2Allows(c);
  });

  it("teacher with no courses: SQL_FALSE at position 0", () => {
    expectLayer2Blocks(buildAnnouncementListConditions(createTeacherScope(), {}));
  });

  it("student with enrolled courses: 2 conditions, allows enrolled", () => {
    const c = buildAnnouncementListConditions(createStudentScope({ enrolledCourseIds: [7, 8] }), {});
    expect(c).toHaveLength(2);
    expectLayer2Allows(c);
  });

  it("student with no enrollments: SQL_FALSE", () => {
    expectLayer2Blocks(buildAnnouncementListConditions(createStudentScope({ enrolledCourseIds: [] }), {}));
  });

  it("parent with child courses: 2 conditions, allows child courses", () => {
    const c = buildAnnouncementListConditions(createParentScope({ childCourseIds: [6, 7] }), {});
    expect(c).toHaveLength(2);
    expectLayer2Allows(c);
  });

  it("parent with no child courses: SQL_FALSE", () => {
    expectLayer2Blocks(buildAnnouncementListConditions(createParentScope({ childStudentIds: [], childCourseIds: [] }), {}));
  });

  it("guest: SQL_FALSE", () => {
    expectLayer2Blocks(buildAnnouncementListConditions(createGuestScope(), {}));
  });

  it("student + courseId filter: 3 conditions", () => {
    const c = buildAnnouncementListConditions(createStudentScope({ enrolledCourseIds: [2] }), { courseId: 2 });
    expect(c).toHaveLength(3);
    expectLayer2Allows(c);
  });
});

// ── Cross-resource consistency ─────────────────────────────────────────────────

describe("Layer 2 — Cross-resource consistency invariants", () => {
  it("all four resources: admin produces exactly 1 condition (no scope filter)", () => {
    expect(buildAssignmentListConditions(createAdminScope(), {})).toHaveLength(1);
    expect(buildAssessmentListConditions(createAdminScope(), {})).toHaveLength(1);
    expect(buildNoteListConditions(createAdminScope(), {})).toHaveLength(1);
    expect(buildAnnouncementListConditions(createAdminScope(), {})).toHaveLength(1);
  });

  it("all four resources: guest produces SQL_FALSE as first condition", () => {
    const guest = createGuestScope();
    expect(buildAssignmentListConditions(guest, {})[0]).toBe(SQL_FALSE);
    expect(buildAssessmentListConditions(guest, {})[0]).toBe(SQL_FALSE);
    expect(buildNoteListConditions(guest, {})[0]).toBe(SQL_FALSE);
    expect(buildAnnouncementListConditions(guest, {})[0]).toBe(SQL_FALSE);
  });

  it("all four resources: scoped roles produce at least 2 conditions", () => {
    const student = createStudentScope();
    expect(buildAssignmentListConditions(student, {}).length).toBeGreaterThanOrEqual(2);
    expect(buildAssessmentListConditions(student, {}).length).toBeGreaterThanOrEqual(2);
    expect(buildNoteListConditions(student, {}).length).toBeGreaterThanOrEqual(2);
    expect(buildAnnouncementListConditions(student, {}).length).toBeGreaterThanOrEqual(2);
  });
});
