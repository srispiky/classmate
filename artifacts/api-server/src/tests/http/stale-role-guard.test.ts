/**
 * Stale-role guard — session role freshness HTTP integration tests
 *
 * Verifies that when a user's role is changed in the DB mid-session (e.g. admin →
 * parent), the very next request re-enriches the session so that the per-route
 * requireRole check uses the updated role rather than the stale cached one.
 *
 * Covers:
 *  1. admin → parent role change: previously admin-only endpoint returns 403
 *  2. admin → parent role change: admin-only user-list endpoint returns 403
 *  3. admin → teacher role change: admin-only user-list still returns 403,
 *     but general teacher-accessible routes remain 200
 *  4. Control case: unmodified admin session still receives 200 on admin routes
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { hashPassword } from "../../lib/password";
import { loginAs, cleanupHttpUser, type SupertestAgent } from "./setup";

const TEST_PASSWORD = "TestPass1!";

async function createUser(
  prefix: string,
  role: "admin" | "teacher" | "parent",
): Promise<{ id: number; username: string; password: string; role: typeof role }> {
  const username = `${prefix}_stale_${role}_${Date.now()}`;
  const hash = await hashPassword(TEST_PASSWORD);
  const [user] = await db
    .insert(usersTable)
    .values({
      username,
      passwordHash: hash,
      displayName: `${prefix} Stale ${role}`,
      role,
      isActive: true,
    })
    .returning({ id: usersTable.id });
  return { id: user!.id, username, password: TEST_PASSWORD, role };
}

async function changeRole(userId: number, newRole: string): Promise<void> {
  await db.update(usersTable).set({ role: newRole }).where(eq(usersTable.id, userId));
}

let adminDemotedToParent: { id: number; username: string; password: string; role: "admin" };
let adminDemotedToTeacher: { id: number; username: string; password: string; role: "admin" };
let controlAdmin: { id: number; username: string; password: string; role: "admin" };

let agentDemotedToParent: SupertestAgent;
let agentDemotedToTeacher: SupertestAgent;
let agentControlAdmin: SupertestAgent;

beforeAll(async () => {
  [adminDemotedToParent, adminDemotedToTeacher, controlAdmin] = await Promise.all([
    createUser("Demoted", "admin") as Promise<{ id: number; username: string; password: string; role: "admin" }>,
    createUser("Demoted2", "admin") as Promise<{ id: number; username: string; password: string; role: "admin" }>,
    createUser("Control", "admin") as Promise<{ id: number; username: string; password: string; role: "admin" }>,
  ]);

  [agentDemotedToParent, agentDemotedToTeacher, agentControlAdmin] = await Promise.all([
    loginAs(adminDemotedToParent),
    loginAs(adminDemotedToTeacher),
    loginAs(controlAdmin),
  ]);

  await Promise.all([
    changeRole(adminDemotedToParent.id, "parent"),
    changeRole(adminDemotedToTeacher.id, "teacher"),
  ]);
});

afterAll(async () => {
  await Promise.all([
    cleanupHttpUser(adminDemotedToParent.id),
    cleanupHttpUser(adminDemotedToTeacher.id),
    cleanupHttpUser(controlAdmin.id),
  ]);
});

// ---------------------------------------------------------------------------
// admin → parent: must lose access to all admin-only routes
// ---------------------------------------------------------------------------

describe("admin demoted to parent mid-session — stale session is corrected", () => {
  it("GET /api/users → 403 after role changed to parent", async () => {
    const res = await agentDemotedToParent.get("/api/users");
    expect(res.status).toBe(403);
  });

  it("GET /api/students → 403 after role changed to parent (admin-gated route)", async () => {
    const res = await agentDemotedToParent.get("/api/students");
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// admin → teacher: must lose admin-only routes but keep teacher-accessible ones
// ---------------------------------------------------------------------------

describe("admin demoted to teacher mid-session — admin routes blocked, teacher routes accessible", () => {
  it("GET /api/users → 403 after role changed to teacher (admin-only)", async () => {
    const res = await agentDemotedToTeacher.get("/api/users");
    expect(res.status).toBe(403);
  });

  it("GET /api/students → 200 after role changed to teacher (teacher-accessible)", async () => {
    const res = await agentDemotedToTeacher.get("/api/students");
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Control: unmodified admin session remains fully accessible
// ---------------------------------------------------------------------------

describe("control admin — unmodified session remains accessible", () => {
  it("GET /api/users → 200 for control admin", async () => {
    const res = await agentControlAdmin.get("/api/users");
    expect(res.status).toBe(200);
  });

  it("GET /api/students → 200 for control admin", async () => {
    const res = await agentControlAdmin.get("/api/students");
    expect(res.status).toBe(200);
  });
});
