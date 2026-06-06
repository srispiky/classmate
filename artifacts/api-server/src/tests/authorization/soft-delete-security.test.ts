/**
 * Soft Delete Security Tests
 *
 * Verifies that all RLS-enabled resources respect soft deletion.
 * A deleted record must:
 *   1. Never appear in list queries (Layer 2 isNull(deletedAt) condition)
 *   2. Return null from getById functions (→ 404 at route level)
 *      NOT a 403 — returning 403 for deleted records leaks their existence
 *
 * Resources covered: Assignments, Assessments, Notes, Announcements
 *
 * These tests are structural (unit-level): they verify that the
 * isNull(deletedAt) condition is always appended to query condition arrays,
 * regardless of role. No live DB calls are made.
 *
 * The distinction 404 vs 403 matters for security:
 *   - 403 on a deleted record → attacker learns the ID existed
 *   - 404 on a deleted record → no information disclosure
 *   Our getById functions return null when deletedAt IS NOT NULL → route returns 404.
 */
import { describe, it, expect } from "vitest";
import {
  createAdminScope,
  createTeacherScope,
  createStudentScope,
  createParentScope,
  createGuestScope,
  expectSoftDeleteGuard,
} from "../helpers/authorization";
import { SQL_FALSE } from "../../lib/scope-filter";
import { buildAssignmentListConditions } from "../../lib/assignments.queries";
import { buildAssessmentListConditions } from "../../lib/assessments.queries";
import { buildNoteListConditions } from "../../lib/notes.queries";
import { buildAnnouncementListConditions } from "../../lib/announcements.queries";

// ── Structural: isNull(deletedAt) always present ──────────────────────────────

describe("Soft Delete Security — isNull(deletedAt) guard always present", () => {
  describe("Assignments", () => {
    const cases = [
      { label: "admin", scope: createAdminScope() },
      { label: "teacher", scope: createTeacherScope() },
      { label: "student", scope: createStudentScope() },
      { label: "parent", scope: createParentScope() },
      { label: "guest", scope: createGuestScope() },
    ];

    cases.forEach(({ label, scope }) => {
      it(`${label}: isNull(deletedAt) is the last condition in buildAssignmentListConditions`, () => {
        const conditions = buildAssignmentListConditions(scope, {});
        expectSoftDeleteGuard(conditions);
      });
    });

    it("soft-delete guard is not SQL_FALSE (it's a real isNull check)", () => {
      const conditions = buildAssignmentListConditions(createAdminScope(), {});
      const last = conditions[conditions.length - 1];
      expect(last).not.toBe(SQL_FALSE);
    });

    it("with filters: soft-delete guard remains as final condition", () => {
      const conditions = buildAssignmentListConditions(createAdminScope(), {
        studentId: 5,
        courseId: 2,
      });
      expectSoftDeleteGuard(conditions);
    });
  });

  describe("Assessments", () => {
    const cases = [
      { label: "admin", scope: createAdminScope() },
      { label: "teacher", scope: createTeacherScope() },
      { label: "student", scope: createStudentScope() },
      { label: "parent", scope: createParentScope() },
      { label: "guest", scope: createGuestScope() },
    ];

    cases.forEach(({ label, scope }) => {
      it(`${label}: isNull(deletedAt) is the last condition in buildAssessmentListConditions`, () => {
        const conditions = buildAssessmentListConditions(scope, {});
        expectSoftDeleteGuard(conditions);
      });
    });

    it("with filters: soft-delete guard remains as final condition", () => {
      const conditions = buildAssessmentListConditions(createTeacherScope(), {
        studentId: 3,
        courseId: 1,
      });
      expectSoftDeleteGuard(conditions);
    });
  });

  describe("Notes", () => {
    const cases = [
      { label: "admin", scope: createAdminScope() },
      { label: "teacher", scope: createTeacherScope() },
      { label: "student", scope: createStudentScope() },
      { label: "parent", scope: createParentScope() },
      { label: "guest", scope: createGuestScope() },
    ];

    cases.forEach(({ label, scope }) => {
      it(`${label}: isNull(deletedAt) is the last condition in buildNoteListConditions`, () => {
        const conditions = buildNoteListConditions(scope, {});
        expectSoftDeleteGuard(conditions);
      });
    });

    it("with courseId filter: soft-delete guard remains as final condition", () => {
      const conditions = buildNoteListConditions(createAdminScope(), { courseId: 7 });
      expectSoftDeleteGuard(conditions);
    });
  });

  describe("Announcements", () => {
    const cases = [
      { label: "admin", scope: createAdminScope() },
      { label: "teacher", scope: createTeacherScope() },
      { label: "student", scope: createStudentScope() },
      { label: "parent", scope: createParentScope() },
      { label: "guest", scope: createGuestScope() },
    ];

    cases.forEach(({ label, scope }) => {
      it(`${label}: isNull(deletedAt) is the last condition in buildAnnouncementListConditions`, () => {
        const conditions = buildAnnouncementListConditions(scope, {});
        expectSoftDeleteGuard(conditions);
      });
    });

    it("with courseId filter: soft-delete guard remains as final condition", () => {
      const conditions = buildAnnouncementListConditions(createTeacherScope(), { courseId: 3 });
      expectSoftDeleteGuard(conditions);
    });
  });
});

