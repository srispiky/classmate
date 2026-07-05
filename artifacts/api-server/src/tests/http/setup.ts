/**
 * Shared HTTP integration test infrastructure.
 *
 * Provides:
 *  - `app`          — the live Express app (full middleware stack, real DB)
 *  - `req()`        — unauthenticated supertest instance
 *  - `loginAs()`    — creates a supertest agent with a valid session cookie
 *  - `createHttpUser()` / `cleanupHttpUser()` — test user lifecycle helpers
 *  - `createLinkedStudent()` / `cleanupLinkedStudent()` — student profile linked to a user
 *
 * Design constraints:
 *  - Session store is PostgreSQL-backed; sessions persist for the test run.
 *  - The login rate limiter allows 10 attempts per 15-min window per IP.
 *    Each test FILE runs in its own vitest worker (separate module cache),
 *    so the rate-limiter state is isolated per file. Keep logins ≤ 8 per file.
 *  - Do NOT import this module from multiple workers simultaneously — each
 *    file gets its own module cache automatically via vitest forks.
 */

import supertest from "supertest";
import { eq } from "drizzle-orm";
import { db, usersTable, studentsTable } from "@workspace/db";
import { hashPassword } from "../../lib/password";
import app from "../../app";

export { app };

export type SupertestAgent = ReturnType<typeof supertest.agent>;

/** Unauthenticated supertest instance */
export const req = () => supertest(app);

/** Roles used across the HTTP test suite */
export type HttpRole = "admin" | "teacher" | "student" | "parent";

export interface TestHttpUser {
  id: number;
  username: string;
  password: string;
  role: HttpRole;
}

export interface LinkedStudent {
  userId: number;
  studentId: number;
}

const TEST_PASSWORD = "TestPass1!";

/**
 * Creates a user in the DB with a real bcrypt hash.
 * Use this in `beforeAll`; call `cleanupHttpUser` in `afterAll`.
 */
export async function createHttpUser(
  prefix: string,
  role: HttpRole,
  actorId?: number,
): Promise<TestHttpUser> {
  const username = `${prefix}_${role}_${Date.now()}`;
  const hash = await hashPassword(TEST_PASSWORD);
  const [user] = await db
    .insert(usersTable)
    .values({
      username,
      passwordHash: hash,
      displayName: `HTTP Test ${role}`,
      role,
      isActive: true,
      createdBy: actorId ?? null,
      updatedBy: actorId ?? null,
    })
    .returning({ id: usersTable.id });
  return { id: user!.id, username, password: TEST_PASSWORD, role };
}

/** Removes a test user created by `createHttpUser`. */
export async function cleanupHttpUser(id: number): Promise<void> {
  await db.delete(usersTable).where(eq(usersTable.id, id));
}

/**
 * Creates a student profile linked to `userId` for student-portal tests.
 * The session enricher finds the profile via `studentsTable.userId = userId`.
 */
export async function createLinkedStudent(
  userId: number,
  prefix: string,
  actorId: number,
): Promise<LinkedStudent> {
  const [row] = await db
    .insert(studentsTable)
    .values({
      name: `${prefix} Student`,
      email: `${prefix}_linked_${Date.now()}@test.com`,
      grade: "10",
      enrolledCourseIds: [],
      userId,
      createdBy: actorId,
      updatedBy: actorId,
    })
    .returning({ id: studentsTable.id });
  return { userId, studentId: row!.id };
}

/** Removes the student profile created by `createLinkedStudent`. */
export async function cleanupLinkedStudent(studentId: number): Promise<void> {
  await db.delete(studentsTable).where(eq(studentsTable.id, studentId));
}

/**
 * Logs in as the given user and returns a supertest agent that carries the
 * session cookie on subsequent requests.  Throws if login fails.
 */
export async function loginAs(user: TestHttpUser): Promise<SupertestAgent> {
  const agent = supertest.agent(app);
  const res = await agent
    .post("/api/auth/login")
    .send({ username: user.username, password: user.password });
  if (res.status !== 200) {
    throw new Error(
      `loginAs(${user.role}) failed: HTTP ${res.status} — ${JSON.stringify(res.body)}`,
    );
  }
  return agent;
}
