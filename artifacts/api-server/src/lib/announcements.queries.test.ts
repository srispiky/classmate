import { describe, it, expect } from "vitest";
import { announcementsTable } from "@workspace/db";
import { buildScopeContext, type ClassmateSession } from "./scope-context";
import { announcementPolicy } from "./policies/announcement-scope-policy";
import { PolicyAuthorizationError } from "./policies";
import { CourseAuthorizationError } from "./course-scope-validator";
import { SQL_FALSE } from "./scope-filter";
import { buildAnnouncementListConditions } from "./announcements.queries";

// ── helpers ──────────────────────────────────────────────────────────────────

function session(overrides: Partial<ClassmateSession> = {}): ClassmateSession {
  return {
    userId: 1,
    username: "test",
    displayName: "Test",
    role: "admin",
    studentId: undefined,
    childStudentIds: undefined,
    childCourseIds: undefined,
    enrolledCourseIds: undefined,
    ...overrides,
  } as ClassmateSession;
}

// ── buildAnnouncementListConditions — Layer 2 scope filtering ─────────────────

describe("buildAnnouncementListConditions — admin scope", () => {
  it("produces only the deletedAt guard for admin (no scope filter)", () => {
    const scope = buildScopeContext(session({ role: "admin" }));
    const conditions = buildAnnouncementListConditions(scope, {});
    expect(conditions).toHaveLength(1);
    expect(conditions[0]).not.toBe(SQL_FALSE);
  });

  it("applies courseId filter alongside no scope condition for admin", () => {
    const scope = buildScopeContext(session({ role: "admin" }));
    const conditions = buildAnnouncementListConditions(scope, { courseId: 5 });
    expect(conditions).toHaveLength(2);
    expect(conditions).not.toContain(SQL_FALSE);
  });
});

describe("buildAnnouncementListConditions — teacher scope", () => {
  it("teacher with owned courses: 2 conditions (scope + soft-delete)", () => {
    const scope = buildScopeContext(session({ role: "teacher", ownedCourseIds: [1, 2] }));
    const conditions = buildAnnouncementListConditions(scope, {});
    expect(conditions).toHaveLength(2);
    expect(conditions[0]).not.toBe(SQL_FALSE);
  });
  it("teacher with no courses: SQL_FALSE at position 0", () => {
    const scope = buildScopeContext(session({ role: "teacher" }));
    const conditions = buildAnnouncementListConditions(scope, {});
    expect(conditions).toHaveLength(2);
    expect(conditions[0]).toBe(SQL_FALSE);
  });
});

describe("buildAnnouncementListConditions — student scope", () => {
  it("adds inArray(course_id, enrolledCourseIds) when enrollments are set", () => {
    const scope = buildScopeContext(session({ role: "student", enrolledCourseIds: [1, 3, 5] }));
    const conditions = buildAnnouncementListConditions(scope, {});
    // [inArray(courseId, [1,3,5]), isNull(deletedAt)]
    expect(conditions).toHaveLength(2);
    expect(conditions[0]).not.toBe(SQL_FALSE);
  });

  it("returns SQL_FALSE when enrolledCourseIds is empty", () => {
    const scope = buildScopeContext(session({ role: "student", enrolledCourseIds: [] }));
    const conditions = buildAnnouncementListConditions(scope, {});
    expect(conditions).toHaveLength(2);
    expect(conditions[0]).toBe(SQL_FALSE);
  });

  it("returns SQL_FALSE when enrolledCourseIds is undefined", () => {
    const scope = buildScopeContext(session({ role: "student", enrolledCourseIds: undefined }));
    const conditions = buildAnnouncementListConditions(scope, {});
    expect(conditions).toHaveLength(2);
    expect(conditions[0]).toBe(SQL_FALSE);
  });

  it("applies courseId filter alongside enrollment scope", () => {
    const scope = buildScopeContext(session({ role: "student", enrolledCourseIds: [2, 4] }));
    const conditions = buildAnnouncementListConditions(scope, { courseId: 2 });
    // [inArray(courseId, [2,4]), eq(courseId, 2), isNull(deletedAt)]
    expect(conditions).toHaveLength(3);
    expect(conditions[0]).not.toBe(SQL_FALSE);
  });

  it("Layer 2 visible: enrolled course announcement included", () => {
    const scope = buildScopeContext(session({ role: "student", enrolledCourseIds: [3] }));
    const conditions = buildAnnouncementListConditions(scope, {});
    // scope filter present and not SQL_FALSE — enrolled course announcements are visible
    expect(conditions[0]).not.toBe(SQL_FALSE);
  });

  it("Layer 2 hidden: no enrolled courses → SQL_FALSE (zero rows)", () => {
    const scope = buildScopeContext(session({ role: "student", enrolledCourseIds: [] }));
    const conditions = buildAnnouncementListConditions(scope, {});
    expect(conditions[0]).toBe(SQL_FALSE);
  });
});

