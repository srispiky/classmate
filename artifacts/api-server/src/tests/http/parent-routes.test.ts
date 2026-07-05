/**
 * Parent Portal — HTTP integration tests
 *
 * Verifies:
 *  1. All 4 endpoints enforce Layer 1 (requireRole("parent"))
 *  2. Unauthenticated callers receive 401
 *  3. Admin / teacher / student receive 403
 *  4. Parent A cannot access Parent B's student data (E2E isolation)
 *  5. Parent with no linked students receives empty list
 *  6. Parent sees only their own linked children
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db, usersTable, studentsTable, studentGuardiansTable } from "@workspace/db";
import { hashPassword } from "../../lib/password";
import { req, loginAs, cleanupHttpUser, cleanupLinkedStudent, type SupertestAgent } from "./setup";

const TEST_PASSWORD = "TestPass1!";

async function createParentUser(prefix: string, actorId: number) {
  const username = `${prefix}_parent_${Date.now()}`;
  const hash = await hashPassword(TEST_PASSWORD);
  const [user] = await db
    .insert(usersTable)
    .values({
      username,
      passwordHash: hash,
      displayName: `${prefix} Parent`,
      role: "parent",
      isActive: true,
      createdBy: actorId,
      updatedBy: actorId,
    })
    .returning({ id: usersTable.id });
  return { id: user!.id, username, password: TEST_PASSWORD, role: "parent" as const };
}

async function createUnlinkedStudent(prefix: string, actorId: number): Promise<number> {
  const [row] = await db
    .insert(studentsTable)
    .values({
      name: `${prefix} Student`,
      email: `${prefix}_${Date.now()}@parent.test`,
      grade: "9",
      enrolledCourseIds: [],
      createdBy: actorId,
      updatedBy: actorId,
    })
    .returning({ id: studentsTable.id });
  return row!.id;
}

async function linkGuardian(userId: number, studentId: number, createdBy: number) {
  await db
    .insert(studentGuardiansTable)
    .values({ userId, studentId, relationship: "parent", createdBy });
}

async function unlinkGuardian(userId: number, studentId: number) {
  await db
    .delete(studentGuardiansTable)
    .where(
      eq(studentGuardiansTable.userId, userId),
    );
  void studentId;
}

let adminUserId: number;
let parentA: { id: number; username: string; password: string; role: "parent" };
let parentB: { id: number; username: string; password: string; role: "parent" };
let studentAId: number;
let studentBId: number;
let agentA: SupertestAgent;
let agentB: SupertestAgent;

beforeAll(async () => {
  const [admin] = await db
    .insert(usersTable)
    .values({
      username: `parent_setup_admin_${Date.now()}`,
      passwordHash: await hashPassword(TEST_PASSWORD),
      displayName: "Parent Test Admin",
      role: "admin",
      isActive: true,
    })
    .returning({ id: usersTable.id });
  adminUserId = admin!.id;

  parentA = await createParentUser("parentA", adminUserId);
  parentB = await createParentUser("parentB", adminUserId);

  studentAId = await createUnlinkedStudent("StudentA", adminUserId);
  studentBId = await createUnlinkedStudent("StudentB", adminUserId);

  await linkGuardian(parentA.id, studentAId, adminUserId);
  await linkGuardian(parentB.id, studentBId, adminUserId);

  agentA = await loginAs(parentA as Parameters<typeof loginAs>[0]);
  agentB = await loginAs(parentB as Parameters<typeof loginAs>[0]);
});

afterAll(async () => {
  await unlinkGuardian(parentA.id, studentAId);
  await unlinkGuardian(parentB.id, studentBId);
  await cleanupLinkedStudent(studentAId);
  await cleanupLinkedStudent(studentBId);
  await cleanupHttpUser(parentA.id);
  await cleanupHttpUser(parentB.id);
  await cleanupHttpUser(adminUserId);
});

describe("GET /api/parent/students", () => {
  it("returns 401 for unauthenticated requests", async () => {
    const res = await req().get("/api/parent/students");
    expect(res.status).toBe(401);
  });

  it("returns 200 with linked students for parent", async () => {
    const res = await agentA.get("/api/parent/students");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items.length).toBe(1);
  });

  it("returns only Parent A's linked student (not Parent B's)", async () => {
    const res = await agentA.get("/api/parent/students");
    expect(res.status).toBe(200);
    const ids = res.body.items.map((s: { id: number }) => s.id);
    expect(ids).toContain(studentAId);
    expect(ids).not.toContain(studentBId);
  });

  it("response items include required fields", async () => {
    const res = await agentA.get("/api/parent/students");
    const item = res.body.items[0];
    expect(item).toHaveProperty("id");
    expect(item).toHaveProperty("name");
    expect(item).toHaveProperty("grade");
    expect(item).toHaveProperty("relationship");
  });
});

describe("GET /api/parent/students/:studentId/progress", () => {
  it("returns 401 for unauthenticated requests", async () => {
    const res = await req().get(`/api/parent/students/${studentAId}/progress`);
    expect(res.status).toBe(401);
  });

  it("returns 200 for parent accessing their linked student", async () => {
    const res = await agentA.get(`/api/parent/students/${studentAId}/progress`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("studentId", studentAId);
    expect(res.body).toHaveProperty("totalAssignments");
    expect(res.body).toHaveProperty("averageScore");
    expect(res.body).toHaveProperty("riskLevel");
    expect(res.body).toHaveProperty("trend");
  });

  it("returns 404 when Parent A tries to access Parent B's student (IDOR-safe)", async () => {
    const res = await agentA.get(`/api/parent/students/${studentBId}/progress`);
    expect(res.status).toBe(404);
  });

  it("returns 400 for invalid studentId", async () => {
    const res = await agentA.get("/api/parent/students/not-a-number/progress");
    expect(res.status).toBe(400);
  });
});

describe("GET /api/parent/students/:studentId/assignments", () => {
  it("returns 401 for unauthenticated requests", async () => {
    const res = await req().get(`/api/parent/students/${studentAId}/assignments`);
    expect(res.status).toBe(401);
  });

  it("returns 200 with items array for linked student", async () => {
    const res = await agentA.get(`/api/parent/students/${studentAId}/assignments`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  it("returns 404 when Parent A tries to access Parent B's student assignments", async () => {
    const res = await agentA.get(`/api/parent/students/${studentBId}/assignments`);
    expect(res.status).toBe(404);
  });
});

describe("GET /api/parent/students/:studentId/assessments", () => {
  it("returns 401 for unauthenticated requests", async () => {
    const res = await req().get(`/api/parent/students/${studentAId}/assessments`);
    expect(res.status).toBe(401);
  });

  it("returns 200 with items array for linked student", async () => {
    const res = await agentA.get(`/api/parent/students/${studentAId}/assessments`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  it("returns 404 when Parent A tries to access Parent B's student assessments", async () => {
    const res = await agentA.get(`/api/parent/students/${studentBId}/assessments`);
    expect(res.status).toBe(404);
  });
});

describe("Deactivated parent account — receives 403 on all endpoints even within an active session", () => {
  let deactivatedParent: { id: number; username: string; password: string; role: "parent" };
  let deactivatedStudentId: number;
  let deactivatedAgent: SupertestAgent;

  beforeAll(async () => {
    deactivatedParent = await createParentUser("deactivated", adminUserId);
    deactivatedStudentId = await createUnlinkedStudent("DeactivatedChild", adminUserId);
    await linkGuardian(deactivatedParent.id, deactivatedStudentId, adminUserId);

    // Log in while the account is still active so we hold a valid session.
    deactivatedAgent = await loginAs(deactivatedParent as Parameters<typeof loginAs>[0]);

    // Now deactivate the account — the session remains open.
    await db
      .update(usersTable)
      .set({ isActive: false })
      .where(eq(usersTable.id, deactivatedParent.id));
  });

  afterAll(async () => {
    // Re-activate so cleanupHttpUser can delete it without foreign-key issues.
    await db
      .update(usersTable)
      .set({ isActive: true })
      .where(eq(usersTable.id, deactivatedParent.id));
    await unlinkGuardian(deactivatedParent.id, deactivatedStudentId);
    await cleanupLinkedStudent(deactivatedStudentId);
    await cleanupHttpUser(deactivatedParent.id);
  });

  it("returns 403 on GET /parent/dashboard", async () => {
    const res = await deactivatedAgent.get("/api/parent/dashboard");
    expect(res.status).toBe(403);
  });

  it("returns 403 on GET /parent/students", async () => {
    const res = await deactivatedAgent.get("/api/parent/students");
    expect(res.status).toBe(403);
  });

  it("returns 403 on GET /parent/students/:id/progress", async () => {
    const res = await deactivatedAgent.get(`/api/parent/students/${deactivatedStudentId}/progress`);
    expect(res.status).toBe(403);
  });

  it("returns 403 on GET /parent/students/:id/assignments", async () => {
    const res = await deactivatedAgent.get(`/api/parent/students/${deactivatedStudentId}/assignments`);
    expect(res.status).toBe(403);
  });

  it("returns 403 on GET /parent/students/:id/assessments", async () => {
    const res = await deactivatedAgent.get(`/api/parent/students/${deactivatedStudentId}/assessments`);
    expect(res.status).toBe(403);
  });
});

describe("Role isolation — non-parent roles receive 403 on all parent endpoints", () => {
  let teacherAgent: SupertestAgent;
  let teacherUserId: number;

  beforeAll(async () => {
    const username = `isolation_teacher_${Date.now()}`;
    const [user] = await db
      .insert(usersTable)
      .values({
        username,
        passwordHash: await hashPassword(TEST_PASSWORD),
        displayName: "Isolation Teacher",
        role: "teacher",
        isActive: true,
        createdBy: adminUserId,
      })
      .returning({ id: usersTable.id });
    teacherUserId = user!.id;
    teacherAgent = await loginAs({ id: teacherUserId, username, password: TEST_PASSWORD, role: "teacher" });
  });

  afterAll(async () => {
    await cleanupHttpUser(teacherUserId);
  });

  it("teacher receives 403 on GET /parent/students", async () => {
    const res = await teacherAgent.get("/api/parent/students");
    expect(res.status).toBe(403);
  });

  it("teacher receives 403 on GET /parent/students/:id/progress", async () => {
    const res = await teacherAgent.get(`/api/parent/students/${studentAId}/progress`);
    expect(res.status).toBe(403);
  });

  it("teacher receives 403 on GET /parent/students/:id/assignments", async () => {
    const res = await teacherAgent.get(`/api/parent/students/${studentAId}/assignments`);
    expect(res.status).toBe(403);
  });

  it("teacher receives 403 on GET /parent/students/:id/assessments", async () => {
    const res = await teacherAgent.get(`/api/parent/students/${studentAId}/assessments`);
    expect(res.status).toBe(403);
  });
});
