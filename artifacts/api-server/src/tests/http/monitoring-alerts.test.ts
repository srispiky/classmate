/**
 * HTTP integration tests for alert endpoints.
 *
 * Verifies authorization (admin-only) and basic lifecycle transitions
 * via the HTTP layer, using the live Express app and a real DB session.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  req,
  loginAs,
  createHttpUser,
  cleanupHttpUser,
  type TestHttpUser,
  type SupertestAgent,
} from "./setup";

// ── Test users ────────────────────────────────────────────────────────────────

let admin: TestHttpUser;
let teacher: TestHttpUser;
let adminAgent: SupertestAgent;
let teacherAgent: SupertestAgent;

beforeAll(async () => {
  admin = await createHttpUser("alerts", "admin");
  teacher = await createHttpUser("alerts", "teacher");
  adminAgent = await loginAs(admin);
  teacherAgent = await loginAs(teacher);
});

afterAll(async () => {
  await cleanupHttpUser(admin.id);
  await cleanupHttpUser(teacher.id);
});

// ── GET /api/monitoring/alerts ────────────────────────────────────────────────

describe("GET /api/monitoring/alerts", () => {
  it("returns 401 for unauthenticated requests", async () => {
    const res = await req().get("/api/monitoring/alerts");
    expect(res.status).toBe(401);
  });

  it("returns 403 for teacher role", async () => {
    const res = await teacherAgent.get("/api/monitoring/alerts");
    expect(res.status).toBe(403);
  });

  it("returns 200 with an array for admin", async () => {
    const res = await adminAgent.get("/api/monitoring/alerts");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("accepts ?status=active filter without error", async () => {
    const res = await adminAgent.get("/api/monitoring/alerts?status=active");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("accepts ?status=acknowledged filter without error", async () => {
    const res = await adminAgent.get("/api/monitoring/alerts?status=acknowledged");
    expect(res.status).toBe(200);
  });

  it("accepts ?status=resolved filter without error", async () => {
    const res = await adminAgent.get("/api/monitoring/alerts?status=resolved");
    expect(res.status).toBe(200);
  });
});

// ── GET /api/monitoring/alerts/:id ───────────────────────────────────────────

describe("GET /api/monitoring/alerts/:id", () => {
  it("returns 401 for unauthenticated requests", async () => {
    const res = await req().get("/api/monitoring/alerts/some-id");
    expect(res.status).toBe(401);
  });

  it("returns 403 for teacher role", async () => {
    const res = await teacherAgent.get("/api/monitoring/alerts/some-id");
    expect(res.status).toBe(403);
  });

  it("returns 404 for an unknown alert id", async () => {
    const res = await adminAgent.get("/api/monitoring/alerts/unknown-id-123");
    expect(res.status).toBe(404);
  });
});

// ── PATCH /api/monitoring/alerts/:id ─────────────────────────────────────────

describe("PATCH /api/monitoring/alerts/:id", () => {
  it("returns 401 for unauthenticated requests", async () => {
    const res = await req()
      .patch("/api/monitoring/alerts/some-id")
      .send({ action: "acknowledge" });
    expect(res.status).toBe(401);
  });

  it("returns 403 for teacher role", async () => {
    const res = await teacherAgent
      .patch("/api/monitoring/alerts/some-id")
      .send({ action: "acknowledge" });
    expect(res.status).toBe(403);
  });

  it("returns 400 for invalid action", async () => {
    const res = await adminAgent
      .patch("/api/monitoring/alerts/some-id")
      .send({ action: "delete" });
    expect(res.status).toBe(400);
  });

  it("returns 404 for an unknown alert id with valid action", async () => {
    const res = await adminAgent
      .patch("/api/monitoring/alerts/unknown-id-xyz")
      .send({ action: "acknowledge" });
    expect(res.status).toBe(404);
  });
});

// ── GET /api/monitoring/status (alerts field) ─────────────────────────────────

describe("GET /api/monitoring/status — alerts field", () => {
  it("includes alerts counts in the response", async () => {
    const res = await adminAgent.get("/api/monitoring/status");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("alerts");
    expect(res.body.alerts).toHaveProperty("active");
    expect(res.body.alerts).toHaveProperty("acknowledged");
    expect(res.body.alerts).toHaveProperty("resolved");
    expect(typeof res.body.alerts.active).toBe("number");
    expect(typeof res.body.alerts.acknowledged).toBe("number");
    expect(typeof res.body.alerts.resolved).toBe("number");
  });
});