describe("buildAnnouncementListConditions — parent scope", () => {
  it("adds inArray(course_id, childCourseIds) when childCourseIds is populated", () => {
    const scope = buildScopeContext(
      session({ role: "parent", childStudentIds: [2, 5], childCourseIds: [1, 3, 7] }),
    );
    const conditions = buildAnnouncementListConditions(scope, {});
    expect(conditions).toHaveLength(2);
    expect(conditions[0]).not.toBe(SQL_FALSE);
  });

  it("returns SQL_FALSE when childCourseIds is empty", () => {
    const scope = buildScopeContext(
      session({ role: "parent", childStudentIds: [3], childCourseIds: [] }),
    );
    const conditions = buildAnnouncementListConditions(scope, {});
    expect(conditions).toHaveLength(2);
    expect(conditions[0]).toBe(SQL_FALSE);
  });

  it("returns SQL_FALSE when childCourseIds is undefined", () => {
    const scope = buildScopeContext(session({ role: "parent", childStudentIds: [3] }));
    const conditions = buildAnnouncementListConditions(scope, {});
    expect(conditions).toHaveLength(2);
    expect(conditions[0]).toBe(SQL_FALSE);
  });

  it("applies courseId filter alongside inArray scope", () => {
    const scope = buildScopeContext(
      session({ role: "parent", childCourseIds: [3, 5] }),
    );
    const conditions = buildAnnouncementListConditions(scope, { courseId: 3 });
    expect(conditions).toHaveLength(3);
    expect(conditions[0]).not.toBe(SQL_FALSE);
  });

  it("Layer 2 visible: child course announcement included", () => {
    const scope = buildScopeContext(session({ role: "parent", childCourseIds: [7] }));
    const conditions = buildAnnouncementListConditions(scope, {});
    expect(conditions[0]).not.toBe(SQL_FALSE);
  });

  it("Layer 2 hidden: no childCourseIds → SQL_FALSE", () => {
    const scope = buildScopeContext(session({ role: "parent", childCourseIds: [] }));
    const conditions = buildAnnouncementListConditions(scope, {});
    expect(conditions[0]).toBe(SQL_FALSE);
  });
});

describe("buildAnnouncementListConditions — guest scope", () => {
  it("produces SQL_FALSE for guest (no access)", () => {
    const scope = buildScopeContext(session({ role: "guest" }));
    const conditions = buildAnnouncementListConditions(scope, {});
    expect(conditions).toHaveLength(2);
    expect(conditions[0]).toBe(SQL_FALSE);
  });
});

describe("buildAnnouncementListConditions — soft-delete guard", () => {
  it("always includes isNull(deletedAt) for admin", () => {
    const scope = buildScopeContext(session({ role: "admin" }));
    const conditions = buildAnnouncementListConditions(scope, {});
    expect(conditions).toHaveLength(1);
    expect(conditions[0]).not.toBe(SQL_FALSE);
  });

  it("always includes isNull(deletedAt) for student", () => {
    const scope = buildScopeContext(session({ role: "student", enrolledCourseIds: [1] }));
    const conditions = buildAnnouncementListConditions(scope, {});
    expect(conditions).toHaveLength(2);
    const last = conditions[conditions.length - 1];
    expect(last).not.toBe(SQL_FALSE);
  });
});

// ── schema column reference sanity check ─────────────────────────────────────

describe("announcementsTable schema — column presence", () => {
  it("exposes the deletedAt column", () => {
    expect(announcementsTable.deletedAt).toBeDefined();
    expect(announcementsTable.deletedAt.name).toBe("deleted_at");
  });

  it("exposes the courseId column for scope filter binding", () => {
    expect(announcementsTable.courseId).toBeDefined();
    expect(announcementsTable.courseId.name).toBe("course_id");
  });

  it("exposes authorName and priority columns", () => {
    expect(announcementsTable.authorName).toBeDefined();
    expect(announcementsTable.priority).toBeDefined();
  });
});

