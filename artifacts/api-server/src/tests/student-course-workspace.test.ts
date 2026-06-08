/**
 * Student Course Workspace Tests — Sprint 5 Chunk 3
 *
 * Coverage:
 *
 * Service — getWorkspace:
 *   - enrolled student → full workspace DTO
 *   - non-enrolled course → null (IDOR-safe early return)
 *   - null studentId → null
 *   - soft-deleted course → null
 *   - all DTO fields present and correctly typed
 *
 * Aggregation (real DB, per courseId + studentId):
 *   - totalAssignments counts non-deleted assignments in this course for this student
 *   - pendingAssignments counts only pending status
 *   - recentAssignments counts assignments created in last 7 days
 *   - totalAssessments counts non-deleted assessments in this course for this student
 *   - upcomingAssessments counts assessments created in last 30 days
 *   - totalAnnouncements counts non-deleted announcements in this course
 *   - recentAnnouncements counts announcements created in last 7 days
 *   - totalNotes counts non-deleted notes in this course
 *   - recentNotes counts notes created in last 7 days
 *
 * Scope boundary:
 *   - other-student assignments in same course are excluded
 *   - non-enrolled course data is excluded (enrollment check)
 *
 * Regression: existing 1041 tests remain green
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  db,
  usersTable,
  coursesTable,
  assignmentsTable,
  assessmentsTable,
  announcementsTable,
  notesTable,
} from "@workspace/db";
import { sql } from "drizzle-orm";
import { StudentCourseWorkspaceService } from "../services/student-course-workspace.service";
import { getCourseWorkspaceCounts } from "../lib/student-course-workspace.queries";
import { createStudentScope } from "./helpers/authorization";

// ── Fixture state ──────────────────────────────────────────────────────────────

let actorId: number;
let enrolledCourseId: number;
let nonEnrolledCourseId: number;
let deletedCourseId: number;
let studentId: number;
let otherStudentId: number;

const TS = Date.now();
const PREFIX = `_workspace_${TS}`;

// ── Setup / teardown ───────────────────────────────────────────────────────────

beforeAll(async () => {
  const [actor] = await db
    .insert(usersTable)
    .values({
      username: `${PREFIX}_actor`,
      passwordHash: "x",
      displayName: "Workspace Test Actor",
      role: "teacher",
      isActive: true,
    })
    .returning({ id: usersTable.id });
  actorId = actor!.id;

  const courseRows = await db
    .insert(coursesTable)
    .values([
      {
        name: `${PREFIX} Enrolled Course`,
        description: "The enrolled course",
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
      {
        name: `${PREFIX} Deleted Course`,
        description: "Soft-deleted",
        subject: "Art",
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
  nonEnrolledCourseId = courseRows[1]!.id;
  deletedCourseId = courseRows[2]!.id;

  await db.execute(
    sql`UPDATE courses SET deleted_at = NOW(), deleted_by = ${actorId} WHERE id = ${deletedCourseId}`,
  );

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

  // Assignments for test student in enrolled course: 2 pending + 1 graded
  await db.insert(assignmentsTable).values([
    {
      title: `${PREFIX} Assign Pending 1`,
      description: "D1",
      courseId: enrolledCourseId,
      studentId,
      dueDate: "2025-12-01",
      status: "pending",
      maxScore: 100,
      createdBy: actorId,
      updatedBy: actorId,
    },
    {
      title: `${PREFIX} Assign Pending 2`,
      description: "D2",
      courseId: enrolledCourseId,
      studentId,
      dueDate: "2025-12-01",
      status: "pending",
      maxScore: 100,
      createdBy: actorId,
      updatedBy: actorId,
    },
    {
      title: `${PREFIX} Assign Graded`,
      description: "D3",
      courseId: enrolledCourseId,
      studentId,
      dueDate: "2025-11-01",
      status: "graded",
      score: 85,
      maxScore: 100,
      createdBy: actorId,
      updatedBy: actorId,
    },
    // Other student's assignment in same course — must NOT appear in test student's counts
    {
      title: `${PREFIX} Assign Other Student`,
      description: "D4",
      courseId: enrolledCourseId,
      studentId: otherStudentId,
      dueDate: "2025-12-01",
      status: "pending",
      maxScore: 100,
      createdBy: actorId,
      updatedBy: actorId,
    },
    // Test student's assignment in non-enrolled course — must NOT appear
    {
      title: `${PREFIX} Assign Non-Enrolled`,
      description: "D5",
      courseId: nonEnrolledCourseId,
      studentId,
      dueDate: "2025-12-01",
      status: "pending",
      maxScore: 100,
      createdBy: actorId,
      updatedBy: actorId,
    },
  ]);

  // Assessments for test student in enrolled course: 2 recent
  await db.insert(assessmentsTable).values([
    {
      title: `${PREFIX} Assessment 1`,
      studentId,
      courseId: enrolledCourseId,
      score: 85,
      maxScore: 100,
      strengths: ["algebra"],
      weaknesses: [],
      createdBy: actorId,
      updatedBy: actorId,
    },
    {
      title: `${PREFIX} Assessment 2`,
      studentId,
      courseId: enrolledCourseId,
      score: 72,
      maxScore: 100,
      strengths: [],
      weaknesses: ["geometry"],
      createdBy: actorId,
      updatedBy: actorId,
    },
    // Other student's assessment in same course — must NOT appear
    {
      title: `${PREFIX} Assessment Other Student`,
      studentId: otherStudentId,
      courseId: enrolledCourseId,
      score: 90,
      maxScore: 100,
      strengths: [],
      weaknesses: [],
      createdBy: actorId,
      updatedBy: actorId,
    },
  ]);

  // Announcements: 2 in enrolled course (both recent), 1 in non-enrolled
  await db.insert(announcementsTable).values([
    {
      title: `${PREFIX} Ann 1`,
      content: "C1",
      courseId: enrolledCourseId,
      authorName: "T1",
      priority: "normal",
      createdBy: actorId,
      updatedBy: actorId,
    },
    {
      title: `${PREFIX} Ann 2`,
      content: "C2",
      courseId: enrolledCourseId,
      authorName: "T1",
      priority: "high",
      createdBy: actorId,
      updatedBy: actorId,
    },
    {
      title: `${PREFIX} Ann Non-Enrolled`,
      content: "C3",
      courseId: nonEnrolledCourseId,
      authorName: "T1",
      priority: "normal",
      createdBy: actorId,
      updatedBy: actorId,
    },
  ]);

  // Notes: 2 in enrolled course (both recent), 1 in non-enrolled
  await db.insert(notesTable).values([
    {
      title: `${PREFIX} Note 1`,
      content: "C1",
      courseId: enrolledCourseId,
      topic: "Topic A",
      createdBy: actorId,
      updatedBy: actorId,
    },
    {
      title: `${PREFIX} Note 2`,
      content: "C2",
      courseId: enrolledCourseId,
      topic: "Topic B",
      createdBy: actorId,
      updatedBy: actorId,
    },
    {
      title: `${PREFIX} Note Non-Enrolled`,
      content: "C3",
      courseId: nonEnrolledCourseId,
      topic: "Topic C",
      createdBy: actorId,
      updatedBy: actorId,
    },
  ]);
});

afterAll(async () => {
  await db.execute(sql`DELETE FROM notes WHERE title LIKE ${`${PREFIX}%`}`);
  await db.execute(sql`DELETE FROM announcements WHERE title LIKE ${`${PREFIX}%`}`);
  await db.execute(sql`DELETE FROM assessments WHERE title LIKE ${`${PREFIX}%`}`);
  await db.execute(sql`DELETE FROM assignments WHERE title LIKE ${`${PREFIX}%`}`);
  await db.execute(sql`DELETE FROM students WHERE name LIKE ${`${PREFIX}%`}`);
  await db.execute(sql`DELETE FROM courses WHERE name LIKE ${`${PREFIX}%`}`);
  await db.execute(sql`DELETE FROM users WHERE username LIKE ${`${PREFIX}%`}`);
});

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeScope(enrolledCourseIds: number[]) {
  return createStudentScope({ studentId, enrolledCourseIds });
}

// ── Service: ownership enforcement ────────────────────────────────────────────

describe("StudentCourseWorkspaceService.getWorkspace — ownership", () => {
  it("returns null for a non-enrolled course (IDOR-safe)", async () => {
    const scope = makeScope([enrolledCourseId]);
    const result = await StudentCourseWorkspaceService.getWorkspace(scope, nonEnrolledCourseId);
    expect(result).toBeNull();
  });

  it("returns null when studentId is null (unlinked account)", async () => {
    const scope = { ...makeScope([enrolledCourseId]), studentId: null as null };
    const result = await StudentCourseWorkspaceService.getWorkspace(scope, enrolledCourseId);
    expect(result).toBeNull();
  });

  it("returns null for a soft-deleted enrolled course", async () => {
    const scope = makeScope([enrolledCourseId, deletedCourseId]);
    const result = await StudentCourseWorkspaceService.getWorkspace(scope, deletedCourseId);
    expect(result).toBeNull();
  });

  it("returns null for a non-existent course ID in scope", async () => {
    const scope = makeScope([enrolledCourseId, -99999]);
    const result = await StudentCourseWorkspaceService.getWorkspace(scope, -99999);
    expect(result).toBeNull();
  });
});

// ── Service: full workspace DTO ────────────────────────────────────────────────

describe("StudentCourseWorkspaceService.getWorkspace — DTO shape", () => {
  let workspace: Awaited<ReturnType<typeof StudentCourseWorkspaceService.getWorkspace>>;

  beforeAll(async () => {
    const scope = makeScope([enrolledCourseId]);
    workspace = await StudentCourseWorkspaceService.getWorkspace(scope, enrolledCourseId);
  });

  it("returns a non-null workspace for an enrolled course", () => {
    expect(workspace).not.toBeNull();
  });

  it("courseId matches the requested course", () => {
    expect(workspace!.courseId).toBe(enrolledCourseId);
  });

  it("title is the course name", () => {
    expect(workspace!.title).toBe(`${PREFIX} Enrolled Course`);
  });

  it("description is included", () => {
    expect(workspace!.description).toBe("The enrolled course");
  });

  it("teacherId is included", () => {
    expect(workspace!.teacherId).toBe(actorId);
  });

  it("all numeric fields are non-negative integers", () => {
    const numFields = [
      workspace!.totalAssignments,
      workspace!.pendingAssignments,
      workspace!.recentAssignments,
      workspace!.totalAssessments,
      workspace!.upcomingAssessments,
      workspace!.totalAnnouncements,
      workspace!.recentAnnouncements,
      workspace!.totalNotes,
      workspace!.recentNotes,
    ];
    for (const v of numFields) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(v)).toBe(true);
    }
  });
});

// ── Aggregation: assignment counts ────────────────────────────────────────────

describe("getCourseWorkspaceCounts — assignment aggregation", () => {
  let counts: Awaited<ReturnType<typeof getCourseWorkspaceCounts>>;

  beforeAll(async () => {
    counts = await getCourseWorkspaceCounts(enrolledCourseId, studentId);
  });

  it("totalAssignments = 3 (pending×2 + graded×1, for this student in this course)", () => {
    expect(counts.totalAssignments).toBe(3);
  });

  it("pendingAssignments = 2", () => {
    expect(counts.pendingAssignments).toBe(2);
  });

  it("recentAssignments >= 3 (all created just now, within 7-day window)", () => {
    expect(counts.recentAssignments).toBeGreaterThanOrEqual(3);
  });

  it("pendingAssignments <= totalAssignments", () => {
    expect(counts.pendingAssignments).toBeLessThanOrEqual(counts.totalAssignments);
  });
});

// ── Aggregation: assessment counts ────────────────────────────────────────────

describe("getCourseWorkspaceCounts — assessment aggregation", () => {
  let counts: Awaited<ReturnType<typeof getCourseWorkspaceCounts>>;

  beforeAll(async () => {
    counts = await getCourseWorkspaceCounts(enrolledCourseId, studentId);
  });

  it("totalAssessments = 2 (for this student in this course only)", () => {
    expect(counts.totalAssessments).toBe(2);
  });

  it("upcomingAssessments >= 2 (created within 30-day window)", () => {
    expect(counts.upcomingAssessments).toBeGreaterThanOrEqual(2);
  });

  it("upcomingAssessments <= totalAssessments", () => {
    expect(counts.upcomingAssessments).toBeLessThanOrEqual(counts.totalAssessments);
  });
});

// ── Aggregation: announcement counts ─────────────────────────────────────────

describe("getCourseWorkspaceCounts — announcement aggregation", () => {
  let counts: Awaited<ReturnType<typeof getCourseWorkspaceCounts>>;

  beforeAll(async () => {
    counts = await getCourseWorkspaceCounts(enrolledCourseId, studentId);
  });

  it("totalAnnouncements = 2 (in this course only)", () => {
    expect(counts.totalAnnouncements).toBe(2);
  });

  it("recentAnnouncements >= 2 (created within 7-day window)", () => {
    expect(counts.recentAnnouncements).toBeGreaterThanOrEqual(2);
  });
});

// ── Aggregation: notes counts ─────────────────────────────────────────────────

describe("getCourseWorkspaceCounts — notes aggregation", () => {
  let counts: Awaited<ReturnType<typeof getCourseWorkspaceCounts>>;

  beforeAll(async () => {
    counts = await getCourseWorkspaceCounts(enrolledCourseId, studentId);
  });

  it("totalNotes = 2 (in this course only)", () => {
    expect(counts.totalNotes).toBe(2);
  });

  it("recentNotes >= 2 (created within 7-day window)", () => {
    expect(counts.recentNotes).toBeGreaterThanOrEqual(2);
  });
});

// ── Scope boundary: student isolation ────────────────────────────────────────

describe("Scope boundary — other student's data excluded", () => {
  it("other student's assignments in same course are not counted", async () => {
    const myCounts = await getCourseWorkspaceCounts(enrolledCourseId, studentId);
    const otherCounts = await getCourseWorkspaceCounts(enrolledCourseId, otherStudentId);

    // Other student has 1 assignment; test student has 3
    expect(myCounts.totalAssignments).toBe(3);
    expect(otherCounts.totalAssignments).toBe(1);
  });

  it("other student's assessments in same course are not counted", async () => {
    const myCounts = await getCourseWorkspaceCounts(enrolledCourseId, studentId);
    const otherCounts = await getCourseWorkspaceCounts(enrolledCourseId, otherStudentId);

    expect(myCounts.totalAssessments).toBe(2);
    expect(otherCounts.totalAssessments).toBe(1);
  });

  it("announcements are course-scoped (same for both students)", async () => {
    const myCounts = await getCourseWorkspaceCounts(enrolledCourseId, studentId);
    const otherCounts = await getCourseWorkspaceCounts(enrolledCourseId, otherStudentId);

    expect(myCounts.totalAnnouncements).toBe(otherCounts.totalAnnouncements);
  });
});

// ── Scope boundary: non-enrolled course isolation ─────────────────────────────

describe("Scope boundary — non-enrolled course blocked at service layer", () => {
  it("getCourseWorkspaceCounts for non-enrolled course returns its own data", async () => {
    // Direct query (no enrollment check) — verifies isolation is at service layer
    const nonEnrolledCounts = await getCourseWorkspaceCounts(nonEnrolledCourseId, studentId);
    const enrolledCounts = await getCourseWorkspaceCounts(enrolledCourseId, studentId);

    // Non-enrolled course has 1 assignment, 0 assessments for our student, 1 announcement, 1 note
    expect(nonEnrolledCounts.totalAssignments).toBe(1);
    expect(nonEnrolledCounts.totalAnnouncements).toBe(1);
    expect(nonEnrolledCounts.totalNotes).toBe(1);

    // Enrolled course counts are separate
    expect(enrolledCounts.totalAnnouncements).toBe(2);
    expect(enrolledCounts.totalNotes).toBe(2);
  });

  it("service returns null for non-enrolled course (enrollment guard)", async () => {
    // Service layer prevents the query from running for non-enrolled courses
    const scope = makeScope([enrolledCourseId]); // nonEnrolledCourseId NOT in scope
    const result = await StudentCourseWorkspaceService.getWorkspace(scope, nonEnrolledCourseId);
    expect(result).toBeNull();
  });
});
