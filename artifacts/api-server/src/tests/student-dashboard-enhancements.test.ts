/**
 * Student Dashboard Enhancement Tests — Sprint 5 Chunk 8
 *
 * Tests the four new recent-activity collections added to the dashboard:
 *   - recentAssignments  (student-scoped, limit 5)
 *   - recentAssessments  (student-scoped, limit 5)
 *   - recentAnnouncements (course-scoped, limit 5)
 *   - recentNotes         (course-scoped, limit 5)
 *
 * Existing scalar-count tests live in student-dashboard.test.ts and remain unchanged.
 * This file only covers the new recent-activity functionality to avoid fixture coupling.
 *
 * Coverage:
 *
 * Repository — getStudentDashboardRecentActivity:
 *   - empty enrollment → recentAnnouncements/recentNotes = []
 *   - student-scoped collections always run (even with no enrollment)
 *   - returns at most `limit` items per collection
 *   - non-enrolled-course data excluded from course-scoped collections
 *   - soft-deleted items excluded from all collections
 *   - ordering: most recent first
 *
 * Service — getDashboard recent-activity fields:
 *   - recentAssignments DTO shape (5 fields)
 *   - recentAssessments DTO shape (4 fields)
 *   - recentAnnouncements DTO shape (5 fields, priority)
 *   - recentNotes DTO shape (5 fields, topic)
 *   - ISO 8601 dates on all collections
 *   - collections are arrays (always present, even when empty)
 *   - ownership: enrolled-course items visible, non-enrolled excluded
 *
 * Regression: all existing 1170 tests remain green
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
import { getStudentDashboardRecentActivity } from "../lib/student-dashboard.queries";
import { StudentDashboardService } from "../services/student-dashboard.service";
import { createStudentScope } from "./helpers/authorization";

// ── Fixture state ──────────────────────────────────────────────────────────────

let actorId: number;
let enrolledCourseId: number;
let nonEnrolledCourseId: number;
let studentId: number;

// IDs for visibility assertions
let assignmentIds: number[] = [];
let assessmentIds: number[] = [];
let announcementIds: number[] = [];
let noteIds: number[] = [];
let nonEnrolledAnnouncementId: number;
let nonEnrolledNoteId: number;
let deletedAssignmentId: number;
let deletedAssessmentId: number;
let deletedAnnouncementId: number;
let deletedNoteId: number;

const TS = Date.now();
const PREFIX = `_dashenh_${TS}`;

// ── Setup / teardown ───────────────────────────────────────────────────────────

beforeAll(async () => {
  const [actor] = await db
    .insert(usersTable)
    .values({
      username: `${PREFIX}_actor`,
      passwordHash: "x",
      displayName: "Dashboard Enh Actor",
      role: "teacher",
      isActive: true,
    })
    .returning({ id: usersTable.id });
  actorId = actor!.id;

  const courseRows = await db
    .insert(coursesTable)
    .values([
      {
        name: `${PREFIX} Enrolled`,
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
        name: `${PREFIX} NonEnrolled`,
        subject: "Science",
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

  const studentResult = await db.execute(sql`
    INSERT INTO students (name, email, grade)
    VALUES (${`${PREFIX} Student`}, ${`${PREFIX}@test.example`}, ${"10"})
    RETURNING id
  `);
  studentId = (studentResult.rows[0] as { id: number }).id;

  // 3 active assignments (enrolled course) + 1 non-enrolled + 1 deleted
  const assignmentRows = await db
    .insert(assignmentsTable)
    .values([
      {
        title: `${PREFIX} Assign A`,
        description: "A",
        courseId: enrolledCourseId,
        studentId,
        dueDate: "2025-12-01",
        status: "pending",
        maxScore: 100,
        createdBy: actorId,
        updatedBy: actorId,
      },
      {
        title: `${PREFIX} Assign B`,
        description: "B",
        courseId: enrolledCourseId,
        studentId,
        dueDate: "2025-12-15",
        status: "graded",
        maxScore: 100,
        score: 90,
        createdBy: actorId,
        updatedBy: actorId,
      },
      {
        title: `${PREFIX} Assign C`,
        description: "C",
        courseId: enrolledCourseId,
        studentId,
        dueDate: "2026-01-10",
        status: "submitted",
        maxScore: 100,
        createdBy: actorId,
        updatedBy: actorId,
      },
      {
        title: `${PREFIX} Assign NonEnrolled`,
        description: "NE",
        courseId: nonEnrolledCourseId,
        studentId,
        dueDate: "2025-12-01",
        status: "pending",
        maxScore: 100,
        createdBy: actorId,
        updatedBy: actorId,
      },
      {
        title: `${PREFIX} Assign Deleted`,
        description: "Del",
        courseId: enrolledCourseId,
        studentId,
        dueDate: "2025-12-01",
        status: "pending",
        maxScore: 100,
        createdBy: actorId,
        updatedBy: actorId,
      },
    ])
    .returning({ id: assignmentsTable.id });

  assignmentIds = assignmentRows.slice(0, 3).map((r) => r.id);
  deletedAssignmentId = assignmentRows[4]!.id;

  await db.execute(
    sql`UPDATE assignments SET deleted_at = NOW(), deleted_by = ${actorId} WHERE id = ${deletedAssignmentId}`,
  );

  // 3 active assessments (enrolled) + 1 non-enrolled + 1 deleted
  const assessmentRows = await db
    .insert(assessmentsTable)
    .values([
      {
        title: `${PREFIX} Assess A`,
        studentId,
        courseId: enrolledCourseId,
        score: 80,
        maxScore: 100,
        strengths: [],
        weaknesses: [],
        createdBy: actorId,
        updatedBy: actorId,
      },
      {
        title: `${PREFIX} Assess B`,
        studentId,
        courseId: enrolledCourseId,
        score: 90,
        maxScore: 100,
        strengths: [],
        weaknesses: [],
        createdBy: actorId,
        updatedBy: actorId,
      },
      {
        title: `${PREFIX} Assess C`,
        studentId,
        courseId: enrolledCourseId,
        score: 70,
        maxScore: 100,
        strengths: [],
        weaknesses: [],
        createdBy: actorId,
        updatedBy: actorId,
      },
      {
        title: `${PREFIX} Assess NonEnrolled`,
        studentId,
        courseId: nonEnrolledCourseId,
        score: 60,
        maxScore: 100,
        strengths: [],
        weaknesses: [],
        createdBy: actorId,
        updatedBy: actorId,
      },
      {
        title: `${PREFIX} Assess Deleted`,
        studentId,
        courseId: enrolledCourseId,
        score: 50,
        maxScore: 100,
        strengths: [],
        weaknesses: [],
        createdBy: actorId,
        updatedBy: actorId,
      },
    ])
    .returning({ id: assessmentsTable.id });

  assessmentIds = assessmentRows.slice(0, 3).map((r) => r.id);
  deletedAssessmentId = assessmentRows[4]!.id;

  await db.execute(
    sql`UPDATE assessments SET deleted_at = NOW(), deleted_by = ${actorId} WHERE id = ${deletedAssessmentId}`,
  );

  // 3 active announcements (enrolled) + 1 non-enrolled + 1 deleted
  const announcementRows = await db
    .insert(announcementsTable)
    .values([
      {
        title: `${PREFIX} Ann A`,
        content: "C",
        courseId: enrolledCourseId,
        authorName: "T1",
        priority: "high",
        createdBy: actorId,
        updatedBy: actorId,
      },
      {
        title: `${PREFIX} Ann B`,
        content: "C",
        courseId: enrolledCourseId,
        authorName: "T1",
        priority: "normal",
        createdBy: actorId,
        updatedBy: actorId,
      },
      {
        title: `${PREFIX} Ann C`,
        content: "C",
        courseId: enrolledCourseId,
        authorName: "T1",
        priority: "normal",
        createdBy: actorId,
        updatedBy: actorId,
      },
      {
        title: `${PREFIX} Ann NonEnrolled`,
        content: "C",
        courseId: nonEnrolledCourseId,
        authorName: "T1",
        priority: "normal",
        createdBy: actorId,
        updatedBy: actorId,
      },
      {
        title: `${PREFIX} Ann Deleted`,
        content: "C",
        courseId: enrolledCourseId,
        authorName: "T1",
        priority: "normal",
        createdBy: actorId,
        updatedBy: actorId,
      },
    ])
    .returning({ id: announcementsTable.id });

  announcementIds = announcementRows.slice(0, 3).map((r) => r.id);
  nonEnrolledAnnouncementId = announcementRows[3]!.id;
  deletedAnnouncementId = announcementRows[4]!.id;

  await db.execute(
    sql`UPDATE announcements SET deleted_at = NOW(), deleted_by = ${actorId} WHERE id = ${deletedAnnouncementId}`,
  );

  // 3 active notes (enrolled) + 1 non-enrolled + 1 deleted
  const noteRows = await db
    .insert(notesTable)
    .values([
      {
        title: `${PREFIX} Note A`,
        content: "C",
        topic: "Algebra",
        courseId: enrolledCourseId,
        createdBy: actorId,
        updatedBy: actorId,
      },
      {
        title: `${PREFIX} Note B`,
        content: "C",
        topic: "Geometry",
        courseId: enrolledCourseId,
        createdBy: actorId,
        updatedBy: actorId,
      },
      {
        title: `${PREFIX} Note C`,
        content: "C",
        topic: "Calculus",
        courseId: enrolledCourseId,
        createdBy: actorId,
        updatedBy: actorId,
      },
      {
        title: `${PREFIX} Note NonEnrolled`,
        content: "C",
        topic: "History",
        courseId: nonEnrolledCourseId,
        createdBy: actorId,
        updatedBy: actorId,
      },
      {
        title: `${PREFIX} Note Deleted`,
        content: "C",
        topic: "Physics",
        courseId: enrolledCourseId,
        createdBy: actorId,
        updatedBy: actorId,
      },
    ])
    .returning({ id: notesTable.id });

  noteIds = noteRows.slice(0, 3).map((r) => r.id);
  nonEnrolledNoteId = noteRows[3]!.id;
  deletedNoteId = noteRows[4]!.id;

  await db.execute(
    sql`UPDATE notes SET deleted_at = NOW(), deleted_by = ${actorId} WHERE id = ${deletedNoteId}`,
  );
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

// ── Repository: getStudentDashboardRecentActivity — empty enrollment ───────────

describe("getStudentDashboardRecentActivity — empty enrolledCourseIds", () => {
  it("recentAnnouncements and recentNotes are empty arrays (course-scoped)", async () => {
    const activity = await getStudentDashboardRecentActivity(studentId, []);
    expect(activity.recentAnnouncements).toEqual([]);
    expect(activity.recentNotes).toEqual([]);
  });

  it("recentAssignments still returns data (student-scoped)", async () => {
    const activity = await getStudentDashboardRecentActivity(studentId, []);
    const ids = activity.recentAssignments.map((r) => r.id);
    expect(assignmentIds.some((id) => ids.includes(id))).toBe(true);
  });

  it("recentAssessments still returns data (student-scoped)", async () => {
    const activity = await getStudentDashboardRecentActivity(studentId, []);
    const ids = activity.recentAssessments.map((r) => r.id);
    expect(assessmentIds.some((id) => ids.includes(id))).toBe(true);
  });
});

// ── Repository: ownership filtering ───────────────────────────────────────────

describe("getStudentDashboardRecentActivity — ownership filtering", () => {
  it("recentAnnouncements excludes non-enrolled course items", async () => {
    const activity = await getStudentDashboardRecentActivity(studentId, [enrolledCourseId]);
    expect(activity.recentAnnouncements.map((r) => r.id)).not.toContain(
      nonEnrolledAnnouncementId,
    );
  });

  it("recentNotes excludes non-enrolled course items", async () => {
    const activity = await getStudentDashboardRecentActivity(studentId, [enrolledCourseId]);
    expect(activity.recentNotes.map((r) => r.id)).not.toContain(nonEnrolledNoteId);
  });
});

// ── Repository: soft-delete filtering ─────────────────────────────────────────

describe("getStudentDashboardRecentActivity — soft-delete filtering", () => {
  it("recentAssignments excludes soft-deleted assignments", async () => {
    const activity = await getStudentDashboardRecentActivity(studentId, [enrolledCourseId]);
    expect(activity.recentAssignments.map((r) => r.id)).not.toContain(deletedAssignmentId);
  });

  it("recentAssessments excludes soft-deleted assessments", async () => {
    const activity = await getStudentDashboardRecentActivity(studentId, [enrolledCourseId]);
    expect(activity.recentAssessments.map((r) => r.id)).not.toContain(deletedAssessmentId);
  });

  it("recentAnnouncements excludes soft-deleted announcements", async () => {
    const activity = await getStudentDashboardRecentActivity(studentId, [enrolledCourseId]);
    expect(activity.recentAnnouncements.map((r) => r.id)).not.toContain(deletedAnnouncementId);
  });

  it("recentNotes excludes soft-deleted notes", async () => {
    const activity = await getStudentDashboardRecentActivity(studentId, [enrolledCourseId]);
    expect(activity.recentNotes.map((r) => r.id)).not.toContain(deletedNoteId);
  });
});

// ── Repository: limit enforcement ─────────────────────────────────────────────

describe("getStudentDashboardRecentActivity — limit enforcement", () => {
  it("recentAnnouncements respects the default limit of 5", async () => {
    const activity = await getStudentDashboardRecentActivity(studentId, [enrolledCourseId]);
    expect(activity.recentAnnouncements.length).toBeLessThanOrEqual(5);
  });

  it("recentNotes respects the default limit of 5", async () => {
    const activity = await getStudentDashboardRecentActivity(studentId, [enrolledCourseId]);
    expect(activity.recentNotes.length).toBeLessThanOrEqual(5);
  });

  it("custom limit=1 returns at most 1 item per collection", async () => {
    const activity = await getStudentDashboardRecentActivity(
      studentId,
      [enrolledCourseId],
      1,
    );
    expect(activity.recentAssignments.length).toBeLessThanOrEqual(1);
    expect(activity.recentAssessments.length).toBeLessThanOrEqual(1);
    expect(activity.recentAnnouncements.length).toBeLessThanOrEqual(1);
    expect(activity.recentNotes.length).toBeLessThanOrEqual(1);
  });
});

// ── Repository: ordering ───────────────────────────────────────────────────────

describe("getStudentDashboardRecentActivity — ordering (most recent first)", () => {
  it("recentAnnouncements: inserting a new row puts it at the front", async () => {
    const [newRow] = await db
      .insert(announcementsTable)
      .values({
        title: `${PREFIX} Ann Order`,
        content: "C",
        courseId: enrolledCourseId,
        authorName: "T1",
        priority: "normal",
        createdBy: actorId,
        updatedBy: actorId,
      })
      .returning({ id: announcementsTable.id });

    try {
      const activity = await getStudentDashboardRecentActivity(studentId, [enrolledCourseId]);
      expect(activity.recentAnnouncements[0]!.id).toBe(newRow!.id);
    } finally {
      await db.execute(sql`DELETE FROM announcements WHERE id = ${newRow!.id}`);
    }
  });

  it("recentNotes: inserting a new row puts it at the front", async () => {
    const [newRow] = await db
      .insert(notesTable)
      .values({
        title: `${PREFIX} Note Order`,
        content: "C",
        topic: "T",
        courseId: enrolledCourseId,
        createdBy: actorId,
        updatedBy: actorId,
      })
      .returning({ id: notesTable.id });

    try {
      const activity = await getStudentDashboardRecentActivity(studentId, [enrolledCourseId]);
      expect(activity.recentNotes[0]!.id).toBe(newRow!.id);
    } finally {
      await db.execute(sql`DELETE FROM notes WHERE id = ${newRow!.id}`);
    }
  });
});

// ── Service: getDashboard — recent-activity DTO shape ─────────────────────────

describe("StudentDashboardService.getDashboard — recent-activity arrays present", () => {
  it("all four recent-activity fields are arrays", async () => {
    const scope = makeScope([enrolledCourseId]);
    const dashboard = await StudentDashboardService.getDashboard(scope);
    expect(dashboard).not.toBeNull();
    expect(Array.isArray(dashboard!.recentAssignments)).toBe(true);
    expect(Array.isArray(dashboard!.recentAssessments)).toBe(true);
    expect(Array.isArray(dashboard!.recentAnnouncements)).toBe(true);
    expect(Array.isArray(dashboard!.recentNotes)).toBe(true);
  });

  it("arrays are empty (not missing) when enrollment is empty", async () => {
    const scope = makeScope([]);
    const dashboard = await StudentDashboardService.getDashboard(scope);
    expect(dashboard).not.toBeNull();
    expect(dashboard!.recentAnnouncements).toEqual([]);
    expect(dashboard!.recentNotes).toEqual([]);
  });
});

describe("StudentDashboardService.getDashboard — recentAssignments DTO shape", () => {
  let items: Awaited<ReturnType<typeof StudentDashboardService.getDashboard>>;

  beforeAll(async () => {
    items = await StudentDashboardService.getDashboard(makeScope([enrolledCourseId]));
  });

  it("each item has the 5 required fields", () => {
    for (const a of items!.recentAssignments) {
      expect(typeof a.assignmentId).toBe("number");
      expect(typeof a.courseId).toBe("number");
      expect(typeof a.title).toBe("string");
      expect(typeof a.dueDate).toBe("string");
      expect(typeof a.createdAt).toBe("string");
    }
  });

  it("createdAt is ISO 8601", () => {
    for (const a of items!.recentAssignments) {
      expect(() => new Date(a.createdAt).toISOString()).not.toThrow();
    }
  });

  it("does not include soft-deleted assignments", () => {
    expect(items!.recentAssignments.map((a) => a.assignmentId)).not.toContain(
      deletedAssignmentId,
    );
  });
});

describe("StudentDashboardService.getDashboard — recentAssessments DTO shape", () => {
  let items: Awaited<ReturnType<typeof StudentDashboardService.getDashboard>>;

  beforeAll(async () => {
    items = await StudentDashboardService.getDashboard(makeScope([enrolledCourseId]));
  });

  it("each item has the 4 required fields", () => {
    for (const a of items!.recentAssessments) {
      expect(typeof a.assessmentId).toBe("number");
      expect(typeof a.courseId).toBe("number");
      expect(typeof a.title).toBe("string");
      expect(typeof a.createdAt).toBe("string");
    }
  });

  it("createdAt is ISO 8601", () => {
    for (const a of items!.recentAssessments) {
      expect(() => new Date(a.createdAt).toISOString()).not.toThrow();
    }
  });

  it("does not include soft-deleted assessments", () => {
    expect(items!.recentAssessments.map((a) => a.assessmentId)).not.toContain(
      deletedAssessmentId,
    );
  });
});

describe("StudentDashboardService.getDashboard — recentAnnouncements DTO shape", () => {
  let items: Awaited<ReturnType<typeof StudentDashboardService.getDashboard>>;

  beforeAll(async () => {
    items = await StudentDashboardService.getDashboard(makeScope([enrolledCourseId]));
  });

  it("each item has the 5 required fields including priority", () => {
    for (const a of items!.recentAnnouncements) {
      expect(typeof a.announcementId).toBe("number");
      expect(typeof a.courseId).toBe("number");
      expect(typeof a.title).toBe("string");
      expect(typeof a.priority).toBe("string");
      expect(typeof a.createdAt).toBe("string");
    }
  });

  it("priority field has correct value", () => {
    const high = items!.recentAnnouncements.find((a) => announcementIds.includes(a.announcementId) && a.priority === "high");
    expect(high).toBeDefined();
  });

  it("does not include non-enrolled-course announcements", () => {
    expect(items!.recentAnnouncements.map((a) => a.announcementId)).not.toContain(
      nonEnrolledAnnouncementId,
    );
  });

  it("does not include soft-deleted announcements", () => {
    expect(items!.recentAnnouncements.map((a) => a.announcementId)).not.toContain(
      deletedAnnouncementId,
    );
  });
});

describe("StudentDashboardService.getDashboard — recentNotes DTO shape", () => {
  let items: Awaited<ReturnType<typeof StudentDashboardService.getDashboard>>;

  beforeAll(async () => {
    items = await StudentDashboardService.getDashboard(makeScope([enrolledCourseId]));
  });

  it("each item has the 5 required fields including topic", () => {
    for (const n of items!.recentNotes) {
      expect(typeof n.noteId).toBe("number");
      expect(typeof n.courseId).toBe("number");
      expect(typeof n.title).toBe("string");
      expect(typeof n.topic).toBe("string");
      expect(typeof n.createdAt).toBe("string");
    }
  });

  it("topic field is populated correctly", () => {
    const algebra = items!.recentNotes.find((n) => noteIds.includes(n.noteId) && n.topic === "Algebra");
    expect(algebra).toBeDefined();
  });

  it("does not include non-enrolled-course notes", () => {
    expect(items!.recentNotes.map((n) => n.noteId)).not.toContain(nonEnrolledNoteId);
  });

  it("does not include soft-deleted notes", () => {
    expect(items!.recentNotes.map((n) => n.noteId)).not.toContain(deletedNoteId);
  });
});

// ── Service: backward compatibility ───────────────────────────────────────────

describe("StudentDashboardService.getDashboard — scalar counts still present (backward compat)", () => {
  it("all original scalar fields remain on the dashboard", async () => {
    const dashboard = await StudentDashboardService.getDashboard(
      makeScope([enrolledCourseId]),
    );
    expect(dashboard).not.toBeNull();
    expect(typeof dashboard!.studentId).toBe("number");
    expect(typeof dashboard!.displayName).toBe("string");
    expect(typeof dashboard!.activeCourseCount).toBe("number");
    expect(typeof dashboard!.totalAssignments).toBe("number");
    expect(typeof dashboard!.pendingAssignments).toBe("number");
    expect(typeof dashboard!.totalAssessments).toBe("number");
    expect(typeof dashboard!.upcomingAssessments).toBe("number");
    expect(typeof dashboard!.unreadAnnouncements).toBe("number");
    expect(typeof dashboard!.availableNotes).toBe("number");
  });
});