// ── AnnouncementScopePolicy — Layer 2 getScopeCondition ──────────────────────

describe("AnnouncementScopePolicy.getScopeCondition", () => {
  it("admin → undefined (no filter)", () => {
    const scope = buildScopeContext(session({ role: "admin" }));
    expect(announcementPolicy.getScopeCondition(scope)).toBeUndefined();
  });

  it("teacher with courses → SQL condition (not SQL_FALSE)", () => {
    const scope = buildScopeContext(session({ role: "teacher", ownedCourseIds: [1, 2] }));
    const cond = announcementPolicy.getScopeCondition(scope);
    expect(cond).toBeDefined();
    expect(cond).not.toBe(SQL_FALSE);
  });
  it("teacher with no courses → SQL_FALSE", () => {
    const scope = buildScopeContext(session({ role: "teacher" }));
    expect(announcementPolicy.getScopeCondition(scope)).toBe(SQL_FALSE);
  });

  it("student with enrolledCourseIds → SQL condition (not SQL_FALSE)", () => {
    const scope = buildScopeContext(session({ role: "student", enrolledCourseIds: [1, 2] }));
    const cond = announcementPolicy.getScopeCondition(scope);
    expect(cond).toBeDefined();
    expect(cond).not.toBe(SQL_FALSE);
  });

  it("student with empty enrolledCourseIds → SQL_FALSE", () => {
    const scope = buildScopeContext(session({ role: "student", enrolledCourseIds: [] }));
    expect(announcementPolicy.getScopeCondition(scope)).toBe(SQL_FALSE);
  });

  it("parent with childCourseIds → SQL condition (not SQL_FALSE)", () => {
    const scope = buildScopeContext(session({ role: "parent", childCourseIds: [3, 4] }));
    const cond = announcementPolicy.getScopeCondition(scope);
    expect(cond).toBeDefined();
    expect(cond).not.toBe(SQL_FALSE);
  });

  it("parent with empty childCourseIds → SQL_FALSE", () => {
    const scope = buildScopeContext(session({ role: "parent", childCourseIds: [] }));
    expect(announcementPolicy.getScopeCondition(scope)).toBe(SQL_FALSE);
  });

  it("guest → SQL_FALSE", () => {
    const scope = buildScopeContext(session({ role: "guest" }));
    expect(announcementPolicy.getScopeCondition(scope)).toBe(SQL_FALSE);
  });
});

// ── AnnouncementScopePolicy — Layer 3 validateAccess ─────────────────────────

describe("AnnouncementScopePolicy.validateAccess — admin / teacher", () => {
  it("admin: does not throw for any courseId", () => {
    const scope = buildScopeContext(session({ role: "admin" }));
    expect(() => announcementPolicy.validateAccess(scope, { courseId: 99 })).not.toThrow();
  });

  it("teacher: does not throw for owned courseId", () => {
    const scope = buildScopeContext(session({ role: "teacher", ownedCourseIds: [42] }));
    expect(() => announcementPolicy.validateAccess(scope, { courseId: 42 })).not.toThrow();
  });
  it("teacher: throws for non-owned courseId", () => {
    const scope = buildScopeContext(session({ role: "teacher", ownedCourseIds: [1] }));
    expect(() => announcementPolicy.validateAccess(scope, { courseId: 99 })).toThrow();
  });
});

describe("AnnouncementScopePolicy.validateAccess — student IDOR protection", () => {
  it("passes when courseId ∈ enrolledCourseIds", () => {
    const scope = buildScopeContext(session({ role: "student", enrolledCourseIds: [3, 5, 7] }));
    expect(() => announcementPolicy.validateAccess(scope, { courseId: 5 })).not.toThrow();
  });

  it("throws PolicyAuthorizationError when courseId ∉ enrolledCourseIds", () => {
    const scope = buildScopeContext(session({ role: "student", enrolledCourseIds: [3, 5, 7] }));
    expect(() => announcementPolicy.validateAccess(scope, { courseId: 99 })).toThrow(
      PolicyAuthorizationError,
    );
  });

  it("thrown error is also a CourseAuthorizationError (subclass chain intact)", () => {
    const scope = buildScopeContext(session({ role: "student", enrolledCourseIds: [1] }));
    expect(() => announcementPolicy.validateAccess(scope, { courseId: 99 })).toThrow(
      CourseAuthorizationError,
    );
  });

  it("IDOR enumeration: student incrementing announcement IDs — non-enrolled course always denied", () => {
    // Simulates: student tries announcement/100, /101, /102 which all belong to courseId=8
    const scope = buildScopeContext(session({ role: "student", enrolledCourseIds: [1, 2, 3] }));
    const nonEnrolledCourse = 8;
    expect(() => announcementPolicy.validateAccess(scope, { courseId: nonEnrolledCourse })).toThrow(
      PolicyAuthorizationError,
    );
  });

  it("student with empty enrolledCourseIds: always denied", () => {
    const scope = buildScopeContext(session({ role: "student", enrolledCourseIds: [] }));
    expect(() => announcementPolicy.validateAccess(scope, { courseId: 1 })).toThrow(
      PolicyAuthorizationError,
    );
  });
});

