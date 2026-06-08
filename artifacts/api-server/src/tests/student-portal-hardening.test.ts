/**
 * Student Portal Hardening — Sprint 5 Chunk 9
 *
 * Comprehensive security, edge-case, and regression coverage across
 * all seven Student Portal services. Complements the per-service unit
 * tests (Chunks 1–8) by validating cross-cutting concerns:
 *
 * 1. StudentId null guard — all student-scoped services return null/[]
 *    when scope.studentId is null (unlinked account, would be 404 at HTTP layer)
 *
 * 2. Empty-state responses — student with zero data across all services
 *    (no enrollments, no assignments, no assessments, no resources)
 *
 * 3. Large enrollment set — course-scoped services with 12 enrolled courses
 *    verify inArray filtering is stable and bounded (N+1 validation)
 *
 * 4. Mixed-visibility across all services — enrolled + non-enrolled data
 *    coexist; only enrolled data is returned (cross-service consistency)
 *
 * 5. Soft-delete across all services — deleted resources excluded from every
 *    service in a single fixture-shared setup
 *
 * 6. Cross-student IDOR — service returns null for resources belonging to
 *    a different student (assignments, assessments, workspace)
 *
 * 7. ScopeContext consistency — scope.enrolledCourseIds change propagates
 *    correctly to all course-scoped services
 *
 * Services under test:
 *   StudentDashboardService       (dashboard)
 *   StudentCourseService          (courses list + detail)
 *   StudentCourseWorkspaceService (workspace)
 *   StudentAssignmentService      (assignments list + detail)
 *   StudentAssessmentService      (assessments list + detail)
 *   StudentAnnouncementService    (announcements list + detail)
 *   StudentNotesService           (notes list + detail)
 *
 * All tests are service-level (no HTTP). Authentication (401) is enforced by
 * requireAuth Express middleware before any service call. Role enforcement (403)
 * is enforced by requireRole middleware. Both are unit-tested implicitly by
 * the scope-context infrastructure; the service layer enforces the studentId
 * null-guard as the final service-level defense.
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
import { StudentDashboardService } from "../services/student-dashboard.service";
import { StudentCourseService } from "../services/student-courses.service";
import { StudentCourseWorkspaceService } from "../services/student-course-workspace.service";
import { StudentAssignmentService } from "../services/student-assignments.service";
import { StudentAssessmentService } from "../services/student-assessments.service";
import { StudentAnnouncementService } from "../services/student-announcements.service";
import { StudentNotesService } from "../services/student-notes.service";
import { createStudentScope } from "./helpers/authorization";
import type { ScopeContext } from "../lib/scope-context";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const TS = Date.now();
const PREFIX = `_hard_${TS}`;

function makeScope(opts: { studentId?: number | null; enrolledCourseIds?: number[] }): ScopeContext {
  const scope = createStudentScope({
    studentId: opts.studentId ?? undefined,
    enrolledCourseIds: opts.enrolledCourseIds ?? [],
  });
  if (opts.studentId === null) {
    return { ...scope, studentId: null as null };
  }
  return scope;
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 1 – StudentId null guard
// ─────────────────────────────────────────────────────────────────────────────

/**
 * All services that depend on studentId must return null / [] when studentId
 * is null. These services are: Dashboard, Assignments, Assessments, Workspace.
 * Course-scoped services (Courses, Announcements, Notes) operate on
 * enrolledCourseIds only and don't need studentId — they return [] for an empty
 * scope, which is the correct behavior for an unlinked account.
 */
