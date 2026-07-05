/**
 * Student deactivation guard — stale-session HTTP integration tests
 *
 * Verifies that soft-deleting a student record mid-session blocks access
 * immediately on the next request, even within an active student session
 * whose studentId was cached at login time.
 *
 * Covers:
 *  1. Soft-deleted student → 404 on GET /student/dashboard
 *  2. Soft-deleted student → 404 on GET /student/courses
 *  3. Soft-deleted student → 404 on GET /student/assignments
 *  4. Soft-deleted student → 404 on GET /student/assessments
 *  5. Soft-deleted student → 404 on GET /student/notes
 *
 * Also verifies that an active (non-deleted) student session still works:
 *  6. Active student → 200 on GET /student/dashboard
 *  7. Active student → 200 on GET /student/courses
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, and, isNull } from "drizzle-orm";
import { db, usersTable, studentsTable } from "@workspace/db";
import { hashPassword } from "../../lib/password";
import { req, loginAs, cleanupHttpUser, type SupertestAgent } from "./setup";

const TEST_PASSWORD = "TestPass1!";

async function createStudentUser(prefix: string): Promise<{
  userId: number;
  studentId: number;
  username: string;
  password: string;
}> {
  const username = `${prefix}_student_deact_${Date.now()}`;
  const hash = await hashPassword(TEST_PASSWORD);
  const [user] = await db
    .insert(usersTable)
    .values({
      username,
      passwordHash: hash,
      displayName: `${prefix} Deact Student`,
      role: "student",
      isActive: true,
    })
    .returning({ id: usersTable.id });
  const userId = user!.id;

  const [studentRow] = await db
    .insert(studentsTable)
    .values({
      name: `${prefix} Deact Student`,
      email: `${prefix}_deact_${Date.now()}@test.com`,
      grade: "10",
      enrolledCourseIds: [],
      userId,
      createdBy: userId,
      updatedBy: userId,
    })
    .returning({ id: studentsTable.id });

  return { userId, studentId: studentRow!.id, username, password: TEST_PASSWORD };
}

async function softDeleteStudent(studentId: number): Promise<void> {
  await db
    .update(studentsTable)
    .set({ deletedAt: new Date() })
    .where(eq(studentsTable.id, studentId));
}

async function restoreStudent(studentId: number): Promise<void> {
  await db
    .update(studentsTable)
    .set({ deletedAt: null })
    .where(eq(studentsTable.id, studentId));
}

// Student whose record will be soft-deleted mid-session.
let deletedStudentUserId: number;
let deletedStudentId: number;
let agentDeleted: SupertestAgent;

// Student who remains active throughout — control case.
let activeStudentUserId: number;
let activeStudentId: number;
let agentActive: SupertestAgent;

beforeAll(async () => {
  const [deleted, active] = await Promise.all([
    createStudentUser("Del"),
    createStudentUser("Active"),
  ]);

  deletedStudentUserId = deleted.userId;
  deletedStudentId = deleted.studentId;
  activeStudentUserId = active.userId;
  activeStudentId = active.studentId;

  // Login BEFORE soft-deleting so the session carries stale studentId.
  [agentDeleted, agentActive] = await Promise.all([
    loginAs({ id: deleted.userId, username: deleted.username, password: deleted.password, role: "student" }),
    loginAs({ id: active.userId, username: active.username, password: active.password, role: "student" }),
  ]);

  // Soft-delete the first student while the session is still active.
  await softDeleteStudent(deletedStudentId);
});

afterAll(async () => {
  await restoreStudent(deletedStudentId);
  await db.delete(studentsTable).where(eq(studentsTable.id, deletedStudentId));
  await db.delete(studentsTable).where(eq(studentsTable.id, activeStudentId));
  await Promise.all([
    cleanupHttpUser(deletedStudentUserId),
    cleanupHttpUser(activeStudentUserId),
  ]);
});

// ---------------------------------------------------------------------------
// Soft-deleted student — all portal endpoints must return 404
// ---------------------------------------------------------------------------

describe("Soft-deleted student — student portal endpoints return 404", () => {
  it("GET /student/dashboard returns 404 after student soft-deleted", async () => {
    const res = await agentDeleted.get("/api/student/dashboard");
    expect(res.status).toBe(404);
  });

  it("GET /student/courses returns 404 after student soft-deleted", async () => {
    const res = await agentDeleted.get("/api/student/courses");
    expect(res.status).toBe(404);
  });

  it("GET /student/assignments returns 404 after student soft-deleted", async () => {
    const res = await agentDeleted.get("/api/student/assignments");
    expect(res.status).toBe(404);
  });

  it("GET /student/assessments returns 404 after student soft-deleted", async () => {
    const res = await agentDeleted.get("/api/student/assessments");
    expect(res.status).toBe(404);
  });

  it("GET /student/notes returns 404 after student soft-deleted", async () => {
    const res = await agentDeleted.get("/api/student/notes");
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Active student — portal endpoints remain accessible (control case)
// ---------------------------------------------------------------------------

describe("Active student — student portal endpoints remain accessible", () => {
  it("GET /student/dashboard returns 200 for active student", async () => {
    const res = await agentActive.get("/api/student/dashboard");
    expect(res.status).toBe(200);
  });

  it("GET /student/courses returns 200 for active student", async () => {
    const res = await agentActive.get("/api/student/courses");
    expect(res.status).toBe(200);
  });
});
