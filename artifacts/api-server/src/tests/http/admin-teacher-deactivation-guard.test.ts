/**
 * Admin / teacher deactivation guard — stale-session HTTP integration tests
 *
 * Verifies that setting isActive = false on an admin or teacher account blocks
 * access immediately on the next request, even within an active session whose
 * cookie is still valid.
 *
 * Covers:
 *  1. Deactivated admin  → 401 on admin-only route  (GET /api/users)
 *  2. Deactivated admin  → 401 on shared route       (GET /api/students)
 *  3. Deactivated teacher → 401 on shared route      (GET /api/students)
 *  4. Deactivated teacher → 401 on shared route      (GET /api/assignments)
 *  5. Active admin  → still receives 200 (control case)
 *  6. Active teacher → still receives 200 (control case)
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { hashPassword } from "../../lib/password";
import { loginAs, cleanupHttpUser, type SupertestAgent } from "./setup";

const TEST_PASSWORD = "TestPass1!";

async function createUser(
  prefix: string,
  role: "admin" | "teacher",
): Promise<{ id: number; username: string; password: string; role: "admin" | "teacher" }> {
  const username = `${prefix}_deact_${role}_${Date.now()}`;
  const hash = await hashPassword(TEST_PASSWORD);
  const [user] = await db
    .insert(usersTable)
    .values({
      username,
      passwordHash: hash,
      displayName: `${prefix} Deact ${role}`,
      role,
      isActive: true,
    })
    .returning({ id: usersTable.id });
  return { id: user!.id, username, password: TEST_PASSWORD, role };
}

async function deactivateUser(userId: number): Promise<void> {
  await db.update(usersTable).set({ isActive: false }).where(eq(usersTable.id, userId));
}

async function reactivateUser(userId: number): Promise<void> {
  await db.update(usersTable).set({ isActive: true }).where(eq(usersTable.id, userId));
}

// Deactivated mid-session.
let deactAdmin: { id: number; username: string; password: string; role: "admin" };
let deactTeacher: { id: number; username: string; password: string; role: "teacher" };
let agentDeactAdmin: SupertestAgent;
let agentDeactTeacher: SupertestAgent;

// Active throughout — control cases.
let activeAdmin: { id: number; username: string; password: string; role: "admin" };
let activeTeacher: { id: number; username: string; password: string; role: "teacher" };
let agentActiveAdmin: SupertestAgent;
let agentActiveTeacher: SupertestAgent;

beforeAll(async () => {
  [deactAdmin, deactTeacher, activeAdmin, activeTeacher] = (await Promise.all([
    createUser("Deact", "admin"),
    createUser("Deact", "teacher"),
    createUser("Active", "admin"),
    createUser("Active", "teacher"),
  ])) as [typeof deactAdmin, typeof deactTeacher, typeof activeAdmin, typeof activeTeacher];

  // Login BEFORE deactivating so the sessions carry valid cookies.
  [agentDeactAdmin, agentDeactTeacher, agentActiveAdmin, agentActiveTeacher] = await Promise.all([
    loginAs(deactAdmin as Parameters<typeof loginAs>[0]),
    loginAs(deactTeacher as Parameters<typeof loginAs>[0]),
    loginAs(activeAdmin as Parameters<typeof loginAs>[0]),
    loginAs(activeTeacher as Parameters<typeof loginAs>[0]),
  ]);

  // Deactivate the two test accounts while their sessions remain open.
  await Promise.all([
    deactivateUser(deactAdmin.id),
    deactivateUser(deactTeacher.id),
  ]);
});

afterAll(async () => {
  // Reactivate so cleanupHttpUser (DELETE by id) doesn't hit RLS issues.
  await Promise.all([
    reactivateUser(deactAdmin.id),
    reactivateUser(deactTeacher.id),
  ]);
  await Promise.all([
    cleanupHttpUser(deactAdmin.id),
    cleanupHttpUser(deactTeacher.id),
    cleanupHttpUser(activeAdmin.id),
    cleanupHttpUser(activeTeacher.id),
  ]);
});

// ---------------------------------------------------------------------------
// Deactivated admin — must be blocked on every subsequent request
// ---------------------------------------------------------------------------

describe("Deactivated admin — stale session is killed with 401", () => {
  it("GET /api/users → 401 for deactivated admin", async () => {
    const res = await agentDeactAdmin.get("/api/users");
    expect(res.status).toBe(401);
  });

  it("GET /api/students → 401 for deactivated admin", async () => {
    const res = await agentDeactAdmin.get("/api/students");
    expect(res.status).toBe(401);
  });

  it("GET /api/assignments → 401 for deactivated admin", async () => {
    const res = await agentDeactAdmin.get("/api/assignments");
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Deactivated teacher — must be blocked on every subsequent request
// ---------------------------------------------------------------------------

describe("Deactivated teacher — stale session is killed with 401", () => {
  it("GET /api/students → 401 for deactivated teacher", async () => {
    const res = await agentDeactTeacher.get("/api/students");
    expect(res.status).toBe(401);
  });

  it("GET /api/assignments → 401 for deactivated teacher", async () => {
    const res = await agentDeactTeacher.get("/api/assignments");
    expect(res.status).toBe(401);
  });

  it("GET /api/courses → 401 for deactivated teacher", async () => {
    const res = await agentDeactTeacher.get("/api/courses");
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Active admin / teacher — control cases must remain accessible
// ---------------------------------------------------------------------------

describe("Active admin — control case remains accessible", () => {
  it("GET /api/students → 200 for active admin", async () => {
    const res = await agentActiveAdmin.get("/api/students");
    expect(res.status).toBe(200);
  });

  it("GET /api/users → 200 for active admin", async () => {
    const res = await agentActiveAdmin.get("/api/users");
    expect(res.status).toBe(200);
  });
});

describe("Active teacher — control case remains accessible", () => {
  it("GET /api/students → 200 for active teacher", async () => {
    const res = await agentActiveTeacher.get("/api/students");
    expect(res.status).toBe(200);
  });

  it("GET /api/assignments → 200 for active teacher", async () => {
    const res = await agentActiveTeacher.get("/api/assignments");
    expect(res.status).toBe(200);
  });
});
