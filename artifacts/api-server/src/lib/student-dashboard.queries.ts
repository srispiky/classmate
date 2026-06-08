import { sql, eq, inArray, isNull, and } from "drizzle-orm";
import {
  db,
  studentsTable,
  coursesTable,
  assignmentsTable,
  assessmentsTable,
  announcementsTable,
  notesTable,
} from "@workspace/db";

/**
 * Lightweight aggregate counts returned to the service layer.
 * All values are non-negative integers.
 */
export interface StudentDashboardCounts {
  activeCourseCount: number;
  totalAssignments: number;
  pendingAssignments: number;
  totalAssessments: number;
  /**
   * Assessments created within the last 30 days.
   * Assessments in this system are completed-test records, not scheduled events.
   * "Upcoming" is interpreted as recently-recorded to surface new feedback.
   */
  upcomingAssessments: number;
  /**
   * Total active (non-deleted) announcements in enrolled courses.
   * The platform has no per-user read-tracking table, so all active
   * announcements are surfaced as potentially unread.
   */
  unreadAnnouncements: number;
  availableNotes: number;
}

/**
 * Look up the display name (student.name) for a given student record.
 * Returns null when no matching record is found.
 *
 * Uses an explicit column selection to avoid the student.user_id Drizzle/DB
 * schema gap (user_id exists in the ORM schema but not yet in the DB).
 */
export async function getStudentDisplayName(studentId: number): Promise<string | null> {
  const [row] = await db
    .select({ name: studentsTable.name })
    .from(studentsTable)
    .where(eq(studentsTable.id, studentId))
    .limit(1);
  return row?.name ?? null;
}

/**
 * Aggregate all dashboard counts for a student in a single call.
 *
 * Assignment and assessment queries are student-scoped (by student_id FK).
 * Course, announcement, and note queries are course-scoped (by enrolled course IDs).
 *
 * Queries run in two parallel batches:
 *   Batch 1 (always): assignments + assessments (student_id scoped, safe with no enrollments)
 *   Batch 2 (when enrolled): courses + announcements + notes (course_id scoped)
 *
 * Uses COUNT aggregate SQL — no full-table fetches. O(1) query complexity per resource.
 *
 * @param studentId        - The student's primary key in the students table.
 * @param enrolledCourseIds - Pre-computed list from ScopeContext.enrolledCourseIds.
 */
export async function getStudentDashboardCounts(
  studentId: number,
  enrolledCourseIds: number[],
): Promise<StudentDashboardCounts> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [assignmentRows, assessmentRows] = await Promise.all([
    db
      .select({
        total: sql<number>`COUNT(*)::int`,
        pending: sql<number>`COUNT(*) FILTER (WHERE ${assignmentsTable.status} = 'pending')::int`,
      })
      .from(assignmentsTable)
      .where(and(eq(assignmentsTable.studentId, studentId), isNull(assignmentsTable.deletedAt))),

    db
      .select({
        total: sql<number>`COUNT(*)::int`,
        recent: sql<number>`COUNT(*) FILTER (WHERE ${assessmentsTable.createdAt} >= ${thirtyDaysAgo})::int`,
      })
      .from(assessmentsTable)
      .where(and(eq(assessmentsTable.studentId, studentId), isNull(assessmentsTable.deletedAt))),
  ]);

  if (enrolledCourseIds.length === 0) {
    return {
      activeCourseCount: 0,
      totalAssignments: assignmentRows[0]?.total ?? 0,
      pendingAssignments: assignmentRows[0]?.pending ?? 0,
      totalAssessments: assessmentRows[0]?.total ?? 0,
      upcomingAssessments: assessmentRows[0]?.recent ?? 0,
      unreadAnnouncements: 0,
      availableNotes: 0,
    };
  }

  const [courseRows, announcementRows, noteRows] = await Promise.all([
    db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(coursesTable)
      .where(
        and(
          inArray(coursesTable.id, enrolledCourseIds),
          eq(coursesTable.status, "active"),
          isNull(coursesTable.deletedAt),
        ),
      ),

    db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(announcementsTable)
      .where(
        and(
          inArray(announcementsTable.courseId, enrolledCourseIds),
          isNull(announcementsTable.deletedAt),
        ),
      ),

    db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(notesTable)
      .where(
        and(
          inArray(notesTable.courseId, enrolledCourseIds),
          isNull(notesTable.deletedAt),
        ),
      ),
  ]);

  return {
    activeCourseCount: courseRows[0]?.count ?? 0,
    totalAssignments: assignmentRows[0]?.total ?? 0,
    pendingAssignments: assignmentRows[0]?.pending ?? 0,
    totalAssessments: assessmentRows[0]?.total ?? 0,
    upcomingAssessments: assessmentRows[0]?.recent ?? 0,
    unreadAnnouncements: announcementRows[0]?.count ?? 0,
    availableNotes: noteRows[0]?.count ?? 0,
  };
}
