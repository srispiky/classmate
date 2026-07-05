import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import request from "supertest";
import app from "../../app";
import { metrics, MetricsStore } from "../../lib/metrics";
import {
  createHttpUser,
  cleanupHttpUser,
  loginAs,
  type TestHttpUser,
} from "../http/setup";

// ── MetricsStore — latency and per-endpoint tracking ─────────────────────────

describe("MetricsStore — latency and per-endpoint tracking", () => {
  let store: MetricsStore;

  beforeEach(() => {
    store = new MetricsStore();
  });

  it("latencyPercentiles returns zeros for empty store", () => {
    const lat = store.latencyPercentiles();
    expect(lat.p50).toBe(0);
    expect(lat.p95).toBe(0);
    expect(lat.p99).toBe(0);
    expect(lat.sampleSize).toBe(0);
  });

  it("computes p50 correctly for odd sample", () => {
    for (const d of [10, 20, 30]) store.recordRequest(200, d);
    const lat = store.latencyPercentiles();
    expect(lat.p50).toBe(20);
    expect(lat.sampleSize).toBe(3);
  });

  it("computes p95 and p99 for larger sample", () => {
    for (let i = 1; i <= 100; i++) store.recordRequest(200, i);
    const lat = store.latencyPercentiles();
    expect(lat.p50).toBe(50);
    expect(lat.p95).toBe(95);
    expect(lat.p99).toBe(99);
    expect(lat.sampleSize).toBe(100);
  });

  it("records DB query duration and computes average", () => {
    store.recordDbQuery(10);
    store.recordDbQuery(30);
    const snap = store.snapshot();
    expect(snap.database.queryCount).toBe(2);
    expect(snap.database.avgQueryMs).toBe(20);
  });

  it("slowestEndpoints returns endpoints sorted by p95 descending", () => {
    for (let i = 0; i < 10; i++) store.recordRequest(200, 5, "/api/students");
    for (let i = 0; i < 10; i++) store.recordRequest(200, 100, "/api/dashboard/summary");
    const slow = store.slowestEndpoints(5);
    expect(slow[0]?.path).toBe("/api/dashboard/summary");
    expect(slow[1]?.path).toBe("/api/students");
  });

  it("slowestEndpoints normalizes numeric path segments", () => {
    store.recordRequest(200, 50, "/api/students/123");
    store.recordRequest(200, 50, "/api/students/456");
    const slow = store.slowestEndpoints(5);
    expect(slow.length).toBe(1);
    expect(slow[0]?.path).toBe("/api/students/:id");
    expect(slow[0]?.count).toBe(2);
  });

  it("reset clears durationWindow and endpointDurations", () => {
    store.recordRequest(200, 50, "/api/students");
    store.recordDbQuery(20);
    store.reset();
    expect(store.latencyPercentiles().sampleSize).toBe(0);
    expect(store.slowestEndpoints(5)).toHaveLength(0);
    expect(store.snapshot().database.queryCount).toBe(0);
  });

  it("includes latency and slowestEndpoints in snapshot", () => {
    store.recordRequest(200, 25, "/api/notes");
    const snap = store.snapshot();
    expect(snap.latency.sampleSize).toBe(1);
    expect(snap.slowestEndpoints).toBeInstanceOf(Array);
  });
});

// ── GET /api/monitoring/status — authorization ────────────────────────────────

describe("GET /api/monitoring/status — authorization", () => {
  const PREFIX = "_mon_status";
  let adminUser: TestHttpUser;
  let teacherUser: TestHttpUser;
  let studentUser: TestHttpUser;

  beforeAll(async () => {
    [adminUser, teacherUser, studentUser] = await Promise.all([
      createHttpUser(PREFIX, "admin"),
      createHttpUser(PREFIX, "teacher"),
      createHttpUser(PREFIX, "student"),
    ]);
  });

  afterAll(async () => {
    await Promise.all([
      cleanupHttpUser(adminUser.id),
      cleanupHttpUser(teacherUser.id),
      cleanupHttpUser(studentUser.id),
    ]);
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get("/api/monitoring/status");
    expect(res.status).toBe(401);
  });

  it("returns 403 for student role", async () => {
    const agent = await loginAs(studentUser);
    const res = await agent.get("/api/monitoring/status");
    expect(res.status).toBe(403);
  });

  it("returns 403 for teacher role", async () => {
    const agent = await loginAs(teacherUser);
    const res = await agent.get("/api/monitoring/status");
    expect(res.status).toBe(403);
  });

  it("returns 200 with all required fields for admin", async () => {
    const agent = await loginAs(adminUser);
    const res = await agent.get("/api/monitoring/status");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: expect.any(String),
      version: expect.any(String),
      uptime: expect.any(Number),
      database: {
        status: expect.any(String),
        queryCount: expect.any(Number),
        queryFailures: expect.any(Number),
        avgQueryMs: expect.any(Number),
      },
      backup: {
        configured: expect.any(Boolean),
        runs: expect.any(Number),
        failures: expect.any(Number),
      },
      replication: {
        configured: expect.any(Boolean),
      },
    });
  });

  it("status is ok when database is reachable", async () => {
    const agent = await loginAs(adminUser);
    const res = await agent.get("/api/monitoring/status");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.database.status).toBe("ok");
  });

  it("does not expose DATABASE_URL or other secrets", async () => {
    const agent = await loginAs(adminUser);
    const res = await agent.get("/api/monitoring/status");
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/DATABASE_URL/i);
    expect(body).not.toMatch(/SESSION_SECRET/i);
    expect(body).not.toMatch(/S3_BUCKET/i);
  });
});

