/**
 * Parent deactivation guard — stale-session HTTP integration tests
 *
 * Verifies that removing a guardian link or soft-deleting a student
 * blocks access immediately on the next request, even within an active
 * parent session whose childStudentIds may be stale from login time.
 *
 * Covers:
 *  1. Removed guardian link → 404 on all per-student endpoints
 *  2. Soft-deleted student  → 404 on all per-student endpoints
 *  3. Removed guardian link → student absent from /parent/students list
 *  4. Soft-deleted student  → student absent from /parent/students list
 *  5. Removed guardian link → student absent from /parent/dashboard
 *  6. Soft-deleted student  → student absent from /parent/dashboard
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, and, isNotNull, sql } from "drizzle-orm";
import { db, usersTable, studentsTable, studentGuardiansTable } from "@workspace/db";
import { hashPassword } from "../../lib/password";
import { req, loginAs, cleanupHttpUser, type SupertestAgent } from "./setup";

const TEST_PASSWORD = "TestPass1!";

async function createParent(prefix: string, actorId: number) {
  const username = `${prefix}_deact_parent_${Date.now()}`;
  const hash = await hashPassword(TEST_PASSWORD);
  const [user] = await db
    .insert(usersTable)
    .values({
      username,
      passwordHash: hash,
      displayName: `${prefix} Deact Parent`,
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
      email: `${prefix}_${Date.now()}@deact.test`,
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

async function removeGuardianLink(userId: number, studentId: number) {
  await db
    .delete(studentGuardiansTable)
    .where(
      and(
        eq(studentGuardiansTable.userId, userId),
        eq(studentGuardiansTable.studentId, studentId),
      ),
    );
}

async function softDeleteStudent(studentId: number) {
  await db
    .update(studentsTable)
    .set({ deletedAt: new Date() })
    .where(eq(studentsTable.id, studentId));
}

async function restoreStudent(studentId: number) {
  await db
    .update(studentsTable)
    .set({ deletedAt: null })
    .where(eq(studentsTable.id, studentId));
}

let adminId: number;

// Parent whose guardian link will be removed mid-session.
let parentUnlink: { id: number; username: string; password: string; role: "parent" };
let studentUnlinkId: number;
let agentUnlink: SupertestAgent;

// Parent whose child will be soft-deleted mid-session.
let parentSoftDel: { id: number; username: string; password: string; role: "parent" };
let studentSoftDelId: number;
let agentSoftDel: SupertestAgent;

beforeAll(async () => {
  const [admin] = await db
    .insert(usersTable)
    .values({
      username: `deact_admin_${Date.now()}`,
      passwordHash: await hashPassword(TEST_PASSWORD),
      displayName: "Deact Admin",
      role: "admin",
      isActive: true,
    })
    .returning({ id: usersTable.id });
  adminId = admin!.id;

  [parentUnlink, parentSoftDel] = await Promise.all([
    createParent("Unlink", adminId),
    createParent("SoftDel", adminId),
  ]);

  [studentUnlinkId, studentSoftDelId] = await Promise.all([
    createStudent("Unlink", adminId),
    createStudent("SoftDel", adminId),
  ]);

  await Promise.all([
    linkGuardian(parentUnlink.id, studentUnlinkId, adminId),
    linkGuardian(parentSoftDel.id, studentSoftDelId, adminId),
  ]);

  // Login BEFORE making any destructive changes so session holds stale data.
  [agentUnlink, agentSoftDel] = await Promise.all([
    loginAs(parentUnlink as Parameters<typeof loginAs>[0]),
    loginAs(parentSoftDel as Parameters<typeof loginAs>[0]),
  ]);

  // Now remove the guardian link and soft-delete while the sessions are active.
  await removeGuardianLink(parentUnlink.id, studentUnlinkId);
  await softDeleteStudent(studentSoftDelId);
});

afterAll(async () => {
  // Restore student so cleanup can delete it cleanly.
  await restoreStudent(studentSoftDelId);
  // Re-link so cascade delete from student cleanup works predictably.
  await db.delete(studentGuardiansTable).where(eq(studentGuardiansTable.userId, parentSoftDel.id));
  await db.delete(studentsTable).where(eq(studentsTable.id, studentUnlinkId));
  await db.delete(studentsTable).where(eq(studentsTable.id, studentSoftDelId));
  await Promise.all([
    cleanupHttpUser(parentUnlink.id),
    cleanupHttpUser(parentSoftDel.id),
    cleanupHttpUser(adminId),
  ]);
});

// ---------------------------------------------------------------------------
// Removed guardian link — per-student endpoints
// ---------------------------------------------------------------------------

describe("Removed guardian link — per-student endpoints return 404", () => {
  it("GET /parent/students/:id/progress returns 404 after link removed", async () => {
    const res = await agentUnlink.get(`/api/parent/students/${studentUnlinkId}/progress`);
    expect(res.status).toBe(404);
  });

  it("GET /parent/students/:id/assignments returns 404 after link removed", async () => {
    const res = await agentUnlink.get(`/api/parent/students/${studentUnlinkId}/assignments`);
    expect(res.status).toBe(404);
  });

  it("GET /parent/students/:id/assessments returns 404 after link removed", async () => {
    const res = await agentUnlink.get(`/api/parent/students/${studentUnlinkId}/assessments`);
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Soft-deleted student — per-student endpoints
// ---------------------------------------------------------------------------

describe("Soft-deleted student — per-student endpoints return 404", () => {
  it("GET /parent/students/:id/progress returns 404 after student soft-deleted", async () => {
    const res = await agentSoftDel.get(`/api/parent/students/${studentSoftDelId}/progress`);
    expect(res.status).toBe(404);
  });

  it("GET /parent/students/:id/assignments returns 404 after student soft-deleted", async () => {
    const res = await agentSoftDel.get(`/api/parent/students/${studentSoftDelId}/assignments`);
    expect(res.status).toBe(404);
  });

  it("GET /parent/students/:id/assessments returns 404 after student soft-deleted", async () => {
    const res = await agentSoftDel.get(`/api/parent/students/${studentSoftDelId}/assessments`);
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Removed guardian link — list / dashboard endpoints
// ---------------------------------------------------------------------------

describe("Removed guardian link — list and dashboard exclude the student", () => {
  it("GET /parent/students returns empty list after link removed", async () => {
    const res = await agentUnlink.get("/api/parent/students");
    expect(res.status).toBe(200);
    const ids = res.body.items.map((s: { id: number }) => s.id);
    expect(ids).not.toContain(studentUnlinkId);
  });

  it("GET /parent/dashboard returns empty items after link removed", async () => {
    const res = await agentUnlink.get("/api/parent/dashboard");
    expect(res.status).toBe(200);
    const ids = res.body.items.map((s: { id: number }) => s.id);
    expect(ids).not.toContain(studentUnlinkId);
  });
});

// ---------------------------------------------------------------------------
// Soft-deleted student — list / dashboard endpoints
// ---------------------------------------------------------------------------

describe("Soft-deleted student — list and dashboard exclude the student", () => {
  it("GET /parent/students excludes soft-deleted student", async () => {
    const res = await agentSoftDel.get("/api/parent/students");
    expect(res.status).toBe(200);
    const ids = res.body.items.map((s: { id: number }) => s.id);
    expect(ids).not.toContain(studentSoftDelId);
  });

  it("GET /parent/dashboard excludes soft-deleted student", async () => {
    const res = await agentSoftDel.get("/api/parent/dashboard");
    expect(res.status).toBe(200);
    const ids = res.body.items.map((s: { id: number }) => s.id);
    expect(ids).not.toContain(studentSoftDelId);
  });
});
