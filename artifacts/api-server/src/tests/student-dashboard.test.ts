/**
 * Student Dashboard Tests — Sprint 5 Chunk 1
 *
 * Coverage:
 *
 * Authorization:
 *   - null studentId (unlinked account) → service returns null
 *   - valid studentId with enrolled courses → full dashboard returned
 *   - non-existent studentId → service returns null
 *
 * Aggregation (real DB):
 *   - activeCourseCount counts only 'active' enrolled courses (not archived)
 *   - totalAssignments counts all non-deleted assignments for the student
 *   - pendingAssignments counts only 'pending' status
 *   - totalAssessments counts all non-deleted assessments for the student
 *   - upcomingAssessments counts assessments created in the last 30 days
 *   - unreadAnnouncements counts non-deleted announcements in enrolled courses only
 *   - availableNotes counts non-deleted notes in enrolled courses only
 *
 * Scope boundary:
 *   - data from unenrolled courses is excluded from course-scoped counts
 *   - adding a course to enrolledCourseIds correctly increases course-scoped counts
 *
 * Empty enrollment:
 *   - course-scoped counts (courses/announcements/notes) return 0 when no enrollment
 *   - student-scoped counts (assignments/assessments) still return correct values
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  db,
  usersTable,
  coursesTable,
  assignmentsTable,
  assessmentsTable,
  notesTable,
  announcementsTable,
} from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  getStudentDisplayName,
  getStudentDashboardCounts,
} from "../lib/student-dashboard.queries";
import { StudentDashboardService } from "../services/student-dashboard.service";
import { createStudentScope } from "./helpers/authorization";

// ── Fixture state ──────────────────────────────────────────────────────────────

let actorId: number;
let enrolledCourse1Id: number;
let enrolledCourse2Id: number;
let unenrolledCourseId: number;
let archivedCourseId: number;
let studentId: number;

const TS = Date.now();
const PREFIX = `_sdash_${TS}`;

// ── Setup / teardown ───────────────────────────────────────────────────────────

beforeAll(async () => {
  const [actor] = await db
    .insert(usersTable)
    .values({
      username: `${PREFIX}_actor`,
      passwordHash: "x",
      displayName: "Dashboard Test Actor",
      role: "teacher",
      isActive: true,
    })
    .returning({ id: usersTable.id });
  actorId = actor!.id;

  const courseRows = await db
    .insert(coursesTable)
    .values([
      {
        name: `${PREFIX} Course Active 1`,
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
        name: `${PREFIX} Course Active 2`,
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
        name: `${PREFIX} Course Unenrolled`,
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
        name: `${PREFIX} Course Archived`,
        subject: "Art",
        grade: "10",
        academicYear: "2024-2025",
        teacherName: "T1",
        teacherId: actorId,
        status: "archived",
        createdBy: actorId,
        updatedBy: actorId,
      },
    ])
    .returning({ id: coursesTable.id });

  enrolledCourse1Id = courseRows[0]!.id;
  enrolledCourse2Id = courseRows[1]!.id;
  unenrolledCourseId = courseRows[2]!.id;
  archivedCourseId = courseRows[3]!.id;

  const studentResult = await db.execute(sql`
    INSERT INTO students (name, email, grade)
    VALUES (${`${PREFIX} Student`}, ${`${PREFIX}@test.example`}, ${"10"})
    RETURNING id
  `);
  studentId = (studentResult.rows[0] as { id: number }).id;

  // 2 enrolled-course assignments: 1 pending, 1 graded
  // 1 unenrolled-course assignment: pending (should be counted in totalAssignments
  //   because assignments are student-scoped, not course-scoped)
  await db.insert(assignmentsTable).values([
    {
      title: `${PREFIX} Assign Pending`,
      description: "D1",
      courseId: enrolledCourse1Id,
      studentId,
      dueDate: "2025-12-01",
      status: "pending",
      maxScore: 100,
      createdBy: actorId,
      updatedBy: actorId,
    },
    {
      title: `${PREFIX} Assign Graded`,
      description: "D2",
      courseId: enrolledCourse2Id,
      studentId,
      dueDate: "2025-12-01",
      status: "graded",
      maxScore: 100,
      score: 85,
      createdBy: actorId,
      updatedBy: actorId,
    },
    {
      title: `${PREFIX} Assign Unenrolled Pending`,
      description: "D3",
      courseId: unenrolledCourseId,
      studentId,
      dueDate: "2025-12-01",
      status: "pending",
      maxScore: 100,
      createdBy: actorId,
      updatedBy: actorId,
    },
  ]);

  // 2 enrolled-course assessments (recent), 1 unenrolled-course assessment (recent)
  await db.insert(assessmentsTable).values([
    {
      title: `${PREFIX} Assessment 1`,
      studentId,
      courseId: enrolledCourse1Id,
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
      courseId: enrolledCourse2Id,
      score: 75,
      maxScore: 100,
      strengths: [],
      weaknesses: ["chemistry"],
      createdBy: actorId,
      updatedBy: actorId,
    },
    {
      title: `${PREFIX} Assessment Unenrolled`,
      studentId,
      courseId: unenrolledCourseId,
      score: 60,
      maxScore: 100,
      strengths: [],
      weaknesses: [],
      createdBy: actorId,
      updatedBy: actorId,
    },
  ]);

  // 2 announcements in enrolled courses, 1 in unenrolled
  await db.insert(announcementsTable).values([
    {
      title: `${PREFIX} Ann 1`,
      content: "C1",
      courseId: enrolledCourse1Id,
      authorName: "T1",
      priority: "normal",
      createdBy: actorId,
      updatedBy: actorId,
    },
    {
      title: `${PREFIX} Ann 2`,
      content: "C2",
      courseId: enrolledCourse2Id,
      authorName: "T1",
      priority: "normal",
      createdBy: actorId,
      updatedBy: actorId,
    },
    {
      title: `${PREFIX} Ann Unenrolled`,
      content: "C3",
      courseId: unenrolledCourseId,
      authorName: "T1",
      priority: "normal",
      createdBy: actorId,
      updatedBy: actorId,
    },
  ]);

  // 2 notes in enrolled courses, 1 in unenrolled
  await db.insert(notesTable).values([
    {
      title: `${PREFIX} Note 1`,
      content: "C1",
      courseId: enrolledCourse1Id,
      topic: "Topic A",
      createdBy: actorId,
      updatedBy: actorId,
    },
    {
      title: `${PREFIX} Note 2`,
      content: "C2",
      courseId: enrolledCourse2Id,
      topic: "Topic B",
      createdBy: actorId,
      updatedBy: actorId,
    },
    {
      title: `${PREFIX} Note Unenrolled`,
      content: "C3",
      courseId: unenrolledCourseId,
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

// ── Service: null studentId ────────────────────────────────────────────────────

describe("StudentDashboardService.getDashboard — authorization edge cases", () => {
  it("returns null when studentId is null (unlinked account)", async () => {
    const scope = createStudentScope({ studentId: undefined, enrolledCourseIds: [] });
    const nulledScope = { ...scope, studentId: null as null };
    const result = await StudentDashboardService.getDashboard(nulledScope);
    expect(result).toBeNull();
  });

  it("returns null when student record does not exist in DB", async () => {
    const scope = createStudentScope({ studentId: -99999, enrolledCourseIds: [] });
    const result = await StudentDashboardService.getDashboard(scope);
    expect(result).toBeNull();
  });
});

// ── Repository: getStudentDisplayName ──────────────────────────────────────────

describe("getStudentDisplayName", () => {
  it("returns the student name for a valid ID", async () => {
    const name = await getStudentDisplayName(studentId);
    expect(name).toBe(`${PREFIX} Student`);
  });

  it("returns null for an unknown ID", async () => {
    const name = await getStudentDisplayName(-99999);
    expect(name).toBeNull();
  });
});

// ── Repository: getStudentDashboardCounts — empty enrollment ───────────────────

describe("getStudentDashboardCounts — empty enrolledCourseIds", () => {
  it("course-scoped fields (courses/announcements/notes) return 0", async () => {
    const counts = await getStudentDashboardCounts(studentId, []);
    expect(counts.activeCourseCount).toBe(0);
    expect(counts.unreadAnnouncements).toBe(0);
    expect(counts.availableNotes).toBe(0);
  });

  it("student-scoped fields (assignments/assessments) still return correct values", async () => {
    const counts = await getStudentDashboardCounts(studentId, []);
    expect(counts.totalAssignments).toBeGreaterThanOrEqual(3);
    expect(counts.pendingAssignments).toBeGreaterThanOrEqual(2);
    expect(counts.totalAssessments).toBeGreaterThanOrEqual(3);
  });
});

// ── Repository: getStudentDashboardCounts — enrolled courses ───────────────────

describe("getStudentDashboardCounts — enrolled courses only", () => {
  let counts: Awaited<ReturnType<typeof getStudentDashboardCounts>>;

  beforeAll(async () => {
    counts = await getStudentDashboardCounts(studentId, [enrolledCourse1Id, enrolledCourse2Id]);
  });

  it("activeCourseCount = 2 (both enrolled courses are active)", () => {
    expect(counts.activeCourseCount).toBe(2);
  });

  it("totalAssignments >= 3 (student-scoped: includes unenrolled course)", () => {
    expect(counts.totalAssignments).toBeGreaterThanOrEqual(3);
  });

  it("pendingAssignments >= 2 (student-scoped: includes unenrolled course pending)", () => {
    expect(counts.pendingAssignments).toBeGreaterThanOrEqual(2);
  });

  it("totalAssessments >= 3 (student-scoped: all student assessments)", () => {
    expect(counts.totalAssessments).toBeGreaterThanOrEqual(3);
  });

  it("upcomingAssessments >= 3 (all test assessments created within 30 days)", () => {
    expect(counts.upcomingAssessments).toBeGreaterThanOrEqual(3);
  });

  it("unreadAnnouncements = 2 (course-scoped: exactly enrolled courses)", () => {
    expect(counts.unreadAnnouncements).toBe(2);
  });

  it("availableNotes = 2 (course-scoped: exactly enrolled courses)", () => {
    expect(counts.availableNotes).toBe(2);
  });
});

// ── Repository: activeCourseCount excludes archived courses ───────────────────

describe("getStudentDashboardCounts — archived course excluded from activeCourseCount", () => {
  it("archived enrolled course does not count toward activeCourseCount", async () => {
    const withActive = await getStudentDashboardCounts(studentId, [enrolledCourse1Id, enrolledCourse2Id]);
    const withArchived = await getStudentDashboardCounts(studentId, [enrolledCourse1Id, enrolledCourse2Id, archivedCourseId]);

    expect(withArchived.activeCourseCount).toBe(withActive.activeCourseCount);
  });
});

// ── Scope boundary: enrolled vs unenrolled course data ────────────────────────

describe("Scope boundary — course-scoped counts exclude unenrolled course data", () => {
  it("adding unenrolled course to scope increases unreadAnnouncements by 1", async () => {
    const enrolled = await getStudentDashboardCounts(studentId, [enrolledCourse1Id, enrolledCourse2Id]);
    const withExtra = await getStudentDashboardCounts(studentId, [enrolledCourse1Id, enrolledCourse2Id, unenrolledCourseId]);

    expect(withExtra.unreadAnnouncements).toBe(enrolled.unreadAnnouncements + 1);
  });

  it("adding unenrolled course to scope increases availableNotes by 1", async () => {
    const enrolled = await getStudentDashboardCounts(studentId, [enrolledCourse1Id, enrolledCourse2Id]);
    const withExtra = await getStudentDashboardCounts(studentId, [enrolledCourse1Id, enrolledCourse2Id, unenrolledCourseId]);

    expect(withExtra.availableNotes).toBe(enrolled.availableNotes + 1);
  });

  it("adding unenrolled course to scope increases activeCourseCount by 1", async () => {
    const enrolled = await getStudentDashboardCounts(studentId, [enrolledCourse1Id, enrolledCourse2Id]);
    const withExtra = await getStudentDashboardCounts(studentId, [enrolledCourse1Id, enrolledCourse2Id, unenrolledCourseId]);

    expect(withExtra.activeCourseCount).toBe(enrolled.activeCourseCount + 1);
  });
});

// ── Full service integration ───────────────────────────────────────────────────

describe("StudentDashboardService.getDashboard — full integration", () => {
  it("returns a complete, correctly-typed dashboard for a valid student", async () => {
    const scope = createStudentScope({
      studentId,
      enrolledCourseIds: [enrolledCourse1Id, enrolledCourse2Id],
    });

    const dashboard = await StudentDashboardService.getDashboard(scope);

    expect(dashboard).not.toBeNull();
    expect(dashboard!.studentId).toBe(studentId);
    expect(dashboard!.displayName).toBe(`${PREFIX} Student`);
    expect(dashboard!.activeCourseCount).toBe(2);
    expect(typeof dashboard!.totalAssignments).toBe("number");
    expect(typeof dashboard!.pendingAssignments).toBe("number");
    expect(dashboard!.pendingAssignments).toBeLessThanOrEqual(dashboard!.totalAssignments);
    expect(typeof dashboard!.totalAssessments).toBe("number");
    expect(dashboard!.upcomingAssessments).toBeLessThanOrEqual(dashboard!.totalAssessments);
    expect(dashboard!.unreadAnnouncements).toBe(2);
    expect(dashboard!.availableNotes).toBe(2);
  });

  it("all numeric fields are non-negative integers", async () => {
    const scope = createStudentScope({
      studentId,
      enrolledCourseIds: [enrolledCourse1Id, enrolledCourse2Id],
    });

    const dashboard = await StudentDashboardService.getDashboard(scope);
    expect(dashboard).not.toBeNull();

    const numericFields = [
      dashboard!.activeCourseCount,
      dashboard!.totalAssignments,
      dashboard!.pendingAssignments,
      dashboard!.totalAssessments,
      dashboard!.upcomingAssessments,
      dashboard!.unreadAnnouncements,
      dashboard!.availableNotes,
    ];

    for (const val of numericFields) {
      expect(val).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(val)).toBe(true);
    }
  });
});