// ── GET /api/monitoring/summary — authorization + shape ───────────────────────

describe("GET /api/monitoring/summary — authorization", () => {
  const PREFIX = "_mon_summary";
  let adminUser: TestHttpUser;
  let teacherUser: TestHttpUser;
  let studentUser: TestHttpUser;

  beforeAll(async () => {
    [adminUser, teacherUser, studentUser] = await Promise.all([
      createHttpUser(PREFIX, "admin"),
      createHttpUser(PREFIX, "teacher"),
      createHttpUser(PREFIX, "student"),
    ]);
  });

  afterAll(async () => {
    await Promise.all([
      cleanupHttpUser(adminUser.id),
      cleanupHttpUser(teacherUser.id),
      cleanupHttpUser(studentUser.id),
    ]);
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get("/api/monitoring/summary");
    expect(res.status).toBe(401);
  });

  it("returns 403 for student role", async () => {
    const agent = await loginAs(studentUser);
    const res = await agent.get("/api/monitoring/summary");
    expect(res.status).toBe(403);
  });

  it("returns 403 for teacher role", async () => {
    const agent = await loginAs(teacherUser);
    const res = await agent.get("/api/monitoring/summary");
    expect(res.status).toBe(403);
  });

  it("returns 200 with full summary shape for admin", async () => {
    const agent = await loginAs(adminUser);
    const res = await agent.get("/api/monitoring/summary");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      requests: {
        total: expect.any(Number),
        errors: expect.any(Number),
        avgDurationMs: expect.any(Number),
      },
      auth: {
        loginAttempts: expect.any(Number),
        loginFailures: expect.any(Number),
        rateLimitHits: expect.any(Number),
      },
      latency: {
        p50: expect.any(Number),
        p95: expect.any(Number),
        p99: expect.any(Number),
        sampleSize: expect.any(Number),
      },
      slowestEndpoints: expect.any(Array),
      database: {
        queryCount: expect.any(Number),
        queryFailures: expect.any(Number),
        avgQueryMs: expect.any(Number),
      },
      backup: {
        runs: expect.any(Number),
        failures: expect.any(Number),
      },
      process: {
        startedAt: expect.any(String),
        uptimeSeconds: expect.any(Number),
      },
    });
  });

  it("summary reflects requests made since startup", async () => {
    const agent = await loginAs(adminUser);
    await request(app).get("/api/healthz");
    await agent.get("/api/students");

    const res = await agent.get("/api/monitoring/summary");
    expect(res.status).toBe(200);
    expect(res.body.requests.total).toBeGreaterThan(0);
    expect(res.body.latency.sampleSize).toBeGreaterThan(0);
  });

  it("byStatus is a record of numeric values", async () => {
    const agent = await loginAs(adminUser);
    const res = await agent.get("/api/monitoring/summary");
    expect(res.status).toBe(200);
    const { byStatus } = res.body.requests as { byStatus: Record<string, unknown> };
    expect(typeof byStatus).toBe("object");
    for (const v of Object.values(byStatus)) {
      expect(typeof v).toBe("number");
    }
  });
});

// ── Global metrics singleton ──────────────────────────────────────────────────

describe("Global metrics singleton — path tracking", () => {
  beforeEach(() => { metrics.reset(); });
  afterEach(() => { metrics.reset(); });

  it("records requests made through the app", async () => {
    await request(app).get("/api/healthz");
    await request(app).get("/api/healthz");
    expect(metrics.snapshot().requests.total).toBeGreaterThanOrEqual(2);
  });

  it("latency window grows with each request", async () => {
    metrics.reset();
    await request(app).get("/api/healthz");
    expect(metrics.latencyPercentiles().sampleSize).toBeGreaterThanOrEqual(1);
  });
});
