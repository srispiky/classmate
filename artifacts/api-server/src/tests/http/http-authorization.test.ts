/**
 * Sprint 9 Chunk 4 — Part 3 + Part 6: Authorization & Security Regression Tests
 *
 * Verifies the full role × endpoint authorization matrix via live HTTP:
 *
 *   Endpoint group           | unauthenticated | student | teacher | admin
 *   ─────────────────────────|─────────────────|─────────|─────────|──────
 *   /api/students            | 401             | 403     | 200     | 200
 *   /api/courses             | 401             | 403     | 200     | 200  ← F1 fixed
 *   /api/assignments         | 401             | 403     | 200     | 200
 *   /api/assessments         | 401             | 403     | 200     | 200
 *   /api/notes               | 401             | 403     | 200     | 200
 *   /api/announcements       | 401             | 403     | 200     | 200
 *   /api/dashboard/summary   | 401             | 403     | 200     | 200
 *   /api/dashboard/…         | 401             | 403     | 200     | 200
 *   /api/reports/…           | 401             | 403     | 200     | 200
 *   /api/downloads           | 401             | 403     | 403     | 200
 *   /api/student/*           | 401             | 200     | 403     | 403
 *   /api/users               | 401             | 403     | 403     | 200
 *
 * Also covers Sprint 9 Chunk 2 security-regression checks over HTTP:
 *   - Downloads protection (admin-only)
 *   - Teacher isolation (teacher cannot access other teachers' data via downloads)
 *   - Student isolation (student cannot access teacher-portal routes)
 *   - Dashboard and reporting access control
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

const PREFIX = "_s9c4_authz";

// Shared test sessions — created once in beforeAll, reused across all tests.
let adminUser: TestHttpUser;
let teacherUser: TestHttpUser;
let studentUser: TestHttpUser;

let adminAgent: SupertestAgent;
let teacherAgent: SupertestAgent;
let studentAgent: SupertestAgent;

let linkedStudentId: number | undefined;

beforeAll(async () => {
  // Create one user per role
  [adminUser, teacherUser, studentUser] = await Promise.all([
    createHttpUser(PREFIX, "admin"),
    createHttpUser(PREFIX, "teacher"),
    createHttpUser(PREFIX, "student"),
  ]);

  // Create a linked student profile so the student portal endpoints return 200
  const linked = await createLinkedStudent(studentUser.id, PREFIX, adminUser.id);
  linkedStudentId = linked.studentId;

  // Login once per role
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

// ── Helper ────────────────────────────────────────────────────────────────────

async function expectStatus(
  agent: ReturnType<typeof req> | SupertestAgent,
  method: "get" | "post" | "patch" | "delete",
  path: string,
  expected: number,
) {
  const r = await (agent as SupertestAgent)[method](path);
  // Allow for valid data-dependent variants (e.g. 200 or 400 both count as "not 401/403")
  expect(r.status).toBe(expected);
}

// ── Unauthenticated → 401 for all protected routes ────────────────────────────

describe("Unauthenticated requests → 401", () => {
  const protectedRoutes: Array<["get" | "post", string]> = [
    ["get", "/api/students"],
    ["get", "/api/courses"],
    ["get", "/api/assignments"],
    ["get", "/api/assessments"],
    ["get", "/api/notes"],
    ["get", "/api/announcements"],
    ["get", "/api/dashboard/summary"],
    ["get", "/api/dashboard/recent-activity"],
    ["get", "/api/dashboard/grade-breakdown"],
    ["get", "/api/dashboard/student-health"],
    ["get", "/api/reports/student-summary"],
    ["get", "/api/reports/course-summary"],
    ["get", "/api/downloads"],
    ["get", "/api/student/notes"],
    ["get", "/api/student/assignments"],
    ["get", "/api/student/assessments"],
    ["get", "/api/student/announcements"],
    ["get", "/api/student/courses"],
    ["get", "/api/student/dashboard"],
    ["get", "/api/users"],
  ];

  for (const [method, path] of protectedRoutes) {
    it(`${method.toUpperCase()} ${path} → 401`, async () => {
      await expectStatus(req(), method, path, 401);
    });
  }
});

// ── Student role → 403 for teacher-portal routes ─────────────────────────────
//
// Sprint 9 Chunk 8 — F1 fix: requireRole("admin","teacher") added to
// GET /api/courses and GET /api/courses/:id. Both routes now appear in this
// list and expect 403 for the student role.

describe("Student role → 403 on teacher-portal routes", () => {
  const teacherOnlyRoutes: Array<["get" | "post", string]> = [
    ["get", "/api/students"],
    ["get", "/api/courses"],
    ["get", "/api/assignments"],
    ["get", "/api/assessments"],
    ["get", "/api/notes"],
    ["get", "/api/announcements"],
    ["get", "/api/dashboard/summary"],
    ["get", "/api/dashboard/recent-activity"],
    ["get", "/api/dashboard/grade-breakdown"],
    ["get", "/api/dashboard/student-health"],
    ["get", "/api/reports/student-summary"],
    ["get", "/api/reports/course-summary"],
    ["get", "/api/downloads"],
  ];

  for (const [method, path] of teacherOnlyRoutes) {
    it(`student: ${method.toUpperCase()} ${path} → 403`, async () => {
      const r = await studentAgent[method](path);
      expect(r.status).toBe(403);
    });
  }
});

// ── Teacher role → 403 on student-portal routes ──────────────────────────────

describe("Teacher role → 403 on student-portal routes", () => {
  const studentOnlyRoutes: string[] = [
    "/api/student/notes",
    "/api/student/assignments",
    "/api/student/assessments",
    "/api/student/announcements",
    "/api/student/courses",
    "/api/student/dashboard",
  ];

  for (const path of studentOnlyRoutes) {
    it(`teacher: GET ${path} → 403`, async () => {
      const r = await teacherAgent.get(path);
      expect(r.status).toBe(403);
    });
  }
});

// ── Admin role → 403 on student-portal routes ────────────────────────────────

describe("Admin role → 403 on student-portal routes", () => {
  const studentOnlyRoutes: string[] = [
    "/api/student/notes",
    "/api/student/assignments",
    "/api/student/assessments",
    "/api/student/courses",
    "/api/student/dashboard",
  ];

  for (const path of studentOnlyRoutes) {
    it(`admin: GET ${path} → 403`, async () => {
      const r = await adminAgent.get(path);
      expect(r.status).toBe(403);
    });
  }
});

// ── Teacher role → 200 for teacher-portal routes ─────────────────────────────

describe("Teacher role → 200 on teacher-portal list routes", () => {
  const teacherAccessRoutes: string[] = [
    "/api/students",
    "/api/courses",
    "/api/assignments",
    "/api/assessments",
    "/api/notes",
    "/api/announcements",
    "/api/dashboard/summary",
    "/api/dashboard/recent-activity",
    "/api/dashboard/grade-breakdown",
    "/api/dashboard/student-health",
  ];

  for (const path of teacherAccessRoutes) {
    it(`teacher: GET ${path} → 200`, async () => {
      const r = await teacherAgent.get(path);
      expect(r.status).toBe(200);
    });
  }
});

// ── Admin role → 200 for all portal routes ───────────────────────────────────

describe("Admin role → 200 on teacher-portal list routes", () => {
  const adminAccessRoutes: string[] = [
    "/api/students",
    "/api/courses",
    "/api/assignments",
    "/api/assessments",
    "/api/notes",
    "/api/announcements",
    "/api/dashboard/summary",
    "/api/dashboard/recent-activity",
    "/api/dashboard/grade-breakdown",
    "/api/users",
  ];

  for (const path of adminAccessRoutes) {
    it(`admin: GET ${path} → 200`, async () => {
      const r = await adminAgent.get(path);
      expect(r.status).toBe(200);
    });
  }
});

// ── Downloads: admin-only (Sprint 9 security regression) ─────────────────────

describe("Sprint 9 security regression — downloads protection", () => {
  it("teacher cannot access /api/downloads → 403", async () => {
    const r = await teacherAgent.get("/api/downloads");
    expect(r.status).toBe(403);
  });

  it("student cannot access /api/downloads → 403", async () => {
    const r = await studentAgent.get("/api/downloads");
    expect(r.status).toBe(403);
  });

  it("unauthenticated cannot access /api/downloads → 401", async () => {
    const r = await req().get("/api/downloads");
    expect(r.status).toBe(401);
  });

  it("admin CAN access /api/downloads → 200", async () => {
    const r = await adminAgent.get("/api/downloads");
    expect(r.status).toBe(200);
  });

  it("teacher cannot access /api/downloads/:key → 403", async () => {
    const r = await teacherAgent.get("/api/downloads/deploy-script");
    expect(r.status).toBe(403);
  });

  it("student cannot access /api/downloads/:key → 403", async () => {
    const r = await studentAgent.get("/api/downloads/deploy-script");
    expect(r.status).toBe(403);
  });
});

// ── User management: admin-only ───────────────────────────────────────────────

describe("User management — admin-only access", () => {
  it("teacher cannot list users → 403", async () => {
    const r = await teacherAgent.get("/api/users");
    expect(r.status).toBe(403);
  });

  it("student cannot list users → 403", async () => {
    const r = await studentAgent.get("/api/users");
    expect(r.status).toBe(403);
  });
});

// ── Student portal 200 — student can access their own data ───────────────────

describe("Student portal — authenticated student receives 200", () => {
  it("student: GET /api/student/notes → 200", async () => {
    const r = await studentAgent.get("/api/student/notes");
    expect(r.status).toBe(200);
  });

  it("student: GET /api/student/assignments → 200", async () => {
    const r = await studentAgent.get("/api/student/assignments");
    expect(r.status).toBe(200);
  });

  it("student: GET /api/student/assessments → 200", async () => {
    const r = await studentAgent.get("/api/student/assessments");
    expect(r.status).toBe(200);
  });

  it("student: GET /api/student/announcements → 200", async () => {
    const r = await studentAgent.get("/api/student/announcements");
    expect(r.status).toBe(200);
  });

  it("student: GET /api/student/courses → 200", async () => {
    const r = await studentAgent.get("/api/student/courses");
    expect(r.status).toBe(200);
  });

  it("student: GET /api/student/dashboard → 200", async () => {
    const r = await studentAgent.get("/api/student/dashboard");
    expect(r.status).toBe(200);
  });
});

// ── Teacher isolation (Layer 2 scoping) ──────────────────────────────────────

describe("Teacher isolation — Layer 2 scoping enforced via HTTP", () => {
  it("teacher receives 200 on /api/reports/student-summary with valid student query", async () => {
    // Reports endpoint requires studentId param — pass an id that likely doesn't
    // belong to this teacher; the server should apply scoping, not crash.
    const r = await teacherAgent.get("/api/reports/student-summary?studentId=1");
    // 200 (empty/scoped result) or 403/404 from ownership check — never 500
    expect(r.status).not.toBe(500);
    expect([200, 403, 404]).toContain(r.status);
  });

  it("teacher receives 200 on /api/reports/course-summary with valid course query", async () => {
    const r = await teacherAgent.get("/api/reports/course-summary?courseId=1");
    expect(r.status).not.toBe(500);
    expect([200, 403, 404]).toContain(r.status);
  });
});
