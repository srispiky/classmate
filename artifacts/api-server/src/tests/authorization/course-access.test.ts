/**
 * Course RBAC Test Suite
 *
 * Covers the full three-layer authorization stack for Course resources.
 *
 * Layer 2 — buildCourseListConditions(): query-level scope filtering.
 *   Unauthorized courses never reach application memory — they are excluded at
 *   the DB level via WHERE conditions built from CourseScopePolicy.
 *
 * Layer 3 — coursePolicy.validateAccess(): post-fetch ownership guard.
 *   Prevents IDOR even if the Layer 2 filter is bypassed (defense-in-depth).
 *   A fetched course whose id is outside the requester's scope yields 403, not 404.
 *
 * IDOR — Teacher B probing Teacher A's courses, student probing non-enrolled
 *   courses, parent probing non-child courses.
 */
import { describe, it, expect } from "vitest";
import { buildScopeContext } from "../../lib/scope-context";
import { SQL_FALSE } from "../../lib/scope-filter";
import { coursePolicy } from "../../shared/auth/policies/course-scope-policy";
import { buildCourseListConditions } from "../../lib/courses.queries";
import {
  makeRawSession,
  createAdminScope,
  createStudentScope,
  createParentScope,
  createGuestScope,
  createTeacherScope,
  expectLayer2Allows,
  expectLayer2Blocks,
  expectSoftDeleteGuard,
  expectAuthorized,
  expectForbidden,
} from "../helpers/authorization";

// ── Helpers ───────────────────────────────────────────────────────────────────

function course(id: number) {
  return { id };
}

// Teacher scope with explicit owned course IDs.
function teacherWith(ownedCourseIds: number[]) {
  return buildScopeContext(makeRawSession({ role: "teacher", teacherId: 10, ownedCourseIds }));
}

// ── Layer 2 — buildCourseListConditions ───────────────────────────────────────

describe("Layer 2 — Courses: buildCourseListConditions scope conditions", () => {
  it("admin: 1 condition (soft-delete only), no scope filter added", () => {
    const c = buildCourseListConditions(createAdminScope(), {});
    expect(c).toHaveLength(1);
    expectLayer2Allows(c);
    expectSoftDeleteGuard(c);
  });

  it("teacher with owned courses: 2 conditions (inArray scope + soft-delete), allows", () => {
    const c = buildCourseListConditions(teacherWith([1, 2, 3]), {});
    expect(c).toHaveLength(2);
    expectLayer2Allows(c);
    expectSoftDeleteGuard(c);
  });

  it("teacher with empty ownedCourseIds: 2 conditions (SQL_FALSE + soft-delete), blocks", () => {
    const c = buildCourseListConditions(teacherWith([]), {});
    expect(c).toHaveLength(2);
    expectLayer2Blocks(c);
    expectSoftDeleteGuard(c);
  });

  it("teacher with undefined ownedCourseIds (normalised to []): blocks", () => {
    const c = buildCourseListConditions(createTeacherScope(), {});
    expect(c).toHaveLength(2);
    expectLayer2Blocks(c);
  });

  it("student with enrolledCourseIds: 2 conditions (inArray scope + soft-delete), allows", () => {
    const c = buildCourseListConditions(createStudentScope({ enrolledCourseIds: [1, 2, 3] }), {});
    expect(c).toHaveLength(2);
    expectLayer2Allows(c);
    expectSoftDeleteGuard(c);
  });

  it("student with empty enrolledCourseIds: 2 conditions (SQL_FALSE + soft-delete), blocks", () => {
    const c = buildCourseListConditions(createStudentScope({ enrolledCourseIds: [] }), {});
    expect(c).toHaveLength(2);
    expectLayer2Blocks(c);
    expectSoftDeleteGuard(c);
  });

  it("parent with childCourseIds: 2 conditions (inArray scope + soft-delete), allows", () => {
    const c = buildCourseListConditions(createParentScope({ childCourseIds: [1, 2] }), {});
    expect(c).toHaveLength(2);
    expectLayer2Allows(c);
    expectSoftDeleteGuard(c);
  });

  it("parent with empty childCourseIds: 2 conditions (SQL_FALSE + soft-delete), blocks", () => {
    const c = buildCourseListConditions(createParentScope({ childCourseIds: [] }), {});
    expect(c).toHaveLength(2);
    expectLayer2Blocks(c);
    expectSoftDeleteGuard(c);
  });

  it("guest: 2 conditions (SQL_FALSE + soft-delete), blocks", () => {
    const c = buildCourseListConditions(createGuestScope(), {});
    expect(c).toHaveLength(2);
    expectLayer2Blocks(c);
    expectSoftDeleteGuard(c);
  });
});

