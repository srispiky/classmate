/**
 * Sprint 9 Chunk 8 — RC1 Blocker F1 Fix: Course Route Layer 1 Security
 *
 * Verifies that GET /api/courses and GET /api/courses/:id are now protected by
 * requireRole("admin", "teacher") at Layer 1, resolving Finding F1 from the RC1 audit.
 *
 * Before this fix: any authenticated user (student, parent, guest) could call
 * these teacher-facing endpoints. Layer 2/3 scoped the data correctly, but there
 * was no explicit role gate at Layer 1.
 *
 * After this fix:
 *   Role            | GET /api/courses | GET /api/courses/:id
 *   ─────────────── | ─────────────── | ────────────────────
 *   unauthenticated | 401             | 401
 *   student         | 403             | 403
 *   teacher         | 200             | 200 or 404
 *   admin           | 200             | 200 or 404
 *
 * Students continue to access course data via /api/student/courses (requireRole("student")).
 * This file exclusively tests the Layer 1 gate on the teacher-portal course routes.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  req,
  createHttpUser,
  cleanupHttpUser,
  loginAs,
  createLinkedStudent,
  cleanupLinkedStudent,
  type TestHttpUser,
  type SupertestAgent,
} from "./setup";

const PREFIX = "_s9c8_course_l1";

let adminUser: TestHttpUser;
let teacherUser: TestHttpUser;
let studentUser: TestHttpUser;

let adminAgent: SupertestAgent;
let teacherAgent: SupertestAgent;
let studentAgent: SupertestAgent;

let linkedStudentId: number | undefined;

beforeAll(async () => {
  [adminUser, teacherUser, studentUser] = await Promise.all([
    createHttpUser(PREFIX, "admin"),
    createHttpUser(PREFIX, "teacher"),
    createHttpUser(PREFIX, "student"),
  ]);

  const linked = await createLinkedStudent(studentUser.id, PREFIX, adminUser.id);
  linkedStudentId = linked.studentId;

  [adminAgent, teacherAgent, studentAgent] = await Promise.all([
    loginAs(adminUser),
    loginAs(teacherUser),
    loginAs(studentUser),
  ]);
});

afterAll(async () => {
  if (linkedStudentId !== undefined) {
    await cleanupLinkedStudent(linkedStudentId);
  }
  await Promise.all([
    cleanupHttpUser(adminUser.id),
    cleanupHttpUser(teacherUser.id),
    cleanupHttpUser(studentUser.id),
  ]);
});

// ── GET /api/courses — Layer 1 gate ──────────────────────────────────────────

describe("F1 fix — GET /api/courses — Layer 1 requireRole('admin','teacher')", () => {
  it("unauthenticated → 401 (requireAuth gate)", async () => {
    const r = await req().get("/api/courses");
    expect(r.status).toBe(401);
  });

  it("student → 403 (Layer 1: role not in ['admin','teacher'])", async () => {
    const r = await studentAgent.get("/api/courses");
    expect(r.status).toBe(403);
  });

  it("teacher → 200 (Layer 1 passes, Layer 2 scopes to owned courses)", async () => {
    const r = await teacherAgent.get("/api/courses");
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
  });

  it("admin → 200 (Layer 1 passes, admin sees all courses)", async () => {
    const r = await adminAgent.get("/api/courses");
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
  });
});

// ── GET /api/courses/:id — Layer 1 gate ──────────────────────────────────────

describe("F1 fix — GET /api/courses/:id — Layer 1 requireRole('admin','teacher')", () => {
  const NON_EXISTENT_ID = "999999999";

  it("unauthenticated → 401 (requireAuth gate)", async () => {
    const r = await req().get(`/api/courses/${NON_EXISTENT_ID}`);
    expect(r.status).toBe(401);
  });

  it("student → 403 (Layer 1: role not in ['admin','teacher'])", async () => {
    const r = await studentAgent.get(`/api/courses/${NON_EXISTENT_ID}`);
    expect(r.status).toBe(403);
  });

  it("teacher → 404 for non-existent id (Layer 1 passes, course not found)", async () => {
    const r = await teacherAgent.get(`/api/courses/${NON_EXISTENT_ID}`);
    // Layer 1 passes → route handler runs → course not found → 404
    expect(r.status).toBe(404);
  });

  it("admin → 404 for non-existent id (Layer 1 passes, course not found)", async () => {
    const r = await adminAgent.get(`/api/courses/${NON_EXISTENT_ID}`);
    expect(r.status).toBe(404);
  });
});

// ── Student portal unaffected — /api/student/courses still returns 200 ────────

describe("F1 fix — student portal course routes unaffected", () => {
  it("student: GET /api/student/courses → 200 (student portal route unchanged)", async () => {
    const r = await studentAgent.get("/api/student/courses");
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
  });

  it("student: GET /api/student/courses/999999999 → 404 (student portal route unchanged)", async () => {
    const r = await studentAgent.get("/api/student/courses/999999999");
    expect(r.status).toBe(404);
  });

  it("teacher: GET /api/student/courses → 403 (student portal still teacher-blocked)", async () => {
    const r = await teacherAgent.get("/api/student/courses");
    expect(r.status).toBe(403);
  });
});