describe("AnnouncementScopePolicy.validateAccess — parent IDOR protection", () => {
  it("passes when courseId ∈ childCourseIds", () => {
    const scope = buildScopeContext(session({ role: "parent", childCourseIds: [2, 8, 11] }));
    expect(() => announcementPolicy.validateAccess(scope, { courseId: 8 })).not.toThrow();
  });

  it("throws PolicyAuthorizationError when courseId ∉ childCourseIds", () => {
    const scope = buildScopeContext(session({ role: "parent", childCourseIds: [2, 8, 11] }));
    expect(() => announcementPolicy.validateAccess(scope, { courseId: 99 })).toThrow(
      PolicyAuthorizationError,
    );
  });

  it("IDOR enumeration: parent increments announcement IDs — unrelated course always denied", () => {
    const scope = buildScopeContext(session({ role: "parent", childCourseIds: [1, 3, 5] }));
    const unrelatedCourse = 15;
    expect(() => announcementPolicy.validateAccess(scope, { courseId: unrelatedCourse })).toThrow(
      PolicyAuthorizationError,
    );
  });

  it("parent with empty childCourseIds: always denied", () => {
    const scope = buildScopeContext(session({ role: "parent", childCourseIds: [] }));
    expect(() => announcementPolicy.validateAccess(scope, { courseId: 1 })).toThrow(
      PolicyAuthorizationError,
    );
  });
});

describe("AnnouncementScopePolicy.validateAccess — guest", () => {
  it("always throws PolicyAuthorizationError", () => {
    const scope = buildScopeContext(session({ role: "guest" }));
    expect(() => announcementPolicy.validateAccess(scope, { courseId: 1 })).toThrow(
      PolicyAuthorizationError,
    );
  });
});

// ── Layer 2 + Layer 3 interaction contract ────────────────────────────────────

describe("Layer 2 + Layer 3 interaction — announcements architectural contract", () => {
  it("admin: Layer 2 no filter, Layer 3 always passes", () => {
    const scope = buildScopeContext(session({ role: "admin" }));
    const conditions = buildAnnouncementListConditions(scope, {});
    expect(conditions).toHaveLength(1);
    expect(conditions[0]).not.toBe(SQL_FALSE);
    expect(() => announcementPolicy.validateAccess(scope, { courseId: 999 })).not.toThrow();
  });

  it("student: Layer 2 hides non-enrolled (SQL_FALSE), Layer 3 denies direct ID access", () => {
    const scope = buildScopeContext(session({ role: "student", enrolledCourseIds: [1, 2, 3] }));
    // Layer 3: deny non-enrolled courseId via policy
    expect(() => announcementPolicy.validateAccess(scope, { courseId: 99 })).toThrow(
      PolicyAuthorizationError,
    );
    // Layer 2: enrolled courses produce a real filter (not SQL_FALSE)
    const conditions = buildAnnouncementListConditions(scope, {});
    expect(conditions[0]).not.toBe(SQL_FALSE);
  });

  it("parent: Layer 2 hides non-child courses, Layer 3 denies direct access", () => {
    const scope = buildScopeContext(session({ role: "parent", childCourseIds: [4, 5, 6] }));
    expect(() => announcementPolicy.validateAccess(scope, { courseId: 99 })).toThrow(
      PolicyAuthorizationError,
    );
    const conditions = buildAnnouncementListConditions(scope, {});
    expect(conditions[0]).not.toBe(SQL_FALSE);
  });
});
