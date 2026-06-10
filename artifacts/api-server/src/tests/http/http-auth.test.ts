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

  it("401 — inactive user is rejected even with correct password", async () => {
    const inactiveUser = await createHttpUser(`${PREFIX}_inactive`, "teacher");
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

    await cleanupHttpUser(inactiveUser.id);
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