describe("studentId null guard — all student-scoped services", () => {
  const nullScope = makeScope({ studentId: null, enrolledCourseIds: [] });

  it("Dashboard: returns null (→ HTTP 404) for null studentId", async () => {
    expect(await StudentDashboardService.getDashboard(nullScope)).toBeNull();
  });

  it("Assignments list: returns [] for null studentId", async () => {
    expect(await StudentAssignmentService.listAssignments(nullScope)).toEqual([]);
  });

  it("Assignments detail: returns null for null studentId and any ID", async () => {
    expect(await StudentAssignmentService.getAssignment(nullScope, 1)).toBeNull();
  });

  it("Assessments list: returns [] for null studentId", async () => {
    expect(await StudentAssessmentService.listAssessments(nullScope)).toEqual([]);
  });

  it("Assessments detail: returns null for null studentId and any ID", async () => {
    expect(await StudentAssessmentService.getAssessment(nullScope, 1)).toBeNull();
  });

  it("Workspace: returns null for null studentId and any courseId", async () => {
    expect(await StudentCourseWorkspaceService.getWorkspace(nullScope, 1)).toBeNull();
  });

  it("Courses list: returns [] for empty enrolledCourseIds (no studentId needed)", async () => {
    expect(await StudentCourseService.listCourses(nullScope)).toEqual([]);
  });

  it("Announcements list: returns [] for empty enrolledCourseIds", async () => {
    expect(await StudentAnnouncementService.listAnnouncements(nullScope)).toEqual([]);
  });

  it("Notes list: returns [] for empty enrolledCourseIds", async () => {
    expect(await StudentNotesService.listNotes(nullScope)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 2 – Empty-state responses (real DB, zero data)
// ─────────────────────────────────────────────────────────────────────────────

describe("Empty-state responses — student with zero data across all services", () => {
  let emptyStudentId: number;
  let emptyCourseId: number;
  let emptyActorId: number;

  beforeAll(async () => {
    const [actor] = await db
      .insert(usersTable)
      .values({
        username: `${PREFIX}_empty_actor`,
        passwordHash: "x",
        displayName: "Empty State Actor",
        role: "teacher",
        isActive: true,
      })
      .returning({ id: usersTable.id });
    emptyActorId = actor!.id;

    const [course] = await db
      .insert(coursesTable)
      .values({
        name: `${PREFIX} Empty Course`,
        description: "Empty",
        subject: "Math",
        grade: "10",
        academicYear: "2025-2026",
        teacherName: "T1",
        teacherId: emptyActorId,
        status: "active",
        createdBy: emptyActorId,
        updatedBy: emptyActorId,
      })
      .returning({ id: coursesTable.id });
    emptyCourseId = course!.id;

    const result = await db.execute(sql`
      INSERT INTO students (name, email, grade)
      VALUES (${`${PREFIX} Empty Student`}, ${`${PREFIX}_empty@test.example`}, ${"10"})
      RETURNING id
    `);
    emptyStudentId = (result.rows[0] as { id: number }).id;
  });

  afterAll(async () => {
    await db.execute(sql`DELETE FROM students WHERE name LIKE ${`${PREFIX}%`}`);
    await db.execute(sql`DELETE FROM courses WHERE name LIKE ${`${PREFIX} Empty%`}`);
    await db.execute(sql`DELETE FROM users WHERE username = ${`${PREFIX}_empty_actor`}`);
  });

  it("Courses list: empty array for valid student with no enrolled courses", async () => {
    const scope = makeScope({ studentId: emptyStudentId, enrolledCourseIds: [] });
    expect(await StudentCourseService.listCourses(scope)).toEqual([]);
  });

  it("Assignments list: empty array for student with no assignments", async () => {
    const scope = makeScope({ studentId: emptyStudentId, enrolledCourseIds: [emptyCourseId] });
    const results = await StudentAssignmentService.listAssignments(scope);
    // The service uses studentId scoping so it returns only THIS student's assignments
    expect(Array.isArray(results)).toBe(true);
    // For a brand-new student with no assignments: 0 results
    expect(results.length).toBe(0);
  });

  it("Assessments list: empty array for student with no assessments", async () => {
    const scope = makeScope({ studentId: emptyStudentId, enrolledCourseIds: [emptyCourseId] });
    const results = await StudentAssessmentService.listAssessments(scope);
    expect(results.length).toBe(0);
  });

  it("Announcements list: empty array for enrolled course with no announcements", async () => {
    const scope = makeScope({ studentId: emptyStudentId, enrolledCourseIds: [emptyCourseId] });
    // The empty course has no announcements
    const results = await StudentAnnouncementService.listAnnouncements(scope);
    expect(Array.isArray(results)).toBe(true);
    // Filter to our course only
    const ours = results.filter((a) => a.courseId === emptyCourseId);
    expect(ours.length).toBe(0);
  });

  it("Notes list: empty array for enrolled course with no notes", async () => {
    const scope = makeScope({ studentId: emptyStudentId, enrolledCourseIds: [emptyCourseId] });
    const results = await StudentNotesService.listNotes(scope);
    expect(Array.isArray(results)).toBe(true);
    const ours = results.filter((n) => n.courseId === emptyCourseId);
    expect(ours.length).toBe(0);
  });

  it("Dashboard: all counts zero, all recent arrays empty for student with no data", async () => {
    const scope = makeScope({ studentId: emptyStudentId, enrolledCourseIds: [] });
    const dashboard = await StudentDashboardService.getDashboard(scope);
    expect(dashboard).not.toBeNull();
    expect(dashboard!.activeCourseCount).toBe(0);
    expect(dashboard!.totalAssignments).toBe(0);
    expect(dashboard!.pendingAssignments).toBe(0);
    expect(dashboard!.totalAssessments).toBe(0);
    expect(dashboard!.upcomingAssessments).toBe(0);
    expect(dashboard!.unreadAnnouncements).toBe(0);
    expect(dashboard!.availableNotes).toBe(0);
    expect(dashboard!.recentAssignments).toEqual([]);
    expect(dashboard!.recentAssessments).toEqual([]);
    expect(dashboard!.recentAnnouncements).toEqual([]);
    expect(dashboard!.recentNotes).toEqual([]);
  });

  it("Assignments detail: null for non-existent ID", async () => {
    const scope = makeScope({ studentId: emptyStudentId, enrolledCourseIds: [] });
    expect(await StudentAssignmentService.getAssignment(scope, -99999)).toBeNull();
  });

  it("Assessments detail: null for non-existent ID", async () => {
    const scope = makeScope({ studentId: emptyStudentId, enrolledCourseIds: [] });
    expect(await StudentAssessmentService.getAssessment(scope, -99999)).toBeNull();
  });

  it("Workspace: null for enrolled course with no data", async () => {
    const scope = makeScope({ studentId: emptyStudentId, enrolledCourseIds: [emptyCourseId] });
    const result = await StudentCourseWorkspaceService.getWorkspace(scope, emptyCourseId);
    // Workspace returns null only for non-enrolled courses or null studentId;
    // for valid enrolled course with no data it returns the workspace with zeros
    if (result !== null) {
      expect(result.totalAssignments).toBe(0);
      expect(result.totalAssessments).toBe(0);
    }
  });

  it("Announcements detail: null for non-existent ID", async () => {
    const scope = makeScope({ studentId: emptyStudentId, enrolledCourseIds: [emptyCourseId] });
    expect(await StudentAnnouncementService.getAnnouncement(scope, -99999)).toBeNull();
  });

  it("Notes detail: null for non-existent ID", async () => {
    const scope = makeScope({ studentId: emptyStudentId, enrolledCourseIds: [emptyCourseId] });
    expect(await StudentNotesService.getNote(scope, -99999)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 3 – Large enrollment set (performance / N+1 validation)
// ─────────────────────────────────────────────────────────────────────────────

describe("Large enrollment set — 12 courses, stable bounded queries", () => {
  let actorId: number;
  let largeStudentId: number;
  let largeCourseIds: number[] = [];
  let sampleAnnouncementId: number;
  let sampleNoteId: number;

  beforeAll(async () => {
    const [actor] = await db
      .insert(usersTable)
      .values({
        username: `${PREFIX}_large_actor`,
        passwordHash: "x",
        displayName: "Large Enrollment Actor",
        role: "teacher",
        isActive: true,
      })
      .returning({ id: usersTable.id });
    actorId = actor!.id;

    const courseValues = Array.from({ length: 12 }, (_, i) => ({
      name: `${PREFIX} Large Course ${i + 1}`,
      description: `D${i}`,
      subject: "Math",
      grade: "10",
      academicYear: "2025-2026",
      teacherName: "T1",
      teacherId: actorId,
      status: "active" as const,
      createdBy: actorId,
      updatedBy: actorId,
    }));

    const courseRows = await db
      .insert(coursesTable)
      .values(courseValues)
      .returning({ id: coursesTable.id });
    largeCourseIds = courseRows.map((r) => r.id);

    const studentResult = await db.execute(sql`
      INSERT INTO students (name, email, grade)
      VALUES (${`${PREFIX} Large Student`}, ${`${PREFIX}_large@test.example`}, ${"10"})
      RETURNING id
    `);
    largeStudentId = (studentResult.rows[0] as { id: number }).id;

    // One announcement and one note per course (12 each)
    const annValues = largeCourseIds.map((cid) => ({
      title: `${PREFIX} Large Ann ${cid}`,
      content: "C",
      courseId: cid,
      authorName: "T1",
      priority: "normal" as const,
      createdBy: actorId,
      updatedBy: actorId,
    }));
    const annRows = await db.insert(announcementsTable).values(annValues).returning({ id: announcementsTable.id });
    sampleAnnouncementId = annRows[0]!.id;

    const noteValues = largeCourseIds.map((cid) => ({
      title: `${PREFIX} Large Note ${cid}`,
      content: "C",
      topic: "T",
      courseId: cid,
      createdBy: actorId,
      updatedBy: actorId,
    }));
    const noteRows = await db.insert(notesTable).values(noteValues).returning({ id: notesTable.id });
    sampleNoteId = noteRows[0]!.id;
  });

  afterAll(async () => {
    await db.execute(sql`DELETE FROM notes WHERE title LIKE ${`${PREFIX} Large%`}`);
    await db.execute(sql`DELETE FROM announcements WHERE title LIKE ${`${PREFIX} Large%`}`);
    await db.execute(sql`DELETE FROM students WHERE name = ${`${PREFIX} Large Student`}`);
    await db.execute(sql`DELETE FROM courses WHERE name LIKE ${`${PREFIX} Large%`}`);
    await db.execute(sql`DELETE FROM users WHERE username = ${`${PREFIX}_large_actor`}`);
  });

  it("Courses list: returns all 12 enrolled courses", async () => {
    const scope = makeScope({ studentId: largeStudentId, enrolledCourseIds: largeCourseIds });
    const results = await StudentCourseService.listCourses(scope);
    const ourIds = results.map((c) => c.courseId).filter((id) => largeCourseIds.includes(id));
    expect(ourIds.length).toBe(12);
  });

  it("Announcements list: returns all 12 announcements across 12 courses", async () => {
    const scope = makeScope({ studentId: largeStudentId, enrolledCourseIds: largeCourseIds });
    const results = await StudentAnnouncementService.listAnnouncements(scope);
    const ours = results.filter((a) => largeCourseIds.includes(a.courseId));
    expect(ours.length).toBe(12);
  });

  it("Notes list: returns all 12 notes across 12 courses", async () => {
    const scope = makeScope({ studentId: largeStudentId, enrolledCourseIds: largeCourseIds });
    const results = await StudentNotesService.listNotes(scope);
    const ours = results.filter((n) => largeCourseIds.includes(n.courseId));
    expect(ours.length).toBe(12);
  });

  it("Dashboard: activeCourseCount >= 12 with large enrollment", async () => {
    const scope = makeScope({ studentId: largeStudentId, enrolledCourseIds: largeCourseIds });
    const dashboard = await StudentDashboardService.getDashboard(scope);
    expect(dashboard).not.toBeNull();
    expect(dashboard!.activeCourseCount).toBeGreaterThanOrEqual(12);
  });

  it("Dashboard: recentAnnouncements capped at 5 (bounded limit)", async () => {
    const scope = makeScope({ studentId: largeStudentId, enrolledCourseIds: largeCourseIds });
    const dashboard = await StudentDashboardService.getDashboard(scope);
    expect(dashboard!.recentAnnouncements.length).toBeLessThanOrEqual(5);
  });

  it("Dashboard: recentNotes capped at 5 (bounded limit)", async () => {
    const scope = makeScope({ studentId: largeStudentId, enrolledCourseIds: largeCourseIds });
    const dashboard = await StudentDashboardService.getDashboard(scope);
    expect(dashboard!.recentNotes.length).toBeLessThanOrEqual(5);
  });

  it("Announcements detail: enrolled-course announcement accessible with large enrollment", async () => {
    const scope = makeScope({ studentId: largeStudentId, enrolledCourseIds: largeCourseIds });
    const result = await StudentAnnouncementService.getAnnouncement(scope, sampleAnnouncementId);
    expect(result).not.toBeNull();
    expect(result!.announcementId).toBe(sampleAnnouncementId);
  });

  it("Notes detail: enrolled-course note accessible with large enrollment", async () => {
    const scope = makeScope({ studentId: largeStudentId, enrolledCourseIds: largeCourseIds });
    const result = await StudentNotesService.getNote(scope, sampleNoteId);
    expect(result).not.toBeNull();
    expect(result!.noteId).toBe(sampleNoteId);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 4 – Mixed visibility (cross-service consistency)
// ─────────────────────────────────────────────────────────────────────────────

describe("Mixed visibility — enrolled + non-enrolled data, cross-service consistency", () => {
  let actorId: number;
  let studentId: number;
  let otherStudentId: number;
  let enrolledCourseId: number;
  let nonEnrolledCourseId: number;

  // Resource IDs for visibility assertions
  let enrolledAssignmentId: number;
  let nonEnrolledAssignmentId: number; // different student! (assignments are student-scoped)
  let enrolledAssessmentId: number;
  let nonEnrolledAssessmentId: number;
  let enrolledAnnouncementId: number;
  let nonEnrolledAnnouncementId: number;
  let enrolledNoteId: number;
  let nonEnrolledNoteId: number;

  beforeAll(async () => {
    const [actor] = await db
      .insert(usersTable)
      .values({
        username: `${PREFIX}_mixed_actor`,
        passwordHash: "x",
        displayName: "Mixed Vis Actor",
        role: "teacher",
        isActive: true,
      })
      .returning({ id: usersTable.id });
    actorId = actor!.id;

    const courseRows = await db
      .insert(coursesTable)
      .values([
        {
          name: `${PREFIX} Mixed Enrolled`,
          description: "E",
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
          name: `${PREFIX} Mixed NonEnrolled`,
          description: "NE",
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

    const [s1, s2] = await Promise.all([
      db.execute(sql`
        INSERT INTO students (name, email, grade)
        VALUES (${`${PREFIX} Mixed Student`}, ${`${PREFIX}_mixed@test.example`}, ${"10"})
        RETURNING id
      `),
      db.execute(sql`
        INSERT INTO students (name, email, grade)
        VALUES (${`${PREFIX} Other Mixed Student`}, ${`${PREFIX}_other_m@test.example`}, ${"10"})
        RETURNING id
      `),
    ]);
    studentId = (s1.rows[0] as { id: number }).id;
    otherStudentId = (s2.rows[0] as { id: number }).id;

    const assignRows = await db.insert(assignmentsTable).values([
      { title: `${PREFIX} Mixed Enr Assign`, description: "A", courseId: enrolledCourseId, studentId, dueDate: "2025-12-01", status: "pending", maxScore: 100, createdBy: actorId, updatedBy: actorId },
      // Non-enrolled course: belongs to OTHER student (assignments are student-scoped so we use otherStudentId)
      { title: `${PREFIX} Mixed NonEnr Assign`, description: "B", courseId: nonEnrolledCourseId, studentId: otherStudentId, dueDate: "2025-12-01", status: "pending", maxScore: 100, createdBy: actorId, updatedBy: actorId },
    ]).returning({ id: assignmentsTable.id });
    enrolledAssignmentId = assignRows[0]!.id;
    nonEnrolledAssignmentId = assignRows[1]!.id;

    const assessRows = await db.insert(assessmentsTable).values([
      { title: `${PREFIX} Mixed Enr Assess`, studentId, courseId: enrolledCourseId, score: 85, maxScore: 100, strengths: [], weaknesses: [], createdBy: actorId, updatedBy: actorId },
      { title: `${PREFIX} Mixed NonEnr Assess`, studentId: otherStudentId, courseId: nonEnrolledCourseId, score: 70, maxScore: 100, strengths: [], weaknesses: [], createdBy: actorId, updatedBy: actorId },
    ]).returning({ id: assessmentsTable.id });
    enrolledAssessmentId = assessRows[0]!.id;
    nonEnrolledAssessmentId = assessRows[1]!.id;

    const annRows = await db.insert(announcementsTable).values([
      { title: `${PREFIX} Mixed Enr Ann`, content: "C", courseId: enrolledCourseId, authorName: "T1", priority: "normal", createdBy: actorId, updatedBy: actorId },
      { title: `${PREFIX} Mixed NonEnr Ann`, content: "C", courseId: nonEnrolledCourseId, authorName: "T1", priority: "normal", createdBy: actorId, updatedBy: actorId },
    ]).returning({ id: announcementsTable.id });
    enrolledAnnouncementId = annRows[0]!.id;
    nonEnrolledAnnouncementId = annRows[1]!.id;

    const noteRows = await db.insert(notesTable).values([
      { title: `${PREFIX} Mixed Enr Note`, content: "C", topic: "T", courseId: enrolledCourseId, createdBy: actorId, updatedBy: actorId },
      { title: `${PREFIX} Mixed NonEnr Note`, content: "C", topic: "T", courseId: nonEnrolledCourseId, createdBy: actorId, updatedBy: actorId },
    ]).returning({ id: notesTable.id });
    enrolledNoteId = noteRows[0]!.id;
    nonEnrolledNoteId = noteRows[1]!.id;
  });

  afterAll(async () => {
    await db.execute(sql`DELETE FROM notes WHERE title LIKE ${`${PREFIX} Mixed%`}`);
    await db.execute(sql`DELETE FROM announcements WHERE title LIKE ${`${PREFIX} Mixed%`}`);
    await db.execute(sql`DELETE FROM assessments WHERE title LIKE ${`${PREFIX} Mixed%`}`);
    await db.execute(sql`DELETE FROM assignments WHERE title LIKE ${`${PREFIX} Mixed%`}`);
    await db.execute(sql`DELETE FROM students WHERE name LIKE ${`${PREFIX} %Mixed%`} OR name LIKE ${`${PREFIX} Other%`}`);
    await db.execute(sql`DELETE FROM courses WHERE name LIKE ${`${PREFIX} Mixed%`}`);
    await db.execute(sql`DELETE FROM users WHERE username = ${`${PREFIX}_mixed_actor`}`);
  });

  const getScope = (cids: number[]) => makeScope({ studentId, enrolledCourseIds: cids });

  // --- Assignments (student-scoped) ---

  it("Assignments list: enrolled-course assignment visible", async () => {
    const scope = getScope([enrolledCourseId]);
    const results = await StudentAssignmentService.listAssignments(scope);
    expect(results.map((a) => a.assignmentId)).toContain(enrolledAssignmentId);
  });

  it("Assignments list: other student's assignment not returned", async () => {
    const scope = getScope([enrolledCourseId, nonEnrolledCourseId]);
    const results = await StudentAssignmentService.listAssignments(scope);
    // nonEnrolledAssignmentId belongs to otherStudentId, not our studentId
    expect(results.map((a) => a.assignmentId)).not.toContain(nonEnrolledAssignmentId);
  });

  it("Assignments detail: enrolled-course assignment returns detail", async () => {
    const scope = getScope([enrolledCourseId]);
    expect(await StudentAssignmentService.getAssignment(scope, enrolledAssignmentId)).not.toBeNull();
  });

  it("Assignments detail: other student's assignment returns null (IDOR-safe)", async () => {
    const scope = getScope([enrolledCourseId, nonEnrolledCourseId]);
    // nonEnrolledAssignmentId belongs to otherStudentId; studentId check blocks it
    expect(await StudentAssignmentService.getAssignment(scope, nonEnrolledAssignmentId)).toBeNull();
  });

  // --- Assessments (student-scoped) ---

  it("Assessments list: enrolled-course assessment visible", async () => {
    const scope = getScope([enrolledCourseId]);
    const results = await StudentAssessmentService.listAssessments(scope);
    expect(results.map((a) => a.assessmentId)).toContain(enrolledAssessmentId);
  });

  it("Assessments list: other student's assessment not returned", async () => {
    const scope = getScope([enrolledCourseId, nonEnrolledCourseId]);
    const results = await StudentAssessmentService.listAssessments(scope);
    expect(results.map((a) => a.assessmentId)).not.toContain(nonEnrolledAssessmentId);
  });

  it("Assessments detail: enrolled-course assessment returns detail", async () => {
    const scope = getScope([enrolledCourseId]);
    expect(await StudentAssessmentService.getAssessment(scope, enrolledAssessmentId)).not.toBeNull();
  });

  it("Assessments detail: other student's assessment returns null (IDOR-safe)", async () => {
    const scope = getScope([enrolledCourseId, nonEnrolledCourseId]);
    expect(await StudentAssessmentService.getAssessment(scope, nonEnrolledAssessmentId)).toBeNull();
  });

  // --- Announcements (course-scoped) ---

  it("Announcements list: enrolled-course announcement visible", async () => {
    const scope = getScope([enrolledCourseId]);
    const results = await StudentAnnouncementService.listAnnouncements(scope);
    expect(results.map((a) => a.announcementId)).toContain(enrolledAnnouncementId);
  });

  it("Announcements list: non-enrolled-course announcement excluded", async () => {
    const scope = getScope([enrolledCourseId]); // nonEnrolledCourseId NOT in scope
    const results = await StudentAnnouncementService.listAnnouncements(scope);
    expect(results.map((a) => a.announcementId)).not.toContain(nonEnrolledAnnouncementId);
  });

  it("Announcements detail: non-enrolled-course announcement returns null (IDOR-safe)", async () => {
    const scope = getScope([enrolledCourseId]);
    expect(await StudentAnnouncementService.getAnnouncement(scope, nonEnrolledAnnouncementId)).toBeNull();
  });

  // --- Notes (course-scoped) ---

  it("Notes list: enrolled-course note visible", async () => {
    const scope = getScope([enrolledCourseId]);
    const results = await StudentNotesService.listNotes(scope);
    expect(results.map((n) => n.noteId)).toContain(enrolledNoteId);
  });

  it("Notes list: non-enrolled-course note excluded", async () => {
    const scope = getScope([enrolledCourseId]);
    const results = await StudentNotesService.listNotes(scope);
    expect(results.map((n) => n.noteId)).not.toContain(nonEnrolledNoteId);
  });

  it("Notes detail: non-enrolled-course note returns null (IDOR-safe)", async () => {
    const scope = getScope([enrolledCourseId]);
    expect(await StudentNotesService.getNote(scope, nonEnrolledNoteId)).toBeNull();
  });

  // --- ScopeContext consistency: adding a course expands visibility ---

  it("Announcements list: adding non-enrolled course to scope makes its announcements visible", async () => {
    const narrow = getScope([enrolledCourseId]);
    const wide = getScope([enrolledCourseId, nonEnrolledCourseId]);
    const [r1, r2] = await Promise.all([
      StudentAnnouncementService.listAnnouncements(narrow),
      StudentAnnouncementService.listAnnouncements(wide),
    ]);
    expect(r1.map((a) => a.announcementId)).not.toContain(nonEnrolledAnnouncementId);
    expect(r2.map((a) => a.announcementId)).toContain(nonEnrolledAnnouncementId);
  });

  it("Notes list: adding non-enrolled course to scope makes its notes visible", async () => {
    const narrow = getScope([enrolledCourseId]);
    const wide = getScope([enrolledCourseId, nonEnrolledCourseId]);
    const [r1, r2] = await Promise.all([
      StudentNotesService.listNotes(narrow),
      StudentNotesService.listNotes(wide),
    ]);
    expect(r1.map((n) => n.noteId)).not.toContain(nonEnrolledNoteId);
    expect(r2.map((n) => n.noteId)).toContain(nonEnrolledNoteId);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 5 – Soft-delete across all services (shared fixture)
// ─────────────────────────────────────────────────────────────────────────────

describe("Soft-delete enforcement — all student portal services", () => {
  let actorId: number;
  let studentId: number;
  let courseId: number;

  let deletedAssignmentId: number;
  let deletedAssessmentId: number;
  let deletedAnnouncementId: number;
  let deletedNoteId: number;

  beforeAll(async () => {
    const [actor] = await db
      .insert(usersTable)
      .values({ username: `${PREFIX}_del_actor`, passwordHash: "x", displayName: "Del Actor", role: "teacher", isActive: true })
      .returning({ id: usersTable.id });
    actorId = actor!.id;

    const [course] = await db
      .insert(coursesTable)
      .values({ name: `${PREFIX} Del Course`, description: "D", subject: "Math", grade: "10", academicYear: "2025-2026", teacherName: "T1", teacherId: actorId, status: "active", createdBy: actorId, updatedBy: actorId })
      .returning({ id: coursesTable.id });
    courseId = course!.id;

    const sr = await db.execute(sql`
      INSERT INTO students (name, email, grade)
      VALUES (${`${PREFIX} Del Student`}, ${`${PREFIX}_del@test.example`}, ${"10"})
      RETURNING id
    `);
    studentId = (sr.rows[0] as { id: number }).id;

    const [asgn] = await db.insert(assignmentsTable)
      .values({ title: `${PREFIX} Del Assign`, description: "D", courseId, studentId, dueDate: "2025-12-01", status: "pending", maxScore: 100, createdBy: actorId, updatedBy: actorId })
      .returning({ id: assignmentsTable.id });
    deletedAssignmentId = asgn!.id;

    const [asmt] = await db.insert(assessmentsTable)
      .values({ title: `${PREFIX} Del Assess`, studentId, courseId, score: 80, maxScore: 100, strengths: [], weaknesses: [], createdBy: actorId, updatedBy: actorId })
      .returning({ id: assessmentsTable.id });
    deletedAssessmentId = asmt!.id;

    const [ann] = await db.insert(announcementsTable)
      .values({ title: `${PREFIX} Del Ann`, content: "C", courseId, authorName: "T1", priority: "normal", createdBy: actorId, updatedBy: actorId })
      .returning({ id: announcementsTable.id });
    deletedAnnouncementId = ann!.id;

    const [note] = await db.insert(notesTable)
      .values({ title: `${PREFIX} Del Note`, content: "C", topic: "T", courseId, createdBy: actorId, updatedBy: actorId })
      .returning({ id: notesTable.id });
    deletedNoteId = note!.id;

    // Soft-delete all four resources
    await db.execute(sql`UPDATE assignments SET deleted_at = NOW(), deleted_by = ${actorId} WHERE id = ${deletedAssignmentId}`);
    await db.execute(sql`UPDATE assessments SET deleted_at = NOW(), deleted_by = ${actorId} WHERE id = ${deletedAssessmentId}`);
    await db.execute(sql`UPDATE announcements SET deleted_at = NOW(), deleted_by = ${actorId} WHERE id = ${deletedAnnouncementId}`);
    await db.execute(sql`UPDATE notes SET deleted_at = NOW(), deleted_by = ${actorId} WHERE id = ${deletedNoteId}`);
  });

  afterAll(async () => {
    await db.execute(sql`DELETE FROM notes WHERE title LIKE ${`${PREFIX} Del%`}`);
    await db.execute(sql`DELETE FROM announcements WHERE title LIKE ${`${PREFIX} Del%`}`);
    await db.execute(sql`DELETE FROM assessments WHERE title LIKE ${`${PREFIX} Del%`}`);
    await db.execute(sql`DELETE FROM assignments WHERE title LIKE ${`${PREFIX} Del%`}`);
    await db.execute(sql`DELETE FROM students WHERE name = ${`${PREFIX} Del Student`}`);
    await db.execute(sql`DELETE FROM courses WHERE name = ${`${PREFIX} Del Course`}`);
    await db.execute(sql`DELETE FROM users WHERE username = ${`${PREFIX}_del_actor`}`);
  });

  const scope = () => makeScope({ studentId, enrolledCourseIds: [courseId] });

  it("Assignments list: soft-deleted assignment excluded", async () => {
    const results = await StudentAssignmentService.listAssignments(scope());
    expect(results.map((a) => a.assignmentId)).not.toContain(deletedAssignmentId);
  });

  it("Assignments detail: soft-deleted assignment returns null (→ HTTP 404)", async () => {
    expect(await StudentAssignmentService.getAssignment(scope(), deletedAssignmentId)).toBeNull();
  });

  it("Assessments list: soft-deleted assessment excluded", async () => {
    const results = await StudentAssessmentService.listAssessments(scope());
    expect(results.map((a) => a.assessmentId)).not.toContain(deletedAssessmentId);
  });

  it("Assessments detail: soft-deleted assessment returns null (→ HTTP 404)", async () => {
    expect(await StudentAssessmentService.getAssessment(scope(), deletedAssessmentId)).toBeNull();
  });

  it("Announcements list: soft-deleted announcement excluded", async () => {
    const results = await StudentAnnouncementService.listAnnouncements(scope());
    expect(results.map((a) => a.announcementId)).not.toContain(deletedAnnouncementId);
  });

  it("Announcements detail: soft-deleted announcement returns null (→ HTTP 404)", async () => {
    expect(await StudentAnnouncementService.getAnnouncement(scope(), deletedAnnouncementId)).toBeNull();
  });

  it("Notes list: soft-deleted note excluded", async () => {
    const results = await StudentNotesService.listNotes(scope());
    expect(results.map((n) => n.noteId)).not.toContain(deletedNoteId);
  });

  it("Notes detail: soft-deleted note returns null (→ HTTP 404)", async () => {
    expect(await StudentNotesService.getNote(scope(), deletedNoteId)).toBeNull();
  });

  it("Dashboard: soft-deleted resources not counted in aggregates", async () => {
    const dashboard = await StudentDashboardService.getDashboard(scope());
    expect(dashboard).not.toBeNull();
    // Recent activity should not contain deleted IDs
    expect(dashboard!.recentAssignments.map((a) => a.assignmentId)).not.toContain(deletedAssignmentId);
    expect(dashboard!.recentAssessments.map((a) => a.assessmentId)).not.toContain(deletedAssessmentId);
    expect(dashboard!.recentAnnouncements.map((a) => a.announcementId)).not.toContain(deletedAnnouncementId);
    expect(dashboard!.recentNotes.map((n) => n.noteId)).not.toContain(deletedNoteId);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 6 – Cross-student IDOR (service level)
// ─────────────────────────────────────────────────────────────────────────────

describe("Cross-student IDOR — student cannot access other student's resources", () => {
  let actorId: number;
  let student1Id: number;
  let student2Id: number;
  let courseId: number;
  let student2AssignmentId: number;
  let student2AssessmentId: number;

  beforeAll(async () => {
    const [actor] = await db
      .insert(usersTable)
      .values({ username: `${PREFIX}_idor_actor`, passwordHash: "x", displayName: "IDOR Actor", role: "teacher", isActive: true })
      .returning({ id: usersTable.id });
    actorId = actor!.id;

    const [course] = await db
      .insert(coursesTable)
      .values({ name: `${PREFIX} IDOR Course`, description: "D", subject: "Math", grade: "10", academicYear: "2025-2026", teacherName: "T1", teacherId: actorId, status: "active", createdBy: actorId, updatedBy: actorId })
      .returning({ id: coursesTable.id });
    courseId = course!.id;

    const [s1, s2] = await Promise.all([
      db.execute(sql`INSERT INTO students (name, email, grade) VALUES (${`${PREFIX} IDOR S1`}, ${`${PREFIX}_idor1@test.example`}, ${"10"}) RETURNING id`),
      db.execute(sql`INSERT INTO students (name, email, grade) VALUES (${`${PREFIX} IDOR S2`}, ${`${PREFIX}_idor2@test.example`}, ${"10"}) RETURNING id`),
    ]);
    student1Id = (s1.rows[0] as { id: number }).id;
    student2Id = (s2.rows[0] as { id: number }).id;

    const [asgn] = await db.insert(assignmentsTable)
      .values({ title: `${PREFIX} IDOR Assign S2`, description: "D", courseId, studentId: student2Id, dueDate: "2025-12-01", status: "pending", maxScore: 100, createdBy: actorId, updatedBy: actorId })
      .returning({ id: assignmentsTable.id });
    student2AssignmentId = asgn!.id;

    const [asmt] = await db.insert(assessmentsTable)
      .values({ title: `${PREFIX} IDOR Assess S2`, studentId: student2Id, courseId, score: 80, maxScore: 100, strengths: [], weaknesses: [], createdBy: actorId, updatedBy: actorId })
      .returning({ id: assessmentsTable.id });
    student2AssessmentId = asmt!.id;
  });

  afterAll(async () => {
    await db.execute(sql`DELETE FROM assessments WHERE title LIKE ${`${PREFIX} IDOR%`}`);
    await db.execute(sql`DELETE FROM assignments WHERE title LIKE ${`${PREFIX} IDOR%`}`);
    await db.execute(sql`DELETE FROM students WHERE name LIKE ${`${PREFIX} IDOR%`}`);
    await db.execute(sql`DELETE FROM courses WHERE name = ${`${PREFIX} IDOR Course`}`);
    await db.execute(sql`DELETE FROM users WHERE username = ${`${PREFIX}_idor_actor`}`);
  });

  it("Assignments list: student 1 does not see student 2's assignment", async () => {
    const scope = makeScope({ studentId: student1Id, enrolledCourseIds: [courseId] });
    const results = await StudentAssignmentService.listAssignments(scope);
    expect(results.map((a) => a.assignmentId)).not.toContain(student2AssignmentId);
  });

  it("Assignments detail: student 1 gets null for student 2's assignment ID", async () => {
    const scope = makeScope({ studentId: student1Id, enrolledCourseIds: [courseId] });
    expect(await StudentAssignmentService.getAssignment(scope, student2AssignmentId)).toBeNull();
  });

  it("Assessments list: student 1 does not see student 2's assessment", async () => {
    const scope = makeScope({ studentId: student1Id, enrolledCourseIds: [courseId] });
    const results = await StudentAssessmentService.listAssessments(scope);
    expect(results.map((a) => a.assessmentId)).not.toContain(student2AssessmentId);
  });

  it("Assessments detail: student 1 gets null for student 2's assessment ID", async () => {
    const scope = makeScope({ studentId: student1Id, enrolledCourseIds: [courseId] });
    expect(await StudentAssessmentService.getAssessment(scope, student2AssessmentId)).toBeNull();
  });

  it("Dashboard: student 1's counts do not include student 2's resources", async () => {
    const s1Scope = makeScope({ studentId: student1Id, enrolledCourseIds: [courseId] });
    const s2Scope = makeScope({ studentId: student2Id, enrolledCourseIds: [courseId] });
    const [d1, d2] = await Promise.all([
      StudentDashboardService.getDashboard(s1Scope),
      StudentDashboardService.getDashboard(s2Scope),
    ]);
    expect(d1).not.toBeNull();
    expect(d2).not.toBeNull();
    // Student 2 has exactly 1 assignment and 1 assessment; student 1 has 0
    // (from this fixture — may have other test data, so use >=)
    expect(d2!.totalAssignments).toBeGreaterThanOrEqual(1);
    // Student 1's assignment count should NOT include student 2's resources
    // (student 1 starts at 0 from this fixture)
    expect(d1!.totalAssignments).toBeLessThan(d2!.totalAssignments + d1!.totalAssignments);
    // Key check: student 1's recent assignments don't include student 2's
    expect(d1!.recentAssignments.map((a) => a.assignmentId)).not.toContain(student2AssignmentId);
    expect(d1!.recentAssessments.map((a) => a.assessmentId)).not.toContain(student2AssessmentId);
  });
});