describe("Layer 2 — Courses: filter interactions", () => {
  it("admin + status filter: 2 conditions (status eq + soft-delete), allows", () => {
    const c = buildCourseListConditions(createAdminScope(), { status: "active" });
    expect(c).toHaveLength(2);
    expectLayer2Allows(c);
    expectSoftDeleteGuard(c);
  });

  it("teacher with courses + status filter: 3 conditions, allows", () => {
    const c = buildCourseListConditions(teacherWith([1, 2]), { status: "active" });
    expect(c).toHaveLength(3);
    expectLayer2Allows(c);
    expectSoftDeleteGuard(c);
  });
});

// ── Layer 3 — coursePolicy.validateAccess ─────────────────────────────────────

describe("Layer 3 — Courses: coursePolicy.validateAccess — admin", () => {
  it("passes for any course id", () => {
    const scope = createAdminScope();
    expectAuthorized(() => coursePolicy.validateAccess(scope, course(1)));
    expectAuthorized(() => coursePolicy.validateAccess(scope, course(999)));
  });
});

describe("Layer 3 — Courses: coursePolicy.validateAccess — teacher", () => {
  it("passes when courseId is in ownedCourseIds", () => {
    const scope = teacherWith([3, 7, 12]);
    expectAuthorized(() => coursePolicy.validateAccess(scope, course(3)));
    expectAuthorized(() => coursePolicy.validateAccess(scope, course(7)));
    expectAuthorized(() => coursePolicy.validateAccess(scope, course(12)));
  });

  it("throws when courseId is NOT in ownedCourseIds", () => {
    const scope = teacherWith([3, 7]);
    expectForbidden(() => coursePolicy.validateAccess(scope, course(99)));
    expectForbidden(() => coursePolicy.validateAccess(scope, course(1)));
  });

  it("throws when ownedCourseIds is empty", () => {
    const scope = teacherWith([]);
    expectForbidden(() => coursePolicy.validateAccess(scope, course(1)));
  });
});

describe("Layer 3 — Courses: coursePolicy.validateAccess — student", () => {
  it("passes when courseId is in enrolledCourseIds", () => {
    const scope = createStudentScope({ enrolledCourseIds: [2, 5, 8] });
    expectAuthorized(() => coursePolicy.validateAccess(scope, course(2)));
    expectAuthorized(() => coursePolicy.validateAccess(scope, course(5)));
  });

  it("throws when courseId is NOT in enrolledCourseIds", () => {
    const scope = createStudentScope({ enrolledCourseIds: [2, 5] });
    expectForbidden(() => coursePolicy.validateAccess(scope, course(9)));
  });

  it("throws when enrolledCourseIds is empty", () => {
    const scope = createStudentScope({ enrolledCourseIds: [] });
    expectForbidden(() => coursePolicy.validateAccess(scope, course(1)));
  });
});

describe("Layer 3 — Courses: coursePolicy.validateAccess — parent", () => {
  it("passes when courseId is in childCourseIds", () => {
    const scope = createParentScope({ childCourseIds: [3, 8, 11] });
    expectAuthorized(() => coursePolicy.validateAccess(scope, course(3)));
    expectAuthorized(() => coursePolicy.validateAccess(scope, course(8)));
  });

  it("throws when courseId is NOT in childCourseIds", () => {
    const scope = createParentScope({ childCourseIds: [3, 8] });
    expectForbidden(() => coursePolicy.validateAccess(scope, course(99)));
  });

  it("throws when childCourseIds is empty", () => {
    const scope = createParentScope({ childCourseIds: [] });
    expectForbidden(() => coursePolicy.validateAccess(scope, course(1)));
  });
});

