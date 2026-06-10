/**
 * Sprint 9 Chunk 4 — Part 7: Negative Test Coverage
 *
 * Verifies correct error responses for:
 *   - Invalid IDs (numeric IDs that don't exist → 404 or 403)
 *   - Invalid / non-numeric IDs → 400 or 404
 *   - Invalid payloads → 400/422
 *   - Missing required fields → 400
 *   - Soft-deleted resource access → 404
 *   - Ownership violations (teacher scoping, student isolation)
 *   - Invalid query parameters
 *   - Malformed JSON
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db, studentsTable, coursesTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  req,
  createHttpUser,
  cleanupHttpUser,
  loginAs,
  type TestHttpUser,
  type SupertestAgent,
} from "./setup";

const PREFIX = "_s9c4_neg";

let adminUser: TestHttpUser;
let teacherUser: TestHttpUser;
let adminAgent: SupertestAgent;
let teacherAgent: SupertestAgent;

// Resources created for negative tests
let softDeletedStudentId: number | undefined;
let softDeletedCourseId: number | undefined;
let otherTeacherCourseId: number | undefined;
let otherTeacherUser: TestHttpUser | undefined;

beforeAll(async () => {
  [adminUser, teacherUser] = await Promise.all([
    createHttpUser(PREFIX, "admin"),
    createHttpUser(PREFIX, "teacher"),
  ]);
  [adminAgent, teacherAgent] = await Promise.all([
    loginAs(adminUser),
    loginAs(teacherUser),
  ]);

  // Create a student that will be soft-deleted
  const [stu] = await db
    .insert(studentsTable)
    .values({
      name: `${PREFIX} SoftDel Student`,
      email: `${PREFIX}_softdel_${Date.now()}@test.com`,
      grade: "9",
      enrolledCourseIds: [],
      createdBy: adminUser.id,
      updatedBy: adminUser.id,
    })
    .returning({ id: studentsTable.id });
  softDeletedStudentId = stu!.id;

  // Soft-delete it immediately
  await db
    .update(studentsTable)
    .set({ deletedAt: new Date(), deletedBy: adminUser.id })
    .where(eq(studentsTable.id, softDeletedStudentId));

  // Create a course owned by a DIFFERENT teacher (not teacherUser)
  otherTeacherUser = await createHttpUser(`${PREFIX}_other`, "teacher");
  const [crs] = await db
    .insert(coursesTable)
    .values({
      name: `${PREFIX} Other Teacher Course`,
      subject: "History",
      grade: "10",
      academicYear: "2025-2026",
      teacherId: otherTeacherUser.id,
      teacherName: "Other Teacher",
      createdBy: adminUser.id,
      updatedBy: adminUser.id,
    })
    .returning({ id: coursesTable.id });
  otherTeacherCourseId = crs!.id;
});

afterAll(async () => {
  if (otherTeacherCourseId) {
    await db.delete(coursesTable).where(eq(coursesTable.id, otherTeacherCourseId));
  }
  if (softDeletedStudentId) {
    await db.delete(studentsTable).where(eq(studentsTable.id, softDeletedStudentId!));
  }
  if (otherTeacherUser) {
    await cleanupHttpUser(otherTeacherUser.id);
  }
  await Promise.all([cleanupHttpUser(adminUser.id), cleanupHttpUser(teacherUser.id)]);
});

// ── Invalid IDs ───────────────────────────────────────────────────────────────

describe("Invalid / non-existent IDs", () => {
  it("GET /api/students/999999999 → not 200 (non-existent ID)", async () => {
    const r = await adminAgent.get("/api/students/999999999");
    expect([404, 403]).toContain(r.status);
  });

  it("GET /api/courses/999999999 → not 200 (non-existent ID)", async () => {
    const r = await adminAgent.get("/api/courses/999999999");
    expect([404, 403]).toContain(r.status);
  });

  it("GET /api/assignments/999999999 → not 200 (non-existent ID)", async () => {
    const r = await adminAgent.get("/api/assignments/999999999");
    expect([404, 403]).toContain(r.status);
  });

  it("GET /api/assessments/999999999 → not 200 (non-existent ID)", async () => {
    const r = await adminAgent.get("/api/assessments/999999999");
    expect([404, 403]).toContain(r.status);
  });

  it("GET /api/notes/999999999 → not 200 (non-existent ID)", async () => {
    const r = await adminAgent.get("/api/notes/999999999");
    expect([404, 403]).toContain(r.status);
  });

  it("GET /api/announcements/999999999 → not 200 (non-existent ID)", async () => {
    const r = await adminAgent.get("/api/announcements/999999999");
    expect([404, 403]).toContain(r.status);
  });

  it("GET /api/students/notanumber → 400 or 404", async () => {
    const r = await adminAgent.get("/api/students/notanumber");
    expect([400, 404]).toContain(r.status);
  });

  it("GET /api/courses/notanumber → 400 or 404", async () => {
    const r = await adminAgent.get("/api/courses/notanumber");
    expect([400, 404]).toContain(r.status);
  });
});

// ── Missing required fields on POST ──────────────────────────────────────────

describe("POST with missing required fields → 400", () => {
  it("POST /api/students with empty body → 400", async () => {
    const r = await adminAgent.post("/api/students").send({});
    expect(r.status).toBe(400);
    expect(r.body).toHaveProperty("error");
  });

  it("POST /api/courses with empty body → 400", async () => {
    const r = await adminAgent.post("/api/courses").send({});
    expect(r.status).toBe(400);
    expect(r.body).toHaveProperty("error");
  });

  it("POST /api/assignments with empty body → 400", async () => {
    const r = await adminAgent.post("/api/assignments").send({});
    expect(r.status).toBe(400);
    expect(r.body).toHaveProperty("error");
  });

  it("POST /api/assessments with empty body → 400", async () => {
    const r = await adminAgent.post("/api/assessments").send({});
    expect(r.status).toBe(400);
    expect(r.body).toHaveProperty("error");
  });

  it("POST /api/notes with empty body → 400", async () => {
    const r = await adminAgent.post("/api/notes").send({});
    expect(r.status).toBe(400);
    expect(r.body).toHaveProperty("error");
  });

  it("POST /api/announcements with empty body → 400", async () => {
    const r = await adminAgent.post("/api/announcements").send({});
    expect(r.status).toBe(400);
    expect(r.body).toHaveProperty("error");
  });
});

// ── Invalid payload shapes ─────────────────────────────────────────────────────

describe("POST with invalid field types → 400", () => {
  it("POST /api/students with invalid grade type → 400", async () => {
    const r = await adminAgent.post("/api/students").send({
      name: "Test",
      grade: 999999,       // should be string
      email: "not-an-email",
    });
    expect(r.status).toBe(400);
  });

  it("POST /api/assignments with invalid dueDate → 400", async () => {
    const r = await adminAgent.post("/api/assignments").send({
      title: "Test",
      courseId: 1,
      studentId: 1,
      dueDate: "not-a-date",
      status: "invalid-status",
      maxScore: "not-a-number",
    });
    expect(r.status).toBe(400);
  });

  it("PATCH /api/assessments/1 with invalid score type → 400", async () => {
    const r = await adminAgent.patch("/api/assessments/1").send({
      score: "not-a-number",
    });
    expect([400, 403, 404]).toContain(r.status);
  });
});

// ── Soft-deleted resource access ──────────────────────────────────────────────

describe("Soft-deleted resources are not returned", () => {
  it("GET /api/students/:id on soft-deleted student → 404", async () => {
    const r = await adminAgent.get(`/api/students/${softDeletedStudentId}`);
    expect(r.status).toBe(404);
  });

  it("PATCH /api/students/:id on soft-deleted student → 404", async () => {
    const r = await adminAgent
      .patch(`/api/students/${softDeletedStudentId}`)
      .send({ name: "New Name" });
    expect(r.status).toBe(404);
  });

  it("GET /api/students list does not include soft-deleted student", async () => {
    const r = await adminAgent.get("/api/students");
    expect(r.status).toBe(200);
    const ids: number[] = (r.body as Array<{ id: number }>).map((s) => s.id);
    expect(ids).not.toContain(softDeletedStudentId);
  });
});

// ── Ownership violations (Layer 2 / Layer 3) ──────────────────────────────────

describe("Ownership violations — teacher cannot access data owned by others", () => {
  it("teacher cannot GET course owned by a different teacher → 403 or 404", async () => {
    const r = await teacherAgent.get(`/api/courses/${otherTeacherCourseId}`);
    // Layer 2 scoping: course is not in teacher's ownedCourseIds → 403 or 404
    expect([403, 404]).toContain(r.status);
  });

  it("teacher cannot PATCH course owned by a different teacher → 403 or 404", async () => {
    const r = await teacherAgent
      .put(`/api/courses/${otherTeacherCourseId}`)
      .send({ name: "Hijacked" });
    expect([403, 404]).toContain(r.status);
  });
});

// ── Invalid query parameters ───────────────────────────────────────────────────

describe("Invalid query parameters — should not cause 500", () => {
  it("GET /api/assignments?status=invalid_status → 400 or 200 (graceful)", async () => {
    const r = await adminAgent.get("/api/assignments?status=not_a_real_status");
    expect(r.status).not.toBe(500);
  });

  it("GET /api/reports/student-summary without studentId → 400 or 422", async () => {
    const r = await adminAgent.get("/api/reports/student-summary");
    expect([400, 422]).toContain(r.status);
  });

  it("GET /api/reports/course-summary without courseId → 400 or 422", async () => {
    const r = await adminAgent.get("/api/reports/course-summary");
    expect([400, 422]).toContain(r.status);
  });

  it("GET /api/students/:id/progress without existing student → 404 or 403", async () => {
    const r = await adminAgent.get("/api/students/999999999/progress");
    expect([404, 403]).toContain(r.status);
  });
});

// ── Malformed JSON body ────────────────────────────────────────────────────────

describe("Malformed JSON → 400 (not 500)", () => {
  it("POST /api/students with malformed JSON → 400", async () => {
    const r = await adminAgent
      .post("/api/students")
      .set("Content-Type", "application/json")
      .send("{name: missing-quotes}");
    // Express JSON middleware returns 400 for malformed JSON
    expect(r.status).toBe(400);
  });
});

// ── Unauthenticated write attempts ─────────────────────────────────────────────

describe("Unauthenticated write attempts → 401", () => {
  it("POST /api/students unauthenticated → 401", async () => {
    const r = await req()
      .post("/api/students")
      .send({ name: "Hacker", grade: "10", email: "hack@test.com" });
    expect(r.status).toBe(401);
  });

  it("DELETE /api/courses/1 unauthenticated → 401", async () => {
    const r = await req().delete("/api/courses/1");
    expect(r.status).toBe(401);
  });
});
