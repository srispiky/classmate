/**
 * HTTP integration tests for SLO, availability, and operations report endpoints.
 * Verifies admin-only access control on all three new routes.
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

let admin: TestHttpUser;
let teacher: TestHttpUser;
let adminAgent: SupertestAgent;
let teacherAgent: SupertestAgent;

beforeAll(async () => {
  admin = await createHttpUser("slo", "admin");
  teacher = await createHttpUser("slo", "teacher");
  adminAgent = await loginAs(admin);
  teacherAgent = await loginAs(teacher);
});

afterAll(async () => {
  await cleanupHttpUser(admin.id);
  await cleanupHttpUser(teacher.id);
});

// ── GET /api/monitoring/slo ───────────────────────────────────────────────────

describe("GET /api/monitoring/slo", () => {
  it("returns 401 for unauthenticated", async () => {
    const res = await req().get("/api/monitoring/slo");
    expect(res.status).toBe(401);
  });

  it("returns 403 for teacher role", async () => {
    const res = await teacherAgent.get("/api/monitoring/slo");
    expect(res.status).toBe(403);
  });

  it("returns 200 with SLO report for admin", async () => {
    const res = await adminAgent.get("/api/monitoring/slo");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("slos");
    expect(Array.isArray(res.body.slos)).toBe(true);
    expect(res.body.slos).toHaveLength(5);
    expect(res.body).toHaveProperty("summary");
    expect(res.body.summary).toHaveProperty("total", 5);
  });

  it("each SLO result has required fields", async () => {
    const res = await adminAgent.get("/api/monitoring/slo");
    const first = res.body.slos[0];
    expect(first).toHaveProperty("id");
    expect(first).toHaveProperty("name");
    expect(first).toHaveProperty("target");
    expect(first).toHaveProperty("current");
    expect(first).toHaveProperty("compliant");
    expect(first).toHaveProperty("errorBudget");
    expect(first.errorBudget).toHaveProperty("totalSeconds");
    expect(first.errorBudget).toHaveProperty("consumedPercent");
    expect(first.errorBudget).toHaveProperty("burnRate");
    expect(first.errorBudget).toHaveProperty("status");
  });
});

// ── GET /api/monitoring/availability ─────────────────────────────────────────

describe("GET /api/monitoring/availability", () => {
  it("returns 401 for unauthenticated", async () => {
    const res = await req().get("/api/monitoring/availability");
    expect(res.status).toBe(401);
  });

  it("returns 403 for teacher role", async () => {
    const res = await teacherAgent.get("/api/monitoring/availability");
    expect(res.status).toBe(403);
  });

  it("returns 200 with availability report for admin", async () => {
    const res = await adminAgent.get("/api/monitoring/availability");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("database");
    expect(res.body).toHaveProperty("overall");
    expect(res.body).toHaveProperty("outages");
    expect(res.body).toHaveProperty("capacityIndicators");
    expect(Array.isArray(res.body.outages)).toBe(true);
  });

  it("capacityIndicators has all required fields", async () => {
    const res = await adminAgent.get("/api/monitoring/availability");
    const cap = res.body.capacityIndicators;
    expect(cap).toHaveProperty("requestsPerMinute");
    expect(cap).toHaveProperty("estimatedDailyRequests");
    expect(cap).toHaveProperty("dbQueryLoad");
    expect(cap).toHaveProperty("backupStorageIndicator");
    expect(cap).toHaveProperty("requestGrowthTrend");
  });

  it("database availability has status field", async () => {
    const res = await adminAgent.get("/api/monitoring/availability");
    expect(["healthy", "degraded", "down"]).toContain(res.body.database.status);
  });
});

// ── GET /api/monitoring/operations-report ────────────────────────────────────

describe("GET /api/monitoring/operations-report", () => {
  it("returns 401 for unauthenticated", async () => {
    const res = await req().get("/api/monitoring/operations-report");
    expect(res.status).toBe(401);
  });

  it("returns 403 for teacher role", async () => {
    const res = await teacherAgent.get("/api/monitoring/operations-report");
    expect(res.status).toBe(403);
  });

  it("returns 200 with operations report for admin", async () => {
    const res = await adminAgent.get("/api/monitoring/operations-report");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("generatedAt");
    expect(res.body).toHaveProperty("reportPeriod");
    expect(res.body).toHaveProperty("uptime");
    expect(res.body).toHaveProperty("requests");
    expect(res.body).toHaveProperty("authentication");
    expect(res.body).toHaveProperty("database");
    expect(res.body).toHaveProperty("backup");
    expect(res.body).toHaveProperty("alerts");
    expect(res.body).toHaveProperty("slo");
    expect(res.body).toHaveProperty("capacity");
    expect(res.body).toHaveProperty("recommendations");
    expect(Array.isArray(res.body.recommendations)).toBe(true);
  });

  it("slo field in report has overallHealthLabel", async () => {
    const res = await adminAgent.get("/api/monitoring/operations-report");
    const validLabels = ["excellent", "good", "at_risk", "critical"];
    expect(validLabels).toContain(res.body.slo.overallHealthLabel);
  });

  it("recommendations is non-empty (always has at least one entry)", async () => {
    const res = await adminAgent.get("/api/monitoring/operations-report");
    expect(res.body.recommendations.length).toBeGreaterThan(0);
  });
});