describe("Layer 3 — Courses: coursePolicy.validateAccess — guest", () => {
  it("always throws", () => {
    const scope = createGuestScope();
    expectForbidden(() => coursePolicy.validateAccess(scope, course(1)));
    expectForbidden(() => coursePolicy.validateAccess(scope, course(99)));
  });
});

// ── IDOR — Courses ────────────────────────────────────────────────────────────

describe("IDOR — Courses (teacher-scoped)", () => {
  const teacherA = teacherWith([1, 2, 3]);   // owns courses 1, 2, 3
  const teacherB = teacherWith([10, 11, 12]); // owns courses 10, 11, 12

  const TEACHER_A_COURSES = [1, 2, 3];
  const TEACHER_B_COURSES = [10, 11, 12];

  describe("Teacher B probing Teacher A's courses — Layer 3 DENY", () => {
    TEACHER_A_COURSES.forEach((courseId) => {
      it(`teacherB → course(id=${courseId}) [owned by A] → DENY`, () => {
        expectForbidden(() => coursePolicy.validateAccess(teacherB, course(courseId)));
      });
    });
  });

  describe("Teacher A probing Teacher B's courses — Layer 3 DENY", () => {
    TEACHER_B_COURSES.forEach((courseId) => {
      it(`teacherA → course(id=${courseId}) [owned by B] → DENY`, () => {
        expectForbidden(() => coursePolicy.validateAccess(teacherA, course(courseId)));
      });
    });
  });

  describe("Teacher with no courses cannot probe any course — Layer 2 BLOCK", () => {
    it("teacher with no courses → list query BLOCK (SQL_FALSE)", () => {
      const emptyTeacher = teacherWith([]);
      const conditions = buildCourseListConditions(emptyTeacher, {});
      expect(conditions[0]).toBe(SQL_FALSE);
    });
  });
});

describe("IDOR — Courses (student-scoped)", () => {
  const student = createStudentScope({ studentId: 42, enrolledCourseIds: [1, 2, 3] });
  const FOREIGN_COURSE_IDS = [4, 5, 50, 100, 101, 999];

  describe("student probing non-enrolled courses — Layer 3 DENY", () => {
    FOREIGN_COURSE_IDS.forEach((courseId) => {
      it(`student(enrolled=[1,2,3]) → course(id=${courseId}) → DENY`, () => {
        expectForbidden(() => coursePolicy.validateAccess(student, course(courseId)));
      });
    });
  });

  it("student with no enrollments → list query BLOCK (SQL_FALSE)", () => {
    const emptyStudent = createStudentScope({ enrolledCourseIds: [] });
    const conditions = buildCourseListConditions(emptyStudent, {});
    expect(conditions[0]).toBe(SQL_FALSE);
  });
});

describe("IDOR — Courses (parent-scoped)", () => {
  const parent = createParentScope({ childStudentIds: [10], childCourseIds: [1, 2, 3] });
  const FOREIGN_COURSE_IDS = [4, 5, 50, 100, 999];

  describe("parent probing non-child courses — Layer 3 DENY", () => {
    FOREIGN_COURSE_IDS.forEach((courseId) => {
      it(`parent(childCourses=[1,2,3]) → course(id=${courseId}) → DENY`, () => {
        expectForbidden(() => coursePolicy.validateAccess(parent, course(courseId)));
      });
    });
  });

  it("parent with no child courses → list query BLOCK (SQL_FALSE)", () => {
    const emptyParent = createParentScope({ childCourseIds: [] });
    const conditions = buildCourseListConditions(emptyParent, {});
    expect(conditions[0]).toBe(SQL_FALSE);
  });
});

describe("IDOR — Courses (guest)", () => {
  it("guest → any course (Layer 3) → DENY", () => {
    const scope = createGuestScope();
    [1, 10, 100, 999].forEach((courseId) => {
      expectForbidden(() => coursePolicy.validateAccess(scope, course(courseId)));
    });
  });

  it("guest → course list (Layer 2) → BLOCK (SQL_FALSE)", () => {
    const scope = createGuestScope();
    const conditions = buildCourseListConditions(scope, {});
    expect(conditions[0]).toBe(SQL_FALSE);
  });
});
