/**
 * Dashboard Performance Test Suite
 *
 * Validates that the SQL-optimised dashboard endpoints:
 *   1. Return correct results (shape + values match the seed data)
 *   2. Complete within an acceptable wall-clock threshold
 *
 * Dataset: 100 students × 5 assignments × 4 assessments = 900 total rows
 *
 * Timing assertions use conservative thresholds (≤ 2 000 ms) that hold even
 * in the CI / shared-DB environment.  Real production latency with dedicated
 * PG will be well under 100 ms for these query shapes.
 *
 * Scale projections are documented in the deliverable section at the bottom.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db, coursesTable } from "@workspace/db";
import { createHttpUser, cleanupHttpUser, loginAs, req } from "../http/setup";
import type { TestHttpUser, SupertestAgent } from "../http/setup";
import { seedPerfData, sizeLabel } from "./load-harness";
import type { SeedResult } from "./load-harness";

// ── Fixture setup ─────────────────────────────────────────────────────────────

let admin: TestHttpUser;
let teacher: TestHttpUser;
let adminAgent: SupertestAgent;
let courseId: number;
let seed: SeedResult;

const NUM_STUDENTS = 100;

beforeAll(async () => {
  admin = await createHttpUser("perf_admin", "admin");
  teacher = await createHttpUser("perf_teacher", "teacher");
  adminAgent = await loginAs(admin);

  // Create a dedicated course for this test run
  const res = await adminAgent
    .post("/api/courses")
    .send({
      name: `__perf__Course_${Date.now()}`,
      subject: "Performance Testing",
      grade: "10",
      academicYear: "2025-2026",
      teacherId: teacher.id,
    });
  expect(res.status, `course creation: ${JSON.stringify(res.body)}`).toBe(201);
  courseId = res.body.id as number;

  // Seed 100 students with deterministic scores
  seed = await seedPerfData({
    numStudents: NUM_STUDENTS,
    courseId,
    assignmentsPerStudent: 5,
    assessmentsPerStudent: 4,
  });

  console.log(
    `[perf] Seeded ${sizeLabel(NUM_STUDENTS)} students, ` +
      `${seed.assignmentIds.length} assignments, ` +
      `${seed.assessmentIds.length} assessments`,
  );
}, 60_000);

afterAll(async () => {
  if (seed) await seed.cleanup();
  if (courseId) {
    await db.delete(coursesTable).where(
      (await import("drizzle-orm")).eq(coursesTable.id, courseId),
    );
  }
  if (teacher) await cleanupHttpUser(teacher.id);
  if (admin) await cleanupHttpUser(admin.id);
}, 30_000);

// ── Helpers ───────────────────────────────────────────────────────────────────

function measureAsync<T>(fn: () => Promise<T>): Promise<{ result: T; elapsedMs: number }> {
  const start = performance.now();
  return fn().then((result) => ({ result, elapsedMs: Math.round(performance.now() - start) }));
}

const THRESHOLD_MS = 2_000;

// ── /dashboard/summary ────────────────────────────────────────────────────────

describe("GET /dashboard/summary", () => {
  it(`responds within ${THRESHOLD_MS}ms with ${sizeLabel(NUM_STUDENTS)} students`, async () => {
    const { result: res, elapsedMs } = await measureAsync(() =>
      adminAgent.get("/api/dashboard/summary"),
    );
    console.log(`[perf] /dashboard/summary elapsed: ${elapsedMs}ms`);
    expect(res.status).toBe(200);
    expect(elapsedMs).toBeLessThan(THRESHOLD_MS);
  });

  it("returns correct scalar counts for seeded dataset", async () => {
    const res = await adminAgent.get("/api/dashboard/summary");
    expect(res.status).toBe(200);

    // At least the seeded students / assignments / assessments should be counted
    expect(res.body.totalStudents).toBeGreaterThanOrEqual(NUM_STUDENTS);
    expect(res.body.totalAssignments).toBeGreaterThanOrEqual(
      NUM_STUDENTS * 5,
    );
    expect(typeof res.body.averageClassScore).toBe("number");
    expect(typeof res.body.completionRate).toBe("number");
    expect(typeof res.body.atRiskStudents).toBe("number");
    expect(Array.isArray(res.body.topPerformers)).toBe(true);
    expect(res.body.topPerformers.length).toBeLessThanOrEqual(5);
  });

  it("topPerformers have averageScore ≥ 80", async () => {
    const res = await adminAgent.get("/api/dashboard/summary");
    expect(res.status).toBe(200);
    for (const p of res.body.topPerformers as Array<{ averageScore: number }>) {
      expect(p.averageScore).toBeGreaterThanOrEqual(80);
    }
  });

  it("atRiskStudents is a non-negative integer", async () => {
    const res = await adminAgent.get("/api/dashboard/summary");
    expect(res.status).toBe(200);
    expect(res.body.atRiskStudents).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(res.body.atRiskStudents)).toBe(true);
  });
});

// ── /dashboard/grade-breakdown ────────────────────────────────────────────────

describe("GET /dashboard/grade-breakdown", () => {
  it(`responds within ${THRESHOLD_MS}ms with ${sizeLabel(NUM_STUDENTS)} students`, async () => {
    const { result: res, elapsedMs } = await measureAsync(() =>
      adminAgent.get("/api/dashboard/grade-breakdown"),
    );
    console.log(`[perf] /dashboard/grade-breakdown elapsed: ${elapsedMs}ms`);
    expect(res.status).toBe(200);
    expect(elapsedMs).toBeLessThan(THRESHOLD_MS);
  });

  it("returns an array with at least the seeded course", async () => {
    const res = await adminAgent.get("/api/dashboard/grade-breakdown");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);

    const seededEntry = (res.body as Array<{ courseId: number; courseName: string }>).find(
      (c) => c.courseId === courseId,
    );
    expect(seededEntry).toBeDefined();
  });

  it("grade counts are non-negative integers that sum to totalAssessments for course", async () => {
    const res = await adminAgent.get("/api/dashboard/grade-breakdown");
    expect(res.status).toBe(200);

    const entry = (
      res.body as Array<{
        courseId: number;
        aCount: number;
        bCount: number;
        cCount: number;
        dCount: number;
        fCount: number;
      }>
    ).find((c) => c.courseId === courseId);

    expect(entry).toBeDefined();
    if (!entry) return;

    const total = entry.aCount + entry.bCount + entry.cCount + entry.dCount + entry.fCount;
    // 100 students × 4 assessments = 400 total assessments in this course
    expect(total).toBe(NUM_STUDENTS * 4);

    // Score distribution from the harness: 90, 70, 55, 80 (per student, repeated)
    // 90 → A (≥90), 70 → C (70–79), 55 → F (<60), 80 → B (80–89)
    // So: 25% A, 25% B, 25% C, 0% D, 25% F
    const expectedPerBucket = NUM_STUDENTS;
    expect(entry.aCount).toBe(expectedPerBucket);  // score 90 → A
    expect(entry.bCount).toBe(expectedPerBucket);  // score 80 → B
    expect(entry.cCount).toBe(expectedPerBucket);  // score 70 → C
    expect(entry.dCount).toBe(0);                  // no D scores in the harness
    expect(entry.fCount).toBe(expectedPerBucket);  // score 55 → F
  });
});

// ── /dashboard/recent-activity ────────────────────────────────────────────────

describe("GET /dashboard/recent-activity", () => {
  it(`responds within ${THRESHOLD_MS}ms`, async () => {
    const { result: res, elapsedMs } = await measureAsync(() =>
      adminAgent.get("/api/dashboard/recent-activity"),
    );
    console.log(`[perf] /dashboard/recent-activity elapsed: ${elapsedMs}ms`);
    expect(res.status).toBe(200);
    expect(elapsedMs).toBeLessThan(THRESHOLD_MS);
  });

  it("returns at most 20 items", async () => {
    const res = await adminAgent.get("/api/dashboard/recent-activity");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeLessThanOrEqual(20);
  });
});

// ── /dashboard/student-health ─────────────────────────────────────────────────

describe("GET /dashboard/student-health", () => {
  it(`responds within ${THRESHOLD_MS}ms with ${sizeLabel(NUM_STUDENTS)} students`, async () => {
    const { result: res, elapsedMs } = await measureAsync(() =>
      adminAgent.get("/api/dashboard/student-health"),
    );
    console.log(`[perf] /dashboard/student-health elapsed: ${elapsedMs}ms`);
    expect(res.status).toBe(200);
    expect(elapsedMs).toBeLessThan(THRESHOLD_MS);
  });

  it("returns correct cohort shape", async () => {
    const res = await adminAgent.get("/api/dashboard/student-health");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.atRisk)).toBe(true);
    expect(Array.isArray(res.body.improving)).toBe(true);
    expect(Array.isArray(res.body.declining)).toBe(true);
    expect(Array.isArray(res.body.noData)).toBe(true);
  });

  it("cohort members have id, name, and averageScore fields", async () => {
    const res = await adminAgent.get("/api/dashboard/student-health");
    expect(res.status).toBe(200);

    const allMembers = [
      ...res.body.atRisk,
      ...res.body.improving,
      ...res.body.declining,
      ...res.body.noData,
    ] as Array<{ id: number; name: string; averageScore: number }>;

    for (const m of allMembers) {
      expect(typeof m.id).toBe("number");
      expect(typeof m.name).toBe("string");
      expect(typeof m.averageScore).toBe("number");
    }
  });
});

// ── Scale projections ─────────────────────────────────────────────────────────
//
// The SQL-aggregate queries scale independently of row count for the summary
// and grade-breakdown endpoints.  Student-health still loads per-student arrays
// for chronological scoring — its memory usage grows linearly with student count.
//
// Projected behaviour (based on query shapes, not load-tested):
//
// | Endpoint              | 100 students | 1 K students | 10 K students |
// |-----------------------|--------------|--------------|---------------|
// | /summary              | < 50 ms      | < 100 ms     | < 200 ms      |
// | /grade-breakdown      | < 50 ms      | < 100 ms     | < 200 ms      |
// | /recent-activity      | < 20 ms      | < 20 ms      | < 20 ms       |
// | /student-health       | < 100 ms     | < 500 ms     | < 2 000 ms    |
//
// /summary and /grade-breakdown use pure SQL aggregates (GROUP BY / COUNT / AVG)
// and are bounded by index scan + aggregation cost — not result-set size.
// Their latency grows sub-linearly with row count.
//
// /student-health needs per-student score arrays for chronological trend analysis.
// At 10 K students this is the only endpoint that may benefit from further
// optimisation (e.g. pagination by cohort or moving chronological scoring to SQL
// using array_agg(score ORDER BY ts)).
