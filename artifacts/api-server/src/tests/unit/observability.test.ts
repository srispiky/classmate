import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import app from "../../app";
import { MetricsStore } from "../../lib/metrics";

// ── MetricsStore unit tests ───────────────────────────────────────────────────

describe("MetricsStore", () => {
  let store: MetricsStore;

  beforeEach(() => {
    store = new MetricsStore();
  });

  it("starts with zero counters", () => {
    const snap = store.snapshot();
    expect(snap.requests.total).toBe(0);
    expect(snap.requests.errors).toBe(0);
    expect(snap.requests.avgDurationMs).toBe(0);
    expect(snap.auth.loginAttempts).toBe(0);
    expect(snap.auth.loginFailures).toBe(0);
    expect(snap.auth.rateLimitHits).toBe(0);
    expect(snap.database.queryFailures).toBe(0);
    expect(snap.backup.runs).toBe(0);
    expect(snap.backup.failures).toBe(0);
    expect(snap.backup.lastRunAt).toBeNull();
  });

  it("records successful requests and computes average duration", () => {
    store.recordRequest(200, 10);
    store.recordRequest(200, 30);
    store.recordRequest(201, 20);
    const snap = store.snapshot();
    expect(snap.requests.total).toBe(3);
    expect(snap.requests.errors).toBe(0);
    expect(snap.requests.avgDurationMs).toBe(20);
    expect(snap.requests.byStatus["200"]).toBe(2);
    expect(snap.requests.byStatus["201"]).toBe(1);
  });

  it("counts 5xx as errors", () => {
    store.recordRequest(200, 5);
    store.recordRequest(500, 5);
    store.recordRequest(503, 5);
    const snap = store.snapshot();
    expect(snap.requests.total).toBe(3);
    expect(snap.requests.errors).toBe(2);
  });

  it("records auth attempts and failures independently", () => {
    store.recordAuthAttempt();
    store.recordAuthAttempt();
    store.recordAuthFailure();
    const snap = store.snapshot();
    expect(snap.auth.loginAttempts).toBe(2);
    expect(snap.auth.loginFailures).toBe(1);
  });

  it("records rate limit hits", () => {
    store.recordAuthRateLimit();
    store.recordAuthRateLimit();
    expect(store.snapshot().auth.rateLimitHits).toBe(2);
  });

  it("records database query failures", () => {
    store.recordDbFailure();
    expect(store.snapshot().database.queryFailures).toBe(1);
  });

  it("records successful backup run", () => {
    store.recordBackupRun(true);
    const snap = store.snapshot();
    expect(snap.backup.runs).toBe(1);
    expect(snap.backup.failures).toBe(0);
    expect(snap.backup.lastRunAt).not.toBeNull();
  });

  it("records failed backup run and increments failure counter", () => {
    store.recordBackupRun(false);
    const snap = store.snapshot();
    expect(snap.backup.runs).toBe(1);
    expect(snap.backup.failures).toBe(1);
  });

  it("snapshot returns a copy — mutations do not affect the snapshot", () => {
    store.recordRequest(200, 5);
    const snap = store.snapshot();
    snap.requests.total = 999;
    expect(store.snapshot().requests.total).toBe(1);
  });

  it("snapshot byStatus is a shallow copy", () => {
    store.recordRequest(200, 5);
    const snap = store.snapshot();
    snap.requests.byStatus["200"] = 999;
    expect(store.snapshot().requests.byStatus["200"]).toBe(1);
  });

  it("reset clears all counters", () => {
    store.recordRequest(200, 10);
    store.recordAuthAttempt();
    store.recordAuthFailure();
    store.recordDbFailure();
    store.recordBackupRun(false);
    store.reset();
    const snap = store.snapshot();
    expect(snap.requests.total).toBe(0);
    expect(snap.auth.loginAttempts).toBe(0);
    expect(snap.database.queryFailures).toBe(0);
    expect(snap.backup.runs).toBe(0);
  });

  it("startedAt is a valid ISO 8601 timestamp", () => {
    const snap = store.snapshot();
    expect(() => new Date(snap.process.startedAt)).not.toThrow();
    expect(new Date(snap.process.startedAt).toISOString()).toBe(snap.process.startedAt);
  });

  it("uptimeSeconds is a non-negative integer", () => {
    const snap = store.snapshot();
    expect(snap.process.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(snap.process.uptimeSeconds)).toBe(true);
  });
});

// ── Health endpoint integration tests ─────────────────────────────────────────

describe("GET /api/healthz — expanded health check", () => {
  it("returns 200 with required fields", async () => {
    const res = await request(app).get("/api/healthz");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: "ok",
      database: { status: "ok" },
    });
  });

  it("includes version field", async () => {
    const res = await request(app).get("/api/healthz");
    expect(typeof res.body.version).toBe("string");
  });

  it("includes uptime as a non-negative number", async () => {
    const res = await request(app).get("/api/healthz");
    expect(typeof res.body.uptime).toBe("number");
    expect(res.body.uptime).toBeGreaterThanOrEqual(0);
  });

  it("includes backup configuration flag (boolean)", async () => {
    const res = await request(app).get("/api/healthz");
    expect(typeof res.body.backup?.configured).toBe("boolean");
  });

  it("includes replication configuration flag (boolean)", async () => {
    const res = await request(app).get("/api/healthz");
    expect(typeof res.body.replication?.configured).toBe("boolean");
  });

  it("includes metrics summary", async () => {
    const res = await request(app).get("/api/healthz");
    expect(typeof res.body.metrics?.requests).toBe("number");
    expect(typeof res.body.metrics?.errors).toBe("number");
    expect(typeof res.body.metrics?.avgDurationMs).toBe("number");
  });

  it("does not expose DATABASE_URL, S3_BUCKET, or secrets", async () => {
    const res = await request(app).get("/api/healthz");
    const bodyStr = JSON.stringify(res.body);
    expect(bodyStr).not.toMatch(/DATABASE_URL/i);
    expect(bodyStr).not.toMatch(/S3_BUCKET/i);
    expect(bodyStr).not.toMatch(/SESSION_SECRET/i);
    expect(bodyStr).not.toMatch(/PASSWORD_ENCRYPTION_KEY/i);
    expect(bodyStr).not.toMatch(/password/i);
  });
});

// ── Request ID header tests ───────────────────────────────────────────────────

describe("X-Request-Id header", () => {
  it("is present on every response", async () => {
    const res = await request(app).get("/api/healthz");
    expect(res.headers["x-request-id"]).toBeDefined();
    expect(typeof res.headers["x-request-id"]).toBe("string");
    expect(res.headers["x-request-id"].length).toBeGreaterThan(0);
  });

  it("is a UUID-formatted string", async () => {
    const res = await request(app).get("/api/healthz");
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(res.headers["x-request-id"]).toMatch(uuidRegex);
  });

  it("is unique per request", async () => {
    const [r1, r2, r3] = await Promise.all([
      request(app).get("/api/healthz"),
      request(app).get("/api/healthz"),
      request(app).get("/api/healthz"),
    ]);
    const ids = new Set([
      r1.headers["x-request-id"],
      r2.headers["x-request-id"],
      r3.headers["x-request-id"],
    ]);
    expect(ids.size).toBe(3);
  });

  it("is present on 401 responses", async () => {
    const res = await request(app).get("/api/students");
    expect(res.status).toBe(401);
    expect(res.headers["x-request-id"]).toBeDefined();
  });

  it("is present on 404 responses", async () => {
    const res = await request(app).get("/api/nonexistent-route-xyz");
    expect(res.headers["x-request-id"]).toBeDefined();
  });
});