// ── Condition count invariants ─────────────────────────────────────────────────

describe("Soft Delete Security — condition count invariants", () => {
  describe("Global roles: exactly 1 condition with no filters (soft-delete only)", () => {
    it("admin → assignments: 1 condition", () => {
      expect(buildAssignmentListConditions(createAdminScope(), {})).toHaveLength(1);
    });
    it("teacher → assessments: 1 condition", () => {
      expect(buildAssessmentListConditions(createTeacherScope(), {})).toHaveLength(1);
    });
    it("admin → notes: 1 condition", () => {
      expect(buildNoteListConditions(createAdminScope(), {})).toHaveLength(1);
    });
    it("teacher (with courses) → announcements: 2 conditions (scope + soft-delete)", () => {
      expect(buildAnnouncementListConditions(createTeacherScope({ ownedCourseIds: [1] }), {})).toHaveLength(2);
    });
    it("teacher (no courses) → announcements: 2 conditions (SQL_FALSE + soft-delete)", () => {
      expect(buildAnnouncementListConditions(createTeacherScope(), {})).toHaveLength(2);
    });
  });

  describe("Scoped roles: exactly 2 conditions with no filters (scope + soft-delete)", () => {
    it("student → assignments: 2 conditions (studentId scope + deletedAt)", () => {
      expect(buildAssignmentListConditions(createStudentScope(), {})).toHaveLength(2);
    });
    it("parent → assessments: 2 conditions (childStudentIds scope + deletedAt)", () => {
      expect(buildAssessmentListConditions(createParentScope(), {})).toHaveLength(2);
    });
    it("student → notes: 2 conditions (enrolledCourseIds scope + deletedAt)", () => {
      expect(buildNoteListConditions(createStudentScope(), {})).toHaveLength(2);
    });
    it("parent → announcements: 2 conditions (childCourseIds scope + deletedAt)", () => {
      expect(buildAnnouncementListConditions(createParentScope(), {})).toHaveLength(2);
    });
    it("guest → any resource: 2 conditions (SQL_FALSE + deletedAt)", () => {
      expect(buildAssignmentListConditions(createGuestScope(), {})).toHaveLength(2);
      expect(buildNoteListConditions(createGuestScope(), {})).toHaveLength(2);
    });
  });
});

// ── Isolation: soft-delete does not interfere with scope filter ───────────────

describe("Soft Delete Security — soft-delete condition is independent of scope", () => {
  it("student: scope is at index 0, soft-delete is at index 1", () => {
    const conditions = buildAssignmentListConditions(createStudentScope(), {});
    expect(conditions).toHaveLength(2);
    // scope filter is at [0]
    expect(conditions[0]).not.toBe(SQL_FALSE); // (real inArray condition)
    // soft-delete is at [1]
    expect(conditions[1]).not.toBe(SQL_FALSE);
  });

  it("guest: SQL_FALSE is at index 0, soft-delete is at index 1 (both conditions independent)", () => {
    const conditions = buildAssignmentListConditions(createGuestScope(), {});
    expect(conditions).toHaveLength(2);
    expect(conditions[0]).toBe(SQL_FALSE);      // scope totally denied
    expect(conditions[1]).not.toBe(SQL_FALSE);  // soft-delete is still a real condition
  });
});
