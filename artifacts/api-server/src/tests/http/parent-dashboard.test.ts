/**
 * Parent Dashboard — HTTP integration tests
 *
 * Verifies:
 *  1. GET /parent/dashboard enforces Layer 1 (requireRole("parent"))
 *  2. Unauthenticated callers receive 401
 *  3. Non-parent roles receive 403
 *  4. Parent with no children receives empty items array
 *  5. Parent A sees Student A + Student B, not Parent B's Student C (E2E isolation)
 *  6. Each dashboard card contains the required analytics fields
 *  7. pendingAssignments counts only pending/overdue (not graded/submitted)
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, and } from "drizzle-orm";
import {
  db,
  usersTable,
  studentsTable,
  studentGuardiansTable,
  assignmentsTable,
} from "@workspace/db";
import { hashPassword } from "../../lib/password";
import { req, loginAs, cleanupHttpUser, cleanupLinkedStudent, type SupertestAgent } from "./setup";

const TEST_PASSWORD = "TestPass1!";

async function createParentUser(prefix: string, actorId: number) {
  const username = `${prefix}_dash_parent_${Date.now()}`;
  const hash = await hashPassword(TEST_PASSWORD);
  const [user] = await db
    .insert(usersTable)
    .values({
      username,
      passwordHash: hash,
      displayName: `${prefix} Dash Parent`,
      role: "parent",
      isActive: true,
      createdBy: actorId,
      updatedBy: actorId,
    })
    .returning({ id: usersTable.id });
  return { id: user!.id, username, password: TEST_PASSWORD, role: "parent" as const };
}

async function createStudent(prefix: string, actorId: number): Promise<number> {
  const [row] = await db
    .insert(studentsTable)
    .values({
      name: `${prefix} Student`,
      email: `${prefix}_${Date.now()}@dash.test`,
      grade: "10",
      enrolledCourseIds: [],
      createdBy: actorId,
      updatedBy: actorId,
    })
    .returning({ id: studentsTable.id });
  return row!.id;
}

async function linkGuardian(userId: number, studentId: number, actorId: number) {
  await db
    .insert(studentGuardiansTable)
    .values({ userId, studentId, relationship: "parent", createdBy: actorId });
}

async function createAssignment(
  studentId: number,
  status: string,
  score: number | null,
  maxScore: number,
  actorId: number,
  courseId = 1,
) {
  await db.insert(assignmentsTable).values({
    studentId,
    courseId,
    title: `Assignment ${Date.now()}`,
    description: "Test assignment",
    dueDate: "2026-12-31",
    status,
    score,
    maxScore,
    createdBy: actorId,
    updatedBy: actorId,
  });
}

let adminUserId: number;
let parentA: { id: number; username: string; password: string; role: "parent" };
let parentB: { id: number; username: string; password: string; role: "parent" };
let parentNoChildren: { id: number; username: string; password: string; role: "parent" };
let studentAId: number;
let studentBId: number;
let studentCId: number;
let agentA: SupertestAgent;
let agentB: SupertestAgent;
let agentNoChildren: SupertestAgent;

beforeAll(async () => {
  const [admin] = await db
    .insert(usersTable)
    .values({
      username: `dash_setup_admin_${Date.now()}`,
      passwordHash: await hashPassword(TEST_PASSWORD),
      displayName: "Dash Test Admin",
      role: "admin",
      isActive: true,
    })
    .returning({ id: usersTable.id });
  adminUserId = admin!.id;

  [parentA, parentB, parentNoChildren] = await Promise.all([
    createParentUser("DashA", adminUserId),
    createParentUser("DashB", adminUserId),
    createParentUser("DashNone", adminUserId),
  ]);

  [studentAId, studentBId, studentCId] = await Promise.all([
    createStudent("DashStudA", adminUserId),
    createStudent("DashStudB", adminUserId),
    createStudent("DashStudC", adminUserId),
  ]);

  // Parent A → students A + B; Parent B → student C; parentNoChildren → nothing
  await Promise.all([
    linkGuardian(parentA.id, studentAId, adminUserId),
    linkGuardian(parentA.id, studentBId, adminUserId),
    linkGuardian(parentB.id, studentCId, adminUserId),
  ]);

  // Add some assignments to student A for analytics coverage
  await Promise.all([
    createAssignment(studentAId, "graded", 85, 100, adminUserId),
    createAssignment(studentAId, "graded", 72, 100, adminUserId),
    createAssignment(studentAId, "pending", null, 100, adminUserId),
    createAssignment(studentAId, "overdue", null, 100, adminUserId),
    createAssignment(studentAId, "submitted", null, 100, adminUserId),
  ]);

  [agentA, agentB, agentNoChildren] = await Promise.all([
    loginAs(parentA as Parameters<typeof loginAs>[0]),
    loginAs(parentB as Parameters<typeof loginAs>[0]),
    loginAs(parentNoChildren as Parameters<typeof loginAs>[0]),
  ]);
});

afterAll(async () => {
  await Promise.all([
    db.delete(studentGuardiansTable).where(eq(studentGuardiansTable.userId, parentA.id)),
    db.delete(studentGuardiansTable).where(eq(studentGuardiansTable.userId, parentB.id)),
  ]);
  await Promise.all([
    db
      .delete(assignmentsTable)
      .where(and(eq(assignmentsTable.studentId, studentAId))),
  ]);
  await Promise.all([
    cleanupLinkedStudent(studentAId),
    cleanupLinkedStudent(studentBId),
    cleanupLinkedStudent(studentCId),
    cleanupHttpUser(parentA.id),
    cleanupHttpUser(parentB.id),
    cleanupHttpUser(parentNoChildren.id),
    cleanupHttpUser(adminUserId),
  ]);
});

describe("GET /api/parent/dashboard — authorization", () => {
  it("returns 401 for unauthenticated requests", async () => {
    const res = await req().get("/api/parent/dashboard");
    expect(res.status).toBe(401);
  });

  it("returns 403 for teacher role", async () => {
    const username = `dash_teacher_${Date.now()}`;
    const [user] = await db
      .insert(usersTable)
      .values({
        username,
        passwordHash: await hashPassword(TEST_PASSWORD),
        displayName: "Dash Teacher",
        role: "teacher",
        isActive: true,
        createdBy: adminUserId,
      })
      .returning({ id: usersTable.id });
    const agent = await loginAs({ id: user!.id, username, password: TEST_PASSWORD, role: "teacher" });
    const res = await agent.get("/api/parent/dashboard");
    expect(res.status).toBe(403);
    await cleanupHttpUser(user!.id);
  });

  it("returns 403 for student role", async () => {
    const username = `dash_student_${Date.now()}`;
    const [user] = await db
      .insert(usersTable)
      .values({
        username,
        passwordHash: await hashPassword(TEST_PASSWORD),
        displayName: "Dash Student",
        role: "student",
        isActive: true,
        createdBy: adminUserId,
      })
      .returning({ id: usersTable.id });
    const agent = await loginAs({ id: user!.id, username, password: TEST_PASSWORD, role: "student" });
    const res = await agent.get("/api/parent/dashboard");
    expect(res.status).toBe(403);
    await cleanupHttpUser(user!.id);
  });
});

describe("GET /api/parent/dashboard — parent with no children", () => {
  it("returns 200 with empty items", async () => {
    const res = await agentNoChildren.get("/api/parent/dashboard");
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });
});

describe("GET /api/parent/dashboard — Parent A (2 students)", () => {
  it("returns 200 with exactly 2 items", async () => {
    const res = await agentA.get("/api/parent/dashboard");
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
  });

  it("items include both Student A and Student B ids", async () => {
    const res = await agentA.get("/api/parent/dashboard");
    const ids = res.body.items.map((s: { id: number }) => s.id);
    expect(ids).toContain(studentAId);
    expect(ids).toContain(studentBId);
  });

  it("items do NOT include Student C (Parent B's student)", async () => {
    const res = await agentA.get("/api/parent/dashboard");
    const ids = res.body.items.map((s: { id: number }) => s.id);
    expect(ids).not.toContain(studentCId);
  });

  it("each item has all required analytics fields", async () => {
    const res = await agentA.get("/api/parent/dashboard");
    for (const item of res.body.items) {
      expect(item).toHaveProperty("id");
      expect(item).toHaveProperty("name");
      expect(item).toHaveProperty("grade");
      expect(item).toHaveProperty("relationship");
      expect(item).toHaveProperty("averageScore");
      expect(item).toHaveProperty("completionRate");
      expect(item).toHaveProperty("riskLevel");
      expect(item).toHaveProperty("trend");
      expect(item).toHaveProperty("pendingAssignments");
    }
  });

  it("pendingAssignments counts only pending/overdue (not graded/submitted)", async () => {
    const res = await agentA.get("/api/parent/dashboard");
    const studentA = res.body.items.find((s: { id: number }) => s.id === studentAId);
    expect(studentA).toBeDefined();
    // Student A has: 2 graded, 1 pending, 1 overdue, 1 submitted → pendingAssignments = 2
    expect(studentA.pendingAssignments).toBe(2);
  });

  it("averageScore reflects graded assignments only", async () => {
    const res = await agentA.get("/api/parent/dashboard");
    const studentA = res.body.items.find((s: { id: number }) => s.id === studentAId);
    // 2 graded: 85% and 72% → avg = 78.5
    expect(studentA.averageScore).toBeCloseTo(78.5, 0);
  });

  it("completionRate reflects graded + submitted", async () => {
    const res = await agentA.get("/api/parent/dashboard");
    const studentA = res.body.items.find((s: { id: number }) => s.id === studentAId);
    // 5 total, 3 completed (2 graded + 1 submitted) → 0.60
    expect(studentA.completionRate).toBeCloseTo(0.6, 1);
  });
});

describe("GET /api/parent/dashboard — Parent B (1 student)", () => {
  it("returns 200 with exactly 1 item (Student C)", async () => {
    const res = await agentB.get("/api/parent/dashboard");
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].id).toBe(studentCId);
  });

  it("Parent B does NOT see Student A or Student B", async () => {
    const res = await agentB.get("/api/parent/dashboard");
    const ids = res.body.items.map((s: { id: number }) => s.id);
    expect(ids).not.toContain(studentAId);
    expect(ids).not.toContain(studentBId);
  });
});
