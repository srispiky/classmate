/**
 * Sprint 9 Chunk 4 — Part 2: Authentication Endpoint Tests
 *
 * HTTP integration coverage for:
 *   POST /api/auth/login
 *   POST /api/auth/logout
 *   GET  /api/auth/me
 *
 * Uses a real Express app, real middleware stack, and real PostgreSQL session store.
 * No mocks — this exercises the platform exactly as production does.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import supertest from "supertest";
import { app, req, createHttpUser, cleanupHttpUser, loginAs, type TestHttpUser } from "./setup";

const PREFIX = "_s9c4_auth";

let adminUser: TestHttpUser;

beforeAll(async () => {
  adminUser = await createHttpUser(PREFIX, "admin");
});

afterAll(async () => {
  await cleanupHttpUser(adminUser.id);
});

// ── POST /api/auth/login ───────────────────────────────────────────────────────

describe("POST /api/auth/login", () => {
  it("200 — valid credentials return user payload and set session cookie", async () => {
    const res = await req()
      .post("/api/auth/login")
      .send({ username: adminUser.username, password: adminUser.password });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: expect.any(Number),
      username: adminUser.username,
      displayName: expect.any(String),
      role: "admin",
    });
    // Session cookie must be set
    const setCookie = res.headers["set-cookie"] as string[] | string | undefined;
    const cookieStr = Array.isArray(setCookie) ? setCookie.join("; ") : (setCookie ?? "");
    expect(cookieStr).toContain("connect.sid");
  });

  it("400 — missing username returns 400", async () => {
    const res = await req()
      .post("/api/auth/login")
      .send({ password: adminUser.password });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("400 — missing password returns 400", async () => {
    const res = await req()
      .post("/api/auth/login")
      .send({ username: adminUser.username });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("400 — empty body returns 400", async () => {
    const res = await req().post("/api/auth/login").send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("401 — wrong password returns 401", async () => {
    const res = await req()
      .post("/api/auth/login")
      .send({ username: adminUser.username, password: "WrongPassword1!" });
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("error");
  });

  it("401 — non-existent user returns 401 (same message, no user enumeration)", async () => {
    const res = await req()
      .post("/api/auth/login")
      .send({ username: "no_such_user_zzz", password: "SomePassword1!" });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid username or password");
  });

  it.each([
    ["admin"],
    ["teacher"],
    ["parent"],
  ] as const)(
    "401 — deactivated %s account is rejected even with correct password",
    async (role) => {
      const inactiveUser = await createHttpUser(`${PREFIX}_inactive_${role}`, role);
      // Deactivate via direct DB update to avoid going through the API
      const { db, usersTable } = await import("@workspace/db");
      const { eq } = await import("drizzle-orm");
      await db
        .update(usersTable)
        .set({ isActive: false })
        .where(eq(usersTable.id, inactiveUser.id));

      const res = await req()
        .post("/api/auth/login")
        .send({ username: inactiveUser.username, password: inactiveUser.password });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe("Invalid username or password");

      await cleanupHttpUser(inactiveUser.id);
    },
  );

  it("200 — re-activated account can log in again after being re-enabled", async () => {
    const user = await createHttpUser(`${PREFIX}_reactivate`, "teacher");
    const { db, usersTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");

    // Deactivate
    await db.update(usersTable).set({ isActive: false }).where(eq(usersTable.id, user.id));

    // Confirm login is blocked
    const blocked = await req()
      .post("/api/auth/login")
      .send({ username: user.username, password: user.password });
    expect(blocked.status).toBe(401);

    // Re-activate
    await db.update(usersTable).set({ isActive: true }).where(eq(usersTable.id, user.id));

    // Confirm login works again
    const restored = await req()
      .post("/api/auth/login")
      .send({ username: user.username, password: user.password });
    expect(restored.status).toBe(200);
    expect(restored.body).toMatchObject({ id: user.id, username: user.username });

    await cleanupHttpUser(user.id);
  });

  it("401 — wrong password returns same error message as non-existent user (no user enumeration)", async () => {
    const wrongPassRes = await req()
      .post("/api/auth/login")
      .send({ username: adminUser.username, password: "Wrong123!" });
    const noUserRes = await req()
      .post("/api/auth/login")
      .send({ username: "totally_unknown_xyz_123", password: "Wrong123!" });

    expect(wrongPassRes.body.error).toBe(noUserRes.body.error);
  });
});

// ── POST /api/auth/logout ──────────────────────────────────────────────────────

describe("POST /api/auth/logout", () => {
  it("200 — authenticated user can log out", async () => {
    const agent = await loginAs(adminUser);
    const res = await agent.post("/api/auth/logout");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
  });

  it("session is invalidated after logout — /auth/me returns 401", async () => {
    const agent = await loginAs(adminUser);

    // Confirm session is active
    const meBefore = await agent.get("/api/auth/me");
    expect(meBefore.status).toBe(200);

    // Log out
    await agent.post("/api/auth/logout");

    // Session should no longer be valid
    const meAfter = await agent.get("/api/auth/me");
    expect(meAfter.status).toBe(401);
  });

  it("200 — unauthenticated logout does not crash (idempotent)", async () => {
    const res = await req().post("/api/auth/logout");
    // logout destroys session regardless — server must not 500
    expect(res.status).toBeLessThan(500);
  });
});

// ── GET /api/auth/me ───────────────────────────────────────────────────────────

describe("GET /api/auth/me", () => {
  it("200 — authenticated session returns correct user shape", async () => {
    const agent = await loginAs(adminUser);
    const res = await agent.get("/api/auth/me");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: adminUser.id,
      username: adminUser.username,
      role: "admin",
    });
    // Must not leak passwordHash
    expect(res.body).not.toHaveProperty("passwordHash");
  });

  it("401 — no session returns 401", async () => {
    const res = await req().get("/api/auth/me");
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("error");
  });

  it("401 — fabricated session cookie is rejected", async () => {
    const res = await supertest(app)
      .get("/api/auth/me")
      .set("Cookie", "connect.sid=s%3Afake_session_id_that_does_not_exist.fake_sig");
    expect(res.status).toBe(401);
  });
});

// ── Mid-session deactivation ──────────────────────────────────────────────────

describe("Account deactivated mid-session", () => {
  it("401 — session is killed immediately when account is deactivated mid-session", async () => {
    // Arrange: create a user and log in to obtain a live session
    const user = await createHttpUser(`${PREFIX}_middeact`, "admin");
    const agent = await loginAs(user);

    // Sanity-check: session is active
    const before = await agent.get("/api/dashboard/summary");
    expect(before.status).toBe(200);

    // Act: deactivate the account while the session is still live
    const { db, usersTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    await db
      .update(usersTable)
      .set({ isActive: false })
      .where(eq(usersTable.id, user.id));

    // Assert: the protected endpoint returns 401 — session is killed, not just forbidden
    const after = await agent.get("/api/dashboard/summary");
    expect(after.status).toBe(401);
    expect(after.body).toHaveProperty("error");

    // Assert: session is fully invalidated — /auth/me also returns 401 on the same agent
    const meAfter = await agent.get("/api/auth/me");
    expect(meAfter.status).toBe(401);

    await cleanupHttpUser(user.id);
  });
});

// ── Role changed mid-session ──────────────────────────────────────────────────

describe("Role changed mid-session", () => {
  it("teacher→admin promotion takes effect immediately — admin-only endpoint is accessible and teacher endpoint is still allowed without re-login", async () => {
    // Arrange: create a teacher user and obtain a live session
    const user = await createHttpUser(`${PREFIX}_promote`, "teacher");
    const agent = await loginAs(user);

    // Sanity-check: teacher can access a teacher-allowed endpoint before the role change
    const beforeTeacher = await agent.get("/api/dashboard/summary");
    expect(beforeTeacher.status).toBe(200);

    // Sanity-check: teacher cannot access an admin-only endpoint before the role change
    const beforeAdmin = await agent.get("/api/admin/db-status");
    expect(beforeAdmin.status).toBe(403);

    // Act: promote the role in the DB from teacher → admin while the session is live
    const { db, usersTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    await db
      .update(usersTable)
      .set({ role: "admin" })
      .where(eq(usersTable.id, user.id));

    // Assert: the global requireActiveAccount middleware re-queries the role on the
    // very next request and updates req.session.role before any per-route requireRole
    // check fires, so the promotion is reflected immediately without re-login.
    const afterAdmin = await agent.get("/api/admin/db-status");
    expect(afterAdmin.status).toBe(200);

    // Assert: the former teacher-allowed endpoint is still accessible on the same
    // session — admins retain all teacher permissions.
    const afterTeacher = await agent.get("/api/dashboard/summary");
    expect(afterTeacher.status).toBe(200);

    await cleanupHttpUser(user.id);
  });

  it("admin→teacher demotion takes effect immediately — admin-only endpoint is denied and teacher endpoint is allowed without re-login", async () => {
    // Arrange: create an admin user and obtain a live session
    const user = await createHttpUser(`${PREFIX}_rolechange`, "admin");
    const agent = await loginAs(user);

    // Sanity-check: admin can access an admin-only endpoint before the role change
    const before = await agent.get("/api/admin/db-status");
    expect(before.status).toBe(200);

    // Act: change the role in the DB from admin → teacher while the session is live
    const { db, usersTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    await db
      .update(usersTable)
      .set({ role: "teacher" })
      .where(eq(usersTable.id, user.id));

    // Assert: the very next request to an admin-only endpoint is denied (403).
    // The global requireActiveAccount middleware re-queries the role on every
    // authenticated request and updates req.session.role before any per-route
    // requireRole check fires, so the demotion is reflected immediately.
    const afterAdmin = await agent.get("/api/admin/db-status");
    expect(afterAdmin.status).toBe(403);

    // Assert: a teacher-allowed endpoint is accessible on the same session —
    // the freshened session role ("teacher") satisfies requireRole("admin", "teacher").
    const afterTeacher = await agent.get("/api/dashboard/summary");
    expect(afterTeacher.status).toBe(200);

    await cleanupHttpUser(user.id);
  });

  it("parent→teacher promotion takes effect immediately — teacher endpoint is accessible and parent-only endpoint is denied without re-login", async () => {
    // Arrange: create a parent user and obtain a live session.
    // The parent enricher populates childStudentIds/childCourseIds in the session;
    // this test verifies those stale parent-scoped fields do not survive the role change.
    const user = await createHttpUser(`${PREFIX}_par2teacher`, "parent");
    const agent = await loginAs(user);

    // Sanity-check: parent can access a parent-only endpoint before the role change
    const beforeParent = await agent.get("/api/parent/dashboard");
    expect(beforeParent.status).toBe(200);

    // Sanity-check: parent cannot access a teacher-only endpoint before the role change
    const beforeTeacher = await agent.get("/api/dashboard/summary");
    expect(beforeTeacher.status).toBe(403);

    // Act: promote the role in the DB from parent → teacher while the session is live
    const { db, usersTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    await db
      .update(usersTable)
      .set({ role: "teacher" })
      .where(eq(usersTable.id, user.id));

    // Assert: the global requireActiveAccount middleware re-queries the role on the
    // very next request, calls SessionEnricherService.enrich() with the new "teacher"
    // role (clearing stale parent fields and populating teacherId/ownedCourseIds),
    // so the teacher-allowed endpoint is immediately accessible without re-login.
    const afterTeacher = await agent.get("/api/dashboard/summary");
    expect(afterTeacher.status).toBe(200);

    // Assert: the parent-only endpoint is now denied — the freshened session role
    // ("teacher") no longer satisfies requireRole("parent"), so the per-route guard
    // returns 403 before requireActiveAccount even runs.
    const afterParent = await agent.get("/api/parent/dashboard");
    expect(afterParent.status).toBe(403);

    await cleanupHttpUser(user.id);
  });
});

// ── Security headers (Helmet) ─────────────────────────────────────────────────

describe("Security headers present on auth responses", () => {
  it("X-Content-Type-Options: nosniff is set", async () => {
    const res = await req().get("/api/auth/me");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("X-Frame-Options is set", async () => {
    const res = await req().get("/api/auth/me");
    expect(res.headers["x-frame-options"]).toBeDefined();
  });
});
