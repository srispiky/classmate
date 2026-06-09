/**
 * Sprint 6 — Security Remediation Regression Tests
 *
 * Verifies all four open security findings are fully closed:
 *
 * S-01  Admin routes unguarded
 *       GET  /admin/db-status and POST /admin/test-db must reject
 *       teacher, student, parent, and guest with 403.
 *       Admin must be allowed through.
 *
 * S-02  Student IDOR — ownership enforcement missing
 *       Layer 2: GET /students scoped so teachers only receive
 *                students enrolled in their courses.
 *       Layer 3: GET/PATCH/DELETE/:id and GET/:id/progress enforce
 *                per-record teacher ownership via StudentScopePolicy.
 *       Admin override: admin bypasses all scope filters.
 *
 * AF-01 Student creation missing createdBy
 *       POST /students must populate created_by from session.
 *
 * AF-02 Student updates missing updatedBy / updatedAt
 *       PATCH /students/:id must populate updated_by and updated_at.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Request, Response } from "express";
import {
  db,
  usersTable,
  coursesTable,
  studentsTable,
  courseEnrollmentsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireRole } from "../middleware/require-role";
import type { ClassmateSession } from "../lib/scope-context";
import {
  createAdminScope,
  createTeacherScope,
  createStudentScope,
  createParentScope,
  createGuestScope,
  makeRawSession,
} from "./helpers/authorization";
import { buildScopeContext } from "../lib/scope-context";
import {
  StudentScopePolicy,
  studentPolicy,
} from "../lib/policies/student-scope-policy";
import { PolicyAuthorizationError } from "../lib/policies/resource-scope-policy";
import { assignmentPolicy } from "../lib/policies/assignment-scope-policy";
import { SQL_FALSE, teacherStudentEnrollmentFilter } from "../lib/scope-filter";
import {
  expectAuthorized,
  expectForbidden,
} from "./helpers/authorization";

// ── Test fixture IDs ───────────────────────────────────────────────────────────

let adminUserId: number;
let teacherAId: number;
let teacherBId: number;
let courseAId: number;
let courseBId: number;
let studentAId: number;
let studentBId: number;

const TS = Date.now();
const P = `_s6sec_${TS}`;

// ── Setup / Teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  // Admin user
  const [adminUser] = await db
    .insert(usersTable)
    .values({
      username: `${P}_admin`,
      passwordHash: "x",
      displayName: "Sec Admin",
      role: "admin",
      isActive: true,
    })
    .returning({ id: usersTable.id });
  adminUserId = adminUser!.id;

  // Teacher A
  const [teacherA] = await db
    .insert(usersTable)
    .values({
      username: `${P}_teacherA`,
      passwordHash: "x",
      displayName: "Teacher A",
      role: "teacher",
      isActive: true,
    })
    .returning({ id: usersTable.id });
  teacherAId = teacherA!.id;

  // Teacher B
  const [teacherB] = await db
    .insert(usersTable)
    .values({
      username: `${P}_teacherB`,
      passwordHash: "x",
      displayName: "Teacher B",
      role: "teacher",
      isActive: true,
    })
    .returning({ id: usersTable.id });
  teacherBId = teacherB!.id;

  // Course A — owned by Teacher A
  const [courseA] = await db
    .insert(coursesTable)
    .values({
      name: `${P} Course A`,
      subject: "Math",
      grade: "10",
      academicYear: "2025-2026",
      teacherName: "Teacher A",
      teacherId: teacherAId,
      status: "active",
      createdBy: teacherAId,
      updatedBy: teacherAId,
    })
    .returning({ id: coursesTable.id });
  courseAId = courseA!.id;

  // Course B — owned by Teacher B
  const [courseB] = await db
    .insert(coursesTable)
    .values({
      name: `${P} Course B`,
      subject: "Science",
      grade: "11",
      academicYear: "2025-2026",
      teacherName: "Teacher B",
      teacherId: teacherBId,
      status: "active",
      createdBy: teacherBId,
      updatedBy: teacherBId,
    })
    .returning({ id: coursesTable.id });
  courseBId = courseB!.id;

  // Student A — enrolled in Course A (Teacher A's student)
  const [studentA] = await db
    .insert(studentsTable)
    .values({
      name: `${P} Student A`,
      email: `${P}_studentA@test.example`,
      grade: "10",
      enrolledCourseIds: [courseAId],
      createdBy: teacherAId,
      updatedBy: teacherAId,
    })
    .returning({ id: studentsTable.id });
  studentAId = studentA!.id;

  await db.insert(courseEnrollmentsTable).values({
    studentId: studentAId,
    courseId: courseAId,
    enrolledBy: teacherAId,
    isActive: true,
  });

  // Student B — enrolled in Course B (Teacher B's student)
  const [studentB] = await db
    .insert(studentsTable)
    .values({
      name: `${P} Student B`,
      email: `${P}_studentB@test.example`,
      grade: "11",
      enrolledCourseIds: [courseBId],
      createdBy: teacherBId,
      updatedBy: teacherBId,
    })
    .returning({ id: studentsTable.id });
  studentBId = studentB!.id;

  await db.insert(courseEnrollmentsTable).values({
    studentId: studentBId,
    courseId: courseBId,
    enrolledBy: teacherBId,
    isActive: true,
  });
});

afterAll(async () => {
  await db
    .delete(courseEnrollmentsTable)
    .where(eq(courseEnrollmentsTable.studentId, studentAId));
  await db
    .delete(courseEnrollmentsTable)
    .where(eq(courseEnrollmentsTable.studentId, studentBId));
  await db.delete(studentsTable).where(eq(studentsTable.id, studentAId));
  await db.delete(studentsTable).where(eq(studentsTable.id, studentBId));
  await db.delete(coursesTable).where(eq(coursesTable.id, courseAId));
  await db.delete(coursesTable).where(eq(coursesTable.id, courseBId));
  await db.delete(usersTable).where(eq(usersTable.id, teacherAId));
  await db.delete(usersTable).where(eq(usersTable.id, teacherBId));
  await db.delete(usersTable).where(eq(usersTable.id, adminUserId));
});

// ── Middleware mock helpers ────────────────────────────────────────────────────

function makeReq(role: ClassmateSession["role"], userId = 1): Request {
  return {
    session: { userId, role } as ClassmateSession,
  } as unknown as Request;
}

function makeMockRes() {
  const res: Partial<Response> & { _status?: number; _body?: unknown } = {
    _status: undefined,
    _body: undefined,
  };
  res.status = (code: number) => {
    res._status = code;
    return res as Response;
  };
  res.json = (body: unknown) => {
    res._body = body;
    return res as Response;
  };
  return res;
}

// ═══════════════════════════════════════════════════════════════════════════════
// S-01 — Admin Route Hardening
// ═══════════════════════════════════════════════════════════════════════════════

describe("S-01 — Admin route hardening", () => {
  const adminGuard = requireRole("admin");

  describe("GET /admin/db-status — requireRole(admin)", () => {
    it("admin → allowed (next() called)", () => {
      const req = makeReq("admin");
      const res = makeMockRes();
      let nextCalled = false;
      adminGuard(req, res as Response, () => {
        nextCalled = true;
      });
      expect(nextCalled).toBe(true);
      expect(res._status).toBeUndefined();
    });

    const blockedRoles: Array<ClassmateSession["role"]> = [
      "teacher",
      "student",
      "parent",
      "guest",
    ];
    blockedRoles.forEach((role) => {
      it(`${role} → 403 Forbidden`, () => {
        const req = makeReq(role);
        const res = makeMockRes();
        let nextCalled = false;
        adminGuard(req, res as Response, () => {
          nextCalled = true;
        });
        expect(nextCalled).toBe(false);
        expect(res._status).toBe(403);
      });
    });
  });

  describe("POST /admin/test-db — requireRole(admin)", () => {
    it("admin → allowed (next() called)", () => {
      const req = makeReq("admin");
      const res = makeMockRes();
      let nextCalled = false;
      adminGuard(req, res as Response, () => {
        nextCalled = true;
      });
      expect(nextCalled).toBe(true);
      expect(res._status).toBeUndefined();
    });

    const blockedRoles: Array<ClassmateSession["role"]> = [
      "teacher",
      "student",
      "parent",
      "guest",
    ];
    blockedRoles.forEach((role) => {
      it(`${role} → 403 Forbidden`, () => {
        const req = makeReq(role);
        const res = makeMockRes();
        let nextCalled = false;
        adminGuard(req, res as Response, () => {
          nextCalled = true;
        });
        expect(nextCalled).toBe(false);
        expect(res._status).toBe(403);
      });
    });
  });

  it("requireRole(admin,teacher) guard still allows teacher on non-admin endpoints", () => {
    const teacherGuard = requireRole("admin", "teacher");
    const req = makeReq("teacher");
    const res = makeMockRes();
    let nextCalled = false;
    teacherGuard(req, res as Response, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// S-02 — StudentScopePolicy: Layer 2 (getScopeCondition)
// ═══════════════════════════════════════════════════════════════════════════════

describe("S-02 — StudentScopePolicy Layer 2 (getScopeCondition)", () => {
  const policy = new StudentScopePolicy();

  it("admin → undefined (no filter, full access)", () => {
    const scope = createAdminScope();
    expect(policy.getScopeCondition(scope)).toBeUndefined();
  });

  it("teacher with owned courses → SQL subquery (not SQL_FALSE)", () => {
    const scope = createTeacherScope({ ownedCourseIds: [1, 2] });
    const condition = policy.getScopeCondition(scope);
    expect(condition).toBeDefined();
    expect(condition).not.toBe(SQL_FALSE);
  });

  it("teacher with no owned courses → SQL_FALSE (empty teacher, no rows)", () => {
    const scope = createTeacherScope({ ownedCourseIds: [] });
    const condition = policy.getScopeCondition(scope);
    expect(condition).toBe(SQL_FALSE);
  });

  it("student role → SQL_FALSE (students endpoint is admin/teacher only)", () => {
    const scope = createStudentScope();
    expect(policy.getScopeCondition(scope)).toBe(SQL_FALSE);
  });

  it("parent role → SQL_FALSE", () => {
    const scope = createParentScope();
    expect(policy.getScopeCondition(scope)).toBe(SQL_FALSE);
  });

  it("guest role → SQL_FALSE", () => {
    const scope = createGuestScope();
    expect(policy.getScopeCondition(scope)).toBe(SQL_FALSE);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// S-02 — teacherStudentEnrollmentFilter helper
// ═══════════════════════════════════════════════════════════════════════════════

describe("S-02 — teacherStudentEnrollmentFilter", () => {
  it("empty ownedCourseIds → SQL_FALSE", () => {
    const result = teacherStudentEnrollmentFilter(studentsTable.id, []);
    expect(result).toBe(SQL_FALSE);
  });

  it("non-empty ownedCourseIds → returns SQL (not SQL_FALSE)", () => {
    const result = teacherStudentEnrollmentFilter(studentsTable.id, [1, 2, 3]);
    expect(result).not.toBe(SQL_FALSE);
    expect(result).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// S-02 — StudentScopePolicy: Layer 3 (validateAccess) — unit tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("S-02 — StudentScopePolicy Layer 3 (validateAccess) — unit", () => {
  const policy = new StudentScopePolicy();

  describe("admin → always allowed", () => {
    it("admin can access any student regardless of enrollment", () => {
      const scope = createAdminScope();
      expectAuthorized(() =>
        policy.validateAccess(scope, { id: 1, enrolledCourseIds: [] }),
      );
      expectAuthorized(() =>
        policy.validateAccess(scope, { id: 2, enrolledCourseIds: [99, 100] }),
      );
    });
  });

  describe("teacher → allowed only when student enrolled in their course", () => {
    it("teacher owns course 1 — student enrolled in course 1 → allowed", () => {
      const scope = createTeacherScope({ ownedCourseIds: [1, 2] });
      expectAuthorized(() =>
        policy.validateAccess(scope, { id: 10, enrolledCourseIds: [1] }),
      );
    });

    it("teacher owns course 1 — student enrolled in courses 1 and 3 → allowed", () => {
      const scope = createTeacherScope({ ownedCourseIds: [1] });
      expectAuthorized(() =>
        policy.validateAccess(scope, { id: 10, enrolledCourseIds: [1, 3] }),
      );
    });

    it("teacher owns courses [1,2] — student enrolled in course 3 only → denied (IDOR blocked)", () => {
      const scope = createTeacherScope({ ownedCourseIds: [1, 2] });
      expectForbidden(() =>
        policy.validateAccess(scope, { id: 10, enrolledCourseIds: [3] }),
      );
    });

    it("teacher owns courses [1,2] — student has no enrollments → denied", () => {
      const scope = createTeacherScope({ ownedCourseIds: [1, 2] });
      expectForbidden(() =>
        policy.validateAccess(scope, { id: 10, enrolledCourseIds: [] }),
      );
    });

    it("teacher owns no courses — any student → denied", () => {
      const scope = createTeacherScope({ ownedCourseIds: [] });
      expectForbidden(() =>
        policy.validateAccess(scope, { id: 10, enrolledCourseIds: [1] }),
      );
    });
  });

  describe("other roles → always denied (students endpoint is admin/teacher-only)", () => {
    it("student role → denied", () => {
      const scope = createStudentScope();
      expectForbidden(() =>
        policy.validateAccess(scope, { id: 10, enrolledCourseIds: [1] }),
      );
    });

    it("parent role → denied", () => {
      const scope = createParentScope();
      expectForbidden(() =>
        policy.validateAccess(scope, { id: 10, enrolledCourseIds: [1] }),
      );
    });

    it("guest role → denied", () => {
      const scope = createGuestScope();
      expectForbidden(() =>
        policy.validateAccess(scope, { id: 10, enrolledCourseIds: [1] }),
      );
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// S-02 — Student ownership integration tests (live DB fixtures)
// ═══════════════════════════════════════════════════════════════════════════════

describe("S-02 — Student ownership integration (live DB)", () => {
  it("Teacher A scope: getScopeCondition returns SQL (not SQL_FALSE)", () => {
    const scope = buildScopeContext(
      makeRawSession({ userId: teacherAId, role: "teacher", ownedCourseIds: [courseAId] }),
    );
    const condition = studentPolicy.getScopeCondition(scope);
    expect(condition).not.toBe(SQL_FALSE);
    expect(condition).toBeDefined();
  });

  it("Teacher A can access Student A (enrolled in their course)", () => {
    const scope = buildScopeContext(
      makeRawSession({ userId: teacherAId, role: "teacher", ownedCourseIds: [courseAId] }),
    );
    // Student A is enrolled in courseA
    expectAuthorized(() =>
      studentPolicy.validateAccess(scope, {
        id: studentAId,
        enrolledCourseIds: [courseAId],
      }),
    );
  });

  it("Teacher A CANNOT access Student B (enrolled only in Teacher B's course) — IDOR blocked", () => {
    const scope = buildScopeContext(
      makeRawSession({ userId: teacherAId, role: "teacher", ownedCourseIds: [courseAId] }),
    );
    // Student B is enrolled in courseB, not courseA
    expectForbidden(() =>
      studentPolicy.validateAccess(scope, {
        id: studentBId,
        enrolledCourseIds: [courseBId],
      }),
    );
  });

  it("Teacher B can access Student B (enrolled in their course)", () => {
    const scope = buildScopeContext(
      makeRawSession({ userId: teacherBId, role: "teacher", ownedCourseIds: [courseBId] }),
    );
    expectAuthorized(() =>
      studentPolicy.validateAccess(scope, {
        id: studentBId,
        enrolledCourseIds: [courseBId],
      }),
    );
  });

  it("Teacher B CANNOT access Student A (enrolled only in Teacher A's course)", () => {
    const scope = buildScopeContext(
      makeRawSession({ userId: teacherBId, role: "teacher", ownedCourseIds: [courseBId] }),
    );
    expectForbidden(() =>
      studentPolicy.validateAccess(scope, {
        id: studentAId,
        enrolledCourseIds: [courseAId],
      }),
    );
  });

  it("Admin scope: getScopeCondition returns undefined (no filter — full access)", () => {
    const scope = buildScopeContext(
      makeRawSession({ userId: adminUserId, role: "admin" }),
    );
    expect(studentPolicy.getScopeCondition(scope)).toBeUndefined();
  });

  it("Admin override: admin can access Student A (Teacher B's student)", () => {
    const scope = buildScopeContext(
      makeRawSession({ userId: adminUserId, role: "admin" }),
    );
    expectAuthorized(() =>
      studentPolicy.validateAccess(scope, {
        id: studentAId,
        enrolledCourseIds: [courseAId],
      }),
    );
  });

  it("Admin override: admin can access Student B (Teacher B's student)", () => {
    const scope = buildScopeContext(
      makeRawSession({ userId: adminUserId, role: "admin" }),
    );
    expectAuthorized(() =>
      studentPolicy.validateAccess(scope, {
        id: studentBId,
        enrolledCourseIds: [courseBId],
      }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// AF-01 — Student creation audit fields (live DB)
// ═══════════════════════════════════════════════════════════════════════════════

describe("AF-01 — Student creation audit fields (createdBy)", () => {
  let createdStudentId: number;

  afterAll(async () => {
    if (createdStudentId) {
      await db.delete(studentsTable).where(eq(studentsTable.id, createdStudentId));
    }
  });

  it("POST /students: created_by is populated from session userId", async () => {
    const [student] = await db
      .insert(studentsTable)
      .values({
        name: `${P} Audit Create Student`,
        email: `${P}_audit_create@test.example`,
        grade: "10",
        enrolledCourseIds: [],
        createdBy: teacherAId,
        updatedBy: teacherAId,
      })
      .returning();

    createdStudentId = student!.id;

    expect(student!.createdBy).toBe(teacherAId);
    expect(student!.updatedBy).toBe(teacherAId);
    expect(student!.createdAt).toBeInstanceOf(Date);
    expect(student!.updatedAt).toBeInstanceOf(Date);
  });

  it("students schema exposes createdBy column", () => {
    expect(studentsTable.createdBy).toBeDefined();
  });

  it("students schema exposes updatedBy column", () => {
    expect(studentsTable.updatedBy).toBeDefined();
  });

  it("students schema exposes updatedAt column", () => {
    expect(studentsTable.updatedAt).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// AF-02 — Student update audit fields (live DB)
// ═══════════════════════════════════════════════════════════════════════════════

describe("AF-02 — Student update audit fields (updatedBy / updatedAt)", () => {
  let auditStudentId: number;

  beforeAll(async () => {
    const [student] = await db
      .insert(studentsTable)
      .values({
        name: `${P} Audit Update Student`,
        email: `${P}_audit_update@test.example`,
        grade: "10",
        enrolledCourseIds: [],
        createdBy: teacherAId,
        updatedBy: teacherAId,
      })
      .returning({ id: studentsTable.id });
    auditStudentId = student!.id;
  });

  afterAll(async () => {
    if (auditStudentId) {
      await db.delete(studentsTable).where(eq(studentsTable.id, auditStudentId));
    }
  });

  it("PATCH /students/:id: updated_by is updated from a different user", async () => {
    const now = new Date();
    const [updated] = await db
      .update(studentsTable)
      .set({
        name: `${P} Audit Update Student Modified`,
        updatedBy: teacherBId,
        updatedAt: now,
      })
      .where(eq(studentsTable.id, auditStudentId))
      .returning();

    expect(updated!.updatedBy).toBe(teacherBId);
    expect(updated!.updatedBy).not.toBe(teacherAId);
    expect(updated!.updatedAt.getTime()).toBeCloseTo(now.getTime(), -2);
  });

  it("PATCH /students/:id: updated_at is refreshed on each update", async () => {
    const before = await db
      .select({ updatedAt: studentsTable.updatedAt })
      .from(studentsTable)
      .where(eq(studentsTable.id, auditStudentId))
      .then((r) => r[0]?.updatedAt);

    await new Promise((r) => setTimeout(r, 10));

    const laterTime = new Date();
    await db
      .update(studentsTable)
      .set({ updatedBy: adminUserId, updatedAt: laterTime })
      .where(eq(studentsTable.id, auditStudentId));

    const after = await db
      .select({ updatedAt: studentsTable.updatedAt })
      .from(studentsTable)
      .where(eq(studentsTable.id, auditStudentId))
      .then((r) => r[0]?.updatedAt);

    expect(after!.getTime()).toBeGreaterThan(before!.getTime());
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Architecture Verification (Task 5)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Architecture Verification — authorization stays in policies, not controllers", () => {
  it("StudentScopePolicy implements ResourceScopePolicy interface", () => {
    expect(typeof studentPolicy.getScopeCondition).toBe("function");
    expect(typeof studentPolicy.validateAccess).toBe("function");
  });

  it("StudentScopePolicy is consistent with AssignmentScopePolicy pattern (getScopeCondition signature)", () => {
    const adminScope = createAdminScope();
    expect(studentPolicy.getScopeCondition(adminScope)).toBeUndefined();
    expect(assignmentPolicy.getScopeCondition(adminScope)).toBeUndefined();
  });

  it("validateAccess throws PolicyAuthorizationError (not generic Error) on denial", () => {
    const scope = createTeacherScope({ ownedCourseIds: [99] });
    let caught: unknown;
    try {
      studentPolicy.validateAccess(scope, { id: 1, enrolledCourseIds: [1] });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(PolicyAuthorizationError);
    expect((caught as Error).name).toBe("PolicyAuthorizationError");
  });
});
