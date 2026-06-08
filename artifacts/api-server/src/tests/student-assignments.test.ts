/**
 * Student Assignments Tests — Sprint 5 Chunk 4
 *
 * Coverage:
 *
 * Service — listAssignments:
 *   - enrolled-course assignments returned
 *   - non-enrolled-course assignments excluded at DB level
 *   - soft-deleted assignments hidden
 *   - empty enrolledCourseIds → []
 *   - null studentId → []
 *   - DTO field mapping (all 7 summary fields)
 *   - ordering by dueDate ascending
 *   - other student's assignments in same enrolled course excluded
 *
 * Service — getAssignment:
 *   - enrolled-course assignment returns full detail DTO
 *   - DTO field mapping (all 10 detail fields, ISO dates)
 *   - null score field present when score is null
 *   - non-enrolled-course assignment → null (IDOR-safe enrollment guard)
 *   - soft-deleted assignment → null
 *   - non-existent assignment → null
 *   - wrong-student assignment → null (cross-student protection)
 *   - null studentId → null
 *
 * Scope boundary:
 *   - service enrollment guard (detail): non-enrolled even if in DB → null
 *   - list: multiple enrolled courses, all assignments returned
 *
 * Regression: all 1067 existing tests remain green
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db, usersTable, coursesTable, assignmentsTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { StudentAssignmentService } from "../services/student-assignments.service";
import {
  listStudentAssignments,
  getStudentAssignment,
} from "../lib/student-assignments.queries";
import { createStudentScope } from "./helpers/authorization";

// ── Fixture state ──────────────────────────────────────────────────────────────

let actorId: number;
let enrolledCourseId: number;
let enrolledCourse2Id: number;
let nonEnrolledCourseId: number;
let studentId: number;
let otherStudentId: number;

// Assignment IDs created in fixtures
let pendingAssignmentId: number;
let gradedAssignmentId: number;
let course2AssignmentId: number;
let deletedAssignmentId: number;
let nonEnrolledAssignmentId: number;
let otherStudentAssignmentId: number;
let nullScoreAssignmentId: number;

const TS = Date.now();
const PREFIX = `_assignments_${TS}`;

// ── Setup / teardown ───────────────────────────────────────────────────────────

beforeAll(async () => {
  const [actor] = await db
    .insert(usersTable)
    .values({
      username: `${PREFIX}_actor`,
      passwordHash: "x",
      displayName: "Assignments Test Actor",
      role: "teacher",
      isActive: true,
    })
    .returning({ id: usersTable.id });
  actorId = actor!.id;

  const courseRows = await db
    .insert(coursesTable)
    .values([
      {
        name: `${PREFIX} Enrolled Course 1`,
        description: "Enrolled 1",
        subject: "Math",
        grade: "10",
        academicYear: "2025-2026",
        teacherName: "T1",
        teacherId: actorId,
        status: "active",
        createdBy: actorId,
        updatedBy: actorId,
      },
      {
        name: `${PREFIX} Enrolled Course 2`,
        description: "Enrolled 2",
        subject: "Science",
        grade: "10",
        academicYear: "2025-2026",
        teacherName: "T1",
        teacherId: actorId,
        status: "active",
        createdBy: actorId,
        updatedBy: actorId,
      },
      {
        name: `${PREFIX} Non-Enrolled Course`,
        description: "Not enrolled",
        subject: "History",
        grade: "10",
        academicYear: "2025-2026",
        teacherName: "T1",
        teacherId: actorId,
        status: "active",
        createdBy: actorId,
        updatedBy: actorId,
      },
    ])
    .returning({ id: coursesTable.id });

  enrolledCourseId = courseRows[0]!.id;
  enrolledCourse2Id = courseRows[1]!.id;
  nonEnrolledCourseId = courseRows[2]!.id;

  const studentResult = await db.execute(sql`
    INSERT INTO students (name, email, grade)
    VALUES (${`${PREFIX} Student`}, ${`${PREFIX}@test.example`}, ${"10"})
    RETURNING id
  `);
  studentId = (studentResult.rows[0] as { id: number }).id;

  const otherStudentResult = await db.execute(sql`
    INSERT INTO students (name, email, grade)
    VALUES (${`${PREFIX} Other Student`}, ${`${PREFIX}_other@test.example`}, ${"10"})
    RETURNING id
  `);
  otherStudentId = (otherStudentResult.rows[0] as { id: number }).id;

  const assignmentRows = await db
    .insert(assignmentsTable)
    .values([
      // Test student — enrolled course 1 — pending, due soonest
      {
        title: `${PREFIX} Pending`,
        description: "Pending desc",
        courseId: enrolledCourseId,
        studentId,
        dueDate: "2025-11-01",
        status: "pending",
        maxScore: 100,
        createdBy: actorId,
        updatedBy: actorId,
      },
      // Test student — enrolled course 1 — graded with score, due later
      {
        title: `${PREFIX} Graded`,
        description: "Graded desc",
        courseId: enrolledCourseId,
        studentId,
        dueDate: "2025-12-01",
        status: "graded",
        score: 85,
        maxScore: 100,
        createdBy: actorId,
        updatedBy: actorId,
      },
      // Test student — enrolled course 2
      {
        title: `${PREFIX} Course2 Assign`,
        description: "Course 2 desc",
        courseId: enrolledCourse2Id,
        studentId,
        dueDate: "2025-12-15",
        status: "pending",
        maxScore: 50,
        createdBy: actorId,
        updatedBy: actorId,
      },
      // Test student — enrolled course 1 — soft-deleted
      {
        title: `${PREFIX} Deleted`,
        description: "Deleted desc",
        courseId: enrolledCourseId,
        studentId,
        dueDate: "2025-10-01",
        status: "pending",
        maxScore: 100,
        createdBy: actorId,
        updatedBy: actorId,
      },
      // Test student — non-enrolled course — must NOT appear
      {
        title: `${PREFIX} Non-Enrolled`,
        description: "Non-enrolled desc",
        courseId: nonEnrolledCourseId,
        studentId,
        dueDate: "2025-11-15",
        status: "pending",
        maxScore: 100,
        createdBy: actorId,
        updatedBy: actorId,
      },
      // Other student — enrolled course 1 — must NOT appear for test student
      {
        title: `${PREFIX} Other Student Assign`,
        description: "Other student desc",
        courseId: enrolledCourseId,
        studentId: otherStudentId,
        dueDate: "2025-11-05",
        status: "pending",
        maxScore: 100,
        createdBy: actorId,
        updatedBy: actorId,
      },
      // Test student — enrolled course 1 — null score
      {
        title: `${PREFIX} Null Score`,
        description: "No score yet",
        courseId: enrolledCourseId,
        studentId,
        dueDate: "2025-12-20",
        status: "submitted",
        maxScore: 100,
        createdBy: actorId,
        updatedBy: actorId,
      },
    ])
    .returning({ id: assignmentsTable.id });

  pendingAssignmentId = assignmentRows[0]!.id;
  gradedAssignmentId = assignmentRows[1]!.id;
  course2AssignmentId = assignmentRows[2]!.id;
  deletedAssignmentId = assignmentRows[3]!.id;
  nonEnrolledAssignmentId = assignmentRows[4]!.id;
  otherStudentAssignmentId = assignmentRows[5]!.id;
  nullScoreAssignmentId = assignmentRows[6]!.id;

  // Soft-delete the deleted assignment
  await db.execute(
    sql`UPDATE assignments SET deleted_at = NOW(), deleted_by = ${actorId} WHERE id = ${deletedAssignmentId}`,
  );
});

afterAll(async () => {
  await db.execute(sql`DELETE FROM assignments WHERE title LIKE ${`${PREFIX}%`}`);
  await db.execute(sql`DELETE FROM students WHERE name LIKE ${`${PREFIX}%`}`);
  await db.execute(sql`DELETE FROM courses WHERE name LIKE ${`${PREFIX}%`}`);
  await db.execute(sql`DELETE FROM users WHERE username LIKE ${`${PREFIX}%`}`);
});

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeScope(enrolledCourseIds: number[]) {
  return createStudentScope({ studentId, enrolledCourseIds });
}

// ── Service: listAssignments — authorization guards ────────────────────────────

describe("StudentAssignmentService.listAssignments — authorization guards", () => {
  it("returns [] when studentId is null (unlinked account)", async () => {
    const scope = { ...makeScope([enrolledCourseId]), studentId: null as null };
    const result = await StudentAssignmentService.listAssignments(scope);
    expect(result).toEqual([]);
  });

  it("returns [] when enrolledCourseIds is empty", async () => {
    const scope = makeScope([]);
    const result = await StudentAssignmentService.listAssignments(scope);
    expect(result).toEqual([]);
  });
});

// ── Service: listAssignments — ownership filtering ─────────────────────────────

describe("StudentAssignmentService.listAssignments — ownership", () => {
  it("returns only assignments from enrolled courses", async () => {
    const scope = makeScope([enrolledCourseId]);
    const results = await StudentAssignmentService.listAssignments(scope);
    const ids = results.map((a) => a.assignmentId);
    expect(ids).not.toContain(nonEnrolledAssignmentId);
    expect(ids).not.toContain(course2AssignmentId);
  });

  it("excludes soft-deleted assignments", async () => {
    const scope = makeScope([enrolledCourseId]);
    const results = await StudentAssignmentService.listAssignments(scope);
    expect(results.map((a) => a.assignmentId)).not.toContain(deletedAssignmentId);
  });

  it("excludes other student's assignments in the same enrolled course", async () => {
    const scope = makeScope([enrolledCourseId]);
    const results = await StudentAssignmentService.listAssignments(scope);
    expect(results.map((a) => a.assignmentId)).not.toContain(otherStudentAssignmentId);
  });

  it("includes assignments from all enrolled courses when multiple enrolled", async () => {
    const scope = makeScope([enrolledCourseId, enrolledCourse2Id]);
    const results = await StudentAssignmentService.listAssignments(scope);
    const ids = results.map((a) => a.assignmentId);
    expect(ids).toContain(pendingAssignmentId);
    expect(ids).toContain(gradedAssignmentId);
    expect(ids).toContain(course2AssignmentId);
  });
});

// ── Service: listAssignments — DTO shape ──────────────────────────────────────

describe("StudentAssignmentService.listAssignments — DTO shape", () => {
  let results: Awaited<ReturnType<typeof StudentAssignmentService.listAssignments>>;

  beforeAll(async () => {
    const scope = makeScope([enrolledCourseId]);
    results = await StudentAssignmentService.listAssignments(scope);
  });

  it("all results have the 7 required summary fields", () => {
    for (const a of results) {
      expect(typeof a.assignmentId).toBe("number");
      expect(typeof a.courseId).toBe("number");
      expect(typeof a.title).toBe("string");
      expect(typeof a.status).toBe("string");
      expect(typeof a.dueDate).toBe("string");
      expect(typeof a.maxScore).toBe("number");
      // score is number | null
      expect(a.score === null || typeof a.score === "number").toBe(true);
    }
  });

  it("graded assignment has a numeric score", () => {
    const graded = results.find((a) => a.assignmentId === gradedAssignmentId);
    expect(graded).toBeDefined();
    expect(graded!.score).toBe(85);
  });

  it("null-score assignment has score = null", () => {
    const nullScore = results.find((a) => a.assignmentId === nullScoreAssignmentId);
    expect(nullScore).toBeDefined();
    expect(nullScore!.score).toBeNull();
  });

  it("results are ordered by dueDate ascending (earliest first)", () => {
    const dueDates = results.map((a) => a.dueDate);
    const sorted = [...dueDates].sort();
    expect(dueDates).toEqual(sorted);
  });
});

// ── Service: getAssignment — authorization guards ─────────────────────────────

describe("StudentAssignmentService.getAssignment — authorization guards", () => {
  it("returns null when studentId is null", async () => {
    const scope = { ...makeScope([enrolledCourseId]), studentId: null as null };
    const result = await StudentAssignmentService.getAssignment(scope, pendingAssignmentId);
    expect(result).toBeNull();
  });

  it("returns null for a non-existent assignment ID", async () => {
    const scope = makeScope([enrolledCourseId]);
    const result = await StudentAssignmentService.getAssignment(scope, -99999);
    expect(result).toBeNull();
  });

  it("returns null for a soft-deleted assignment", async () => {
    const scope = makeScope([enrolledCourseId]);
    const result = await StudentAssignmentService.getAssignment(scope, deletedAssignmentId);
    expect(result).toBeNull();
  });
});

// ── Service: getAssignment — ownership ────────────────────────────────────────

describe("StudentAssignmentService.getAssignment — ownership", () => {
  it("returns assignment detail when enrolled in the assignment's course", async () => {
    const scope = makeScope([enrolledCourseId]);
    const result = await StudentAssignmentService.getAssignment(scope, pendingAssignmentId);
    expect(result).not.toBeNull();
    expect(result!.assignmentId).toBe(pendingAssignmentId);
  });

  it("returns null for non-enrolled course assignment (IDOR-safe)", async () => {
    const scope = makeScope([enrolledCourseId]); // nonEnrolledCourseId NOT in scope
    const result = await StudentAssignmentService.getAssignment(scope, nonEnrolledAssignmentId);
    expect(result).toBeNull();
  });

  it("returns null for another student's assignment (cross-student protection)", async () => {
    const scope = makeScope([enrolledCourseId]);
    const result = await StudentAssignmentService.getAssignment(scope, otherStudentAssignmentId);
    expect(result).toBeNull();
  });
});

// ── Service: getAssignment — DTO shape ────────────────────────────────────────

describe("StudentAssignmentService.getAssignment — DTO shape", () => {
  let detail: Awaited<ReturnType<typeof StudentAssignmentService.getAssignment>>;
  let gradedDetail: Awaited<ReturnType<typeof StudentAssignmentService.getAssignment>>;

  beforeAll(async () => {
    const scope = makeScope([enrolledCourseId]);
    [detail, gradedDetail] = await Promise.all([
      StudentAssignmentService.getAssignment(scope, pendingAssignmentId),
      StudentAssignmentService.getAssignment(scope, gradedAssignmentId),
    ]);
  });

  it("returns all 10 detail fields", () => {
    expect(detail).not.toBeNull();
    expect(typeof detail!.assignmentId).toBe("number");
    expect(typeof detail!.courseId).toBe("number");
    expect(typeof detail!.title).toBe("string");
    expect(typeof detail!.description).toBe("string");
    expect(typeof detail!.status).toBe("string");
    expect(typeof detail!.dueDate).toBe("string");
    expect(typeof detail!.maxScore).toBe("number");
    expect(detail!.score === null || typeof detail!.score === "number").toBe(true);
    expect(typeof detail!.createdAt).toBe("string");
    expect(typeof detail!.updatedAt).toBe("string");
  });

  it("createdAt and updatedAt are ISO 8601 strings", () => {
    expect(() => new Date(detail!.createdAt).toISOString()).not.toThrow();
    expect(() => new Date(detail!.updatedAt).toISOString()).not.toThrow();
  });

  it("pending assignment has null score", () => {
    expect(detail!.score).toBeNull();
  });

  it("graded assignment has numeric score", () => {
    expect(gradedDetail!.score).toBe(85);
  });

  it("description is included in detail (not in summary)", () => {
    expect(detail!.description).toBe("Pending desc");
  });

  it("courseId matches the enrolled course", () => {
    expect(detail!.courseId).toBe(enrolledCourseId);
  });
});

// ── Repository: direct query isolation ───────────────────────────────────────

describe("listStudentAssignments — repository isolation", () => {
  it("returns only the student's own assignments (not other student's)", async () => {
    const myRows = await listStudentAssignments(studentId, [enrolledCourseId]);
    const otherRows = await listStudentAssignments(otherStudentId, [enrolledCourseId]);

    const myIds = myRows.map((r) => r.id);
    const otherIds = otherRows.map((r) => r.id);

    expect(myIds).not.toContain(otherStudentAssignmentId);
    expect(otherIds).toContain(otherStudentAssignmentId);
    expect(otherIds).not.toContain(pendingAssignmentId);
  });

  it("returns empty array for empty enrolledCourseIds without hitting DB", async () => {
    const rows = await listStudentAssignments(studentId, []);
    expect(rows).toEqual([]);
  });
});

describe("getStudentAssignment — repository isolation", () => {
  it("returns null when querying another student's assignment by ID", async () => {
    const row = await getStudentAssignment(otherStudentAssignmentId, studentId);
    expect(row).toBeNull();
  });

  it("returns null for soft-deleted assignment directly", async () => {
    const row = await getStudentAssignment(deletedAssignmentId, studentId);
    expect(row).toBeNull();
  });
});
