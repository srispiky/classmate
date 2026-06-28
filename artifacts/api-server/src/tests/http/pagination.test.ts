/**
 * Sprint 10 Chunk 2 — Cursor-based Pagination HTTP Tests
 *
 * Validates the paginated response shape and cursor-traversal semantics for:
 *   GET /api/students
 *   GET /api/assignments
 *   GET /api/assessments
 *
 * Isolation strategy:
 *   - Each suite creates its own admin user and a course to pin test rows to.
 *   - Students are named with a unique, lexicographically-early prefix so they
 *     appear first in name-ASC order even if the DB has existing rows.
 *   - Assignments and assessments are created under that course/student pair.
 *   - Limit=1 forces multi-page traversal reliably regardless of DB state.
 *   - After each suite all created rows are hard-deleted so other tests are
 *     unaffected.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import {
  db,
  studentsTable,
  assignmentsTable,
  assessmentsTable,
  coursesTable,
} from "@workspace/db";
import {
  req,
  createHttpUser,
  cleanupHttpUser,
  loginAs,
  type TestHttpUser,
  type SupertestAgent,
} from "./setup";

const PREFIX = "_s10c2_pag";

// ── Shared test state ─────────────────────────────────────────────────────────

let adminUser: TestHttpUser;
let adminAgent: SupertestAgent;

let courseId: number;
let studentIds: number[] = [];
let assignmentIds: number[] = [];
let assessmentIds: number[] = [];

// ── Helpers ───────────────────────────────────────────────────────────────────

async function createCourse(): Promise<number> {
  const [row] = await db
    .insert(coursesTable)
    .values({
      name: `${PREFIX}_course_${Date.now()}`,
      subject: "Mathematics",
      description: "Pagination test course",
      teacherId: adminUser.id,
      createdBy: adminUser.id,
      updatedBy: adminUser.id,
    })
    .returning({ id: coursesTable.id });
  return row!.id;
}

async function createStudent(suffix: string): Promise<number> {
  const [row] = await db
    .insert(studentsTable)
    .values({
      // Names starting with "!" sort before any letter — guaranteed page-one visibility.
      name: `!${PREFIX}_${suffix}`,
      email: `${PREFIX}_${suffix}_${Date.now()}@test.com`,
      grade: "10",
      enrolledCourseIds: [courseId],
      createdBy: adminUser.id,
      updatedBy: adminUser.id,
    })
    .returning({ id: studentsTable.id });
  return row!.id;
}

async function createAssignment(studentId: number, dueDate: string): Promise<number> {
  const [row] = await db
    .insert(assignmentsTable)
    .values({
      title: `${PREFIX}_assign_${dueDate}`,
      description: "Pagination test",
      courseId,
      studentId,
      dueDate,
      status: "pending",
      maxScore: 100,
      createdBy: adminUser.id,
      updatedBy: adminUser.id,
    })
    .returning({ id: assignmentsTable.id });
  return row!.id;
}

async function createAssessment(studentId: number): Promise<number> {
  const [row] = await db
    .insert(assessmentsTable)
    .values({
      title: `${PREFIX}_assess_${Date.now()}`,
      courseId,
      studentId,
      score: 80,
      maxScore: 100,
      strengths: ["algebra"],
      weaknesses: ["geometry"],
      createdBy: adminUser.id,
      updatedBy: adminUser.id,
    })
    .returning({ id: assessmentsTable.id });
  return row!.id;
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

beforeAll(async () => {
  adminUser = await createHttpUser(PREFIX, "admin");
  adminAgent = await loginAs(adminUser);
  courseId = await createCourse();

  // Create 3 students that sort lexicographically first (names start with "!")
  const [s1, s2, s3] = await Promise.all([
    createStudent("aaa"),
    createStudent("bbb"),
    createStudent("ccc"),
  ]);
  studentIds = [s1!, s2!, s3!];

  const studentId = studentIds[0]!;

  // Create 3 assignments with distinct, ordered due dates
  const [a1, a2, a3] = await Promise.all([
    createAssignment(studentId, "2025-01-01"),
    createAssignment(studentId, "2025-02-01"),
    createAssignment(studentId, "2025-03-01"),
  ]);
  assignmentIds = [a1!, a2!, a3!];

  // Create 3 assessments sequentially (each gets a later createdAt timestamp)
  const e1 = await createAssessment(studentId);
  await new Promise((r) => setTimeout(r, 5));
  const e2 = await createAssessment(studentId);
  await new Promise((r) => setTimeout(r, 5));
  const e3 = await createAssessment(studentId);
  assessmentIds = [e1!, e2!, e3!];
});

afterAll(async () => {
  // Hard-delete all test rows (real teardown, not soft-delete)
  await Promise.all([
    ...assessmentIds.map((id) => db.delete(assessmentsTable).where(eq(assessmentsTable.id, id))),
    ...assignmentIds.map((id) => db.delete(assignmentsTable).where(eq(assignmentsTable.id, id))),
    ...studentIds.map((id) => db.delete(studentsTable).where(eq(studentsTable.id, id))),
  ]);
  await db.delete(coursesTable).where(eq(coursesTable.id, courseId));
  await cleanupHttpUser(adminUser.id);
});

// ── GET /api/students — pagination ────────────────────────────────────────────

describe("GET /api/students – cursor pagination", () => {
  it("returns paginated envelope with default limit when no params given", async () => {
    const res = await adminAgent.get("/api/students");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      items: expect.any(Array),
      pagination: {
        hasMore: expect.any(Boolean),
        limit: 50,
      },
    });
    // nextCursor is null on the last page or string on a mid-page — both are valid
    const nc = res.body.pagination.nextCursor;
    expect(nc === null || typeof nc === "string").toBe(true);
  });

  it("respects limit=1 and sets hasMore=true when more rows exist", async () => {
    const res = await adminAgent.get("/api/students?limit=1");
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.pagination.limit).toBe(1);
    expect(res.body.pagination.hasMore).toBe(true);
    expect(res.body.pagination.nextCursor).not.toBeNull();
  });

  it("can traverse all test students by following cursors (limit=1)", async () => {
    const seen = new Set<number>();
    let cursor: string | null | undefined = undefined;

    for (let page = 0; ; page++) {
      const url = cursor
        ? `/api/students?limit=1&cursor=${encodeURIComponent(cursor)}`
        : "/api/students?limit=1";
      const res = await adminAgent.get(url);
      expect(res.status).toBe(200);
      const body = res.body as { items: { id: number }[]; pagination: { nextCursor: string | null; hasMore: boolean } };

      for (const item of body.items) seen.add(item.id);

      if (!body.pagination.hasMore) break;
      cursor = body.pagination.nextCursor;
      if (page > 200) throw new Error("Infinite pagination loop detected");
    }

    // All 3 test students must appear across pages
    for (const id of studentIds) {
      expect(seen).toContain(id);
    }
  });

  it("returns consistent pagination.limit equal to requested limit", async () => {
    const res = await adminAgent.get("/api/students?limit=3");
    expect(res.status).toBe(200);
    expect(res.body.pagination.limit).toBe(3);
  });

  it("returns 400 for limit=0", async () => {
    const res = await adminAgent.get("/api/students?limit=0");
    expect(res.status).toBe(400);
  });

  it("returns 400 for limit=101 (exceeds max)", async () => {
    const res = await adminAgent.get("/api/students?limit=101");
    expect(res.status).toBe(400);
  });

  it("accepts limit=100 (max allowed)", async () => {
    const res = await adminAgent.get("/api/students?limit=100");
    expect(res.status).toBe(200);
    expect(res.body.pagination.limit).toBe(100);
  });

  it("returns empty items and no next cursor for a garbled cursor", async () => {
    const res = await adminAgent.get("/api/students?cursor=not-valid-base64url!!!");
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.pagination.hasMore).toBe(false);
    expect(res.body.pagination.nextCursor).toBeNull();
  });

  it("returns empty items for a structurally-valid but wrong-payload cursor", async () => {
    // A valid Base64URL blob that decodes to the wrong shape (missing 'name' key)
    const badPayload = Buffer.from(JSON.stringify({ x: 1 }), "utf-8").toString("base64url");
    const res = await adminAgent.get(`/api/students?cursor=${encodeURIComponent(badPayload)}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.pagination.nextCursor).toBeNull();
  });

  it("last page has hasMore=false and nextCursor=null", async () => {
    // Collect all cursors until the last page
    let cursor: string | null | undefined = undefined;
    let lastBody: { items: unknown[]; pagination: { hasMore: boolean; nextCursor: string | null } } | null = null;
    for (let page = 0; ; page++) {
      const url = cursor
        ? `/api/students?limit=1&cursor=${encodeURIComponent(cursor)}`
        : "/api/students?limit=1";
      const res = await adminAgent.get(url);
      expect(res.status).toBe(200);
      lastBody = res.body as typeof lastBody;
      if (!lastBody!.pagination.hasMore) break;
      cursor = lastBody!.pagination.nextCursor;
      if (page > 200) throw new Error("Infinite pagination loop detected");
    }
    expect(lastBody!.pagination.hasMore).toBe(false);
    expect(lastBody!.pagination.nextCursor).toBeNull();
  });

  it("items on consecutive pages do not overlap", async () => {
    const res1 = await adminAgent.get("/api/students?limit=2");
    expect(res1.status).toBe(200);
    if (!res1.body.pagination.hasMore) return; // skip if DB has ≤2 students

    const cursor = res1.body.pagination.nextCursor as string;
    const res2 = await adminAgent.get(
      `/api/students?limit=2&cursor=${encodeURIComponent(cursor)}`,
    );
    expect(res2.status).toBe(200);

    const ids1 = new Set((res1.body.items as { id: number }[]).map((s) => s.id));
    const ids2 = new Set((res2.body.items as { id: number }[]).map((s) => s.id));
    for (const id of ids2) {
      expect(ids1.has(id)).toBe(false);
    }
  });

  it("returns 401 for unauthenticated requests", async () => {
    const res = await req().get("/api/students");
    expect(res.status).toBe(401);
  });
});

// ── GET /api/assignments — pagination ─────────────────────────────────────────

describe("GET /api/assignments – cursor pagination", () => {
  it("returns paginated envelope with default limit", async () => {
    const res = await adminAgent.get("/api/assignments");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      items: expect.any(Array),
      pagination: {
        hasMore: expect.any(Boolean),
        limit: 50,
      },
    });
    const nc = res.body.pagination.nextCursor;
    expect(nc === null || typeof nc === "string").toBe(true);
  });

  it("respects limit=1 and sets hasMore=true when more assignments exist", async () => {
    const res = await adminAgent.get("/api/assignments?limit=1");
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.pagination.hasMore).toBe(true);
    expect(res.body.pagination.nextCursor).not.toBeNull();
  });

  it("can traverse all test assignments by following cursors (limit=1)", async () => {
    const seen = new Set<number>();
    let cursor: string | null | undefined = undefined;

    for (let page = 0; ; page++) {
      const url = cursor
        ? `/api/assignments?limit=1&cursor=${encodeURIComponent(cursor)}`
        : "/api/assignments?limit=1";
      const res = await adminAgent.get(url);
      expect(res.status).toBe(200);
      const body = res.body as {
        items: { id: number }[];
        pagination: { nextCursor: string | null; hasMore: boolean };
      };
      for (const item of body.items) seen.add(item.id);
      if (!body.pagination.hasMore) break;
      cursor = body.pagination.nextCursor;
      if (page > 200) throw new Error("Infinite pagination loop detected");
    }

    for (const id of assignmentIds) {
      expect(seen).toContain(id);
    }
  });

  it("returns 400 for limit=0", async () => {
    const res = await adminAgent.get("/api/assignments?limit=0");
    expect(res.status).toBe(400);
  });

  it("returns 400 for limit=101", async () => {
    const res = await adminAgent.get("/api/assignments?limit=101");
    expect(res.status).toBe(400);
  });

  it("returns empty items for a garbled cursor", async () => {
    const res = await adminAgent.get("/api/assignments?cursor=!!!invalid");
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.pagination.nextCursor).toBeNull();
  });

  it("items on consecutive pages do not overlap", async () => {
    const res1 = await adminAgent.get("/api/assignments?limit=2");
    expect(res1.status).toBe(200);
    if (!res1.body.pagination.hasMore) return;

    const cursor = res1.body.pagination.nextCursor as string;
    const res2 = await adminAgent.get(
      `/api/assignments?limit=2&cursor=${encodeURIComponent(cursor)}`,
    );
    expect(res2.status).toBe(200);

    const ids1 = new Set((res1.body.items as { id: number }[]).map((a) => a.id));
    const ids2 = new Set((res2.body.items as { id: number }[]).map((a) => a.id));
    for (const id of ids2) {
      expect(ids1.has(id)).toBe(false);
    }
  });

  it("last page has hasMore=false and nextCursor=null", async () => {
    let cursor: string | null | undefined = undefined;
    let lastBody: { pagination: { hasMore: boolean; nextCursor: string | null } } | null = null;
    for (let page = 0; ; page++) {
      const url = cursor
        ? `/api/assignments?limit=1&cursor=${encodeURIComponent(cursor)}`
        : "/api/assignments?limit=1";
      const res = await adminAgent.get(url);
      expect(res.status).toBe(200);
      lastBody = res.body as typeof lastBody;
      if (!lastBody!.pagination.hasMore) break;
      cursor = lastBody!.pagination.nextCursor;
      if (page > 200) throw new Error("Infinite pagination loop detected");
    }
    expect(lastBody!.pagination.hasMore).toBe(false);
    expect(lastBody!.pagination.nextCursor).toBeNull();
  });
});

// ── GET /api/assessments — pagination ─────────────────────────────────────────

describe("GET /api/assessments – cursor pagination", () => {
  it("returns paginated envelope with default limit", async () => {
    const res = await adminAgent.get("/api/assessments");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      items: expect.any(Array),
      pagination: {
        hasMore: expect.any(Boolean),
        limit: 50,
      },
    });
    const nc = res.body.pagination.nextCursor;
    expect(nc === null || typeof nc === "string").toBe(true);
  });

  it("respects limit=1 and sets hasMore=true when more assessments exist", async () => {
    const res = await adminAgent.get("/api/assessments?limit=1");
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.pagination.hasMore).toBe(true);
    expect(res.body.pagination.nextCursor).not.toBeNull();
  });

  it("can traverse all test assessments by following cursors (limit=1)", async () => {
    const seen = new Set<number>();
    let cursor: string | null | undefined = undefined;

    for (let page = 0; ; page++) {
      const url = cursor
        ? `/api/assessments?limit=1&cursor=${encodeURIComponent(cursor)}`
        : "/api/assessments?limit=1";
      const res = await adminAgent.get(url);
      expect(res.status).toBe(200);
      const body = res.body as {
        items: { id: number }[];
        pagination: { nextCursor: string | null; hasMore: boolean };
      };
      for (const item of body.items) seen.add(item.id);
      if (!body.pagination.hasMore) break;
      cursor = body.pagination.nextCursor;
      if (page > 200) throw new Error("Infinite pagination loop detected");
    }

    for (const id of assessmentIds) {
      expect(seen).toContain(id);
    }
  });

  it("returns 400 for limit=0", async () => {
    const res = await adminAgent.get("/api/assessments?limit=0");
    expect(res.status).toBe(400);
  });

  it("returns 400 for limit=101", async () => {
    const res = await adminAgent.get("/api/assessments?limit=101");
    expect(res.status).toBe(400);
  });

  it("returns empty items for a garbled cursor", async () => {
    const res = await adminAgent.get("/api/assessments?cursor=!!!invalid");
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.pagination.nextCursor).toBeNull();
  });

  it("items on consecutive pages do not overlap", async () => {
    const res1 = await adminAgent.get("/api/assessments?limit=2");
    expect(res1.status).toBe(200);
    if (!res1.body.pagination.hasMore) return;

    const cursor = res1.body.pagination.nextCursor as string;
    const res2 = await adminAgent.get(
      `/api/assessments?limit=2&cursor=${encodeURIComponent(cursor)}`,
    );
    expect(res2.status).toBe(200);

    const ids1 = new Set((res1.body.items as { id: number }[]).map((e) => e.id));
    const ids2 = new Set((res2.body.items as { id: number }[]).map((e) => e.id));
    for (const id of ids2) {
      expect(ids1.has(id)).toBe(false);
    }
  });

  it("last page has hasMore=false and nextCursor=null", async () => {
    let cursor: string | null | undefined = undefined;
    let lastBody: { pagination: { hasMore: boolean; nextCursor: string | null } } | null = null;
    for (let page = 0; ; page++) {
      const url = cursor
        ? `/api/assessments?limit=1&cursor=${encodeURIComponent(cursor)}`
        : "/api/assessments?limit=1";
      const res = await adminAgent.get(url);
      expect(res.status).toBe(200);
      lastBody = res.body as typeof lastBody;
      if (!lastBody!.pagination.hasMore) break;
      cursor = lastBody!.pagination.nextCursor;
      if (page > 200) throw new Error("Infinite pagination loop detected");
    }
    expect(lastBody!.pagination.hasMore).toBe(false);
    expect(lastBody!.pagination.nextCursor).toBeNull();
  });
});
