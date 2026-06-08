import { sql, eq, and, isNull } from "drizzle-orm";
import {
  db,
  assignmentsTable,
  assessmentsTable,
  announcementsTable,
  notesTable,
} from "@workspace/db";
import { getCourseById, type CourseRow } from "./courses.queries";

export type { CourseRow };

/**
 * Aggregate counts for a single course workspace.
 *
 * All values are non-negative integers.
 * Counts are bounded to the specific courseId + studentId pair passed in.
 */
export interface CourseWorkspaceCounts {
  totalAssignments: number;
  pendingAssignments: number;
  /** Assignments created within the last 7 days. */
  recentAssignments: number;

  totalAssessments: number;
  /**
   * Assessments created within the last 30 days.
   * Assessments are completed records; "upcoming" means recently recorded.
   */
  upcomingAssessments: number;

  totalAnnouncements: number;
  /** Announcements created within the last 7 days. */
  recentAnnouncements: number;

  totalNotes: number;
  /** Notes created within the last 7 days. */
  recentNotes: number;
}

/**
 * Repository: fetch course row for the workspace.
 *
 * Returns null for soft-deleted or non-existent courses.
 * Enrollment check is the service layer's responsibility.
 */
export async function getWorkspaceCourse(courseId: number): Promise<CourseRow | null> {
  return getCourseById(courseId);
}

/**
 * Repository: aggregate workspace counts for a student in a single course.
 *
 * Runs 4 queries in parallel — one per resource type.
 * All queries are bounded by the specific courseId:
 *   - Assignments and assessments: additionally filtered by studentId
 *     (these resources carry both course_id and student_id FKs)
 *   - Announcements and notes: course-scoped only (no student_id FK)
 *
 * Uses COUNT aggregates with conditional filters — no full-table fetches.
 *
 * @param courseId   - The enrolled course being accessed.
 * @param studentId  - The authenticated student (from scope.studentId).
 */
export async function getCourseWorkspaceCounts(
  courseId: number,
  studentId: number,
): Promise<CourseWorkspaceCounts> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [assignmentRows, assessmentRows, announcementRows, noteRows] = await Promise.all([
    db
      .select({
        total: sql<number>`COUNT(*)::int`,
        pending: sql<number>`COUNT(*) FILTER (WHERE ${assignmentsTable.status} = 'pending')::int`,
        recent: sql<number>`COUNT(*) FILTER (WHERE ${assignmentsTable.createdAt} >= ${sevenDaysAgo})::int`,
      })
      .from(assignmentsTable)
      .where(
        and(
          eq(assignmentsTable.courseId, courseId),
          eq(assignmentsTable.studentId, studentId),
          isNull(assignmentsTable.deletedAt),
        ),
      ),

    db
      .select({
        total: sql<number>`COUNT(*)::int`,
        upcoming: sql<number>`COUNT(*) FILTER (WHERE ${assessmentsTable.createdAt} >= ${thirtyDaysAgo})::int`,
      })
      .from(assessmentsTable)
      .where(
        and(
          eq(assessmentsTable.courseId, courseId),
          eq(assessmentsTable.studentId, studentId),
          isNull(assessmentsTable.deletedAt),
        ),
      ),

    db
      .select({
        total: sql<number>`COUNT(*)::int`,
        recent: sql<number>`COUNT(*) FILTER (WHERE ${announcementsTable.createdAt} >= ${sevenDaysAgo})::int`,
      })
      .from(announcementsTable)
      .where(
        and(
          eq(announcementsTable.courseId, courseId),
          isNull(announcementsTable.deletedAt),
        ),
      ),

    db
      .select({
        total: sql<number>`COUNT(*)::int`,
        recent: sql<number>`COUNT(*) FILTER (WHERE ${notesTable.createdAt} >= ${sevenDaysAgo})::int`,
      })
      .from(notesTable)
      .where(
        and(
          eq(notesTable.courseId, courseId),
          isNull(notesTable.deletedAt),
        ),
      ),
  ]);

  return {
    totalAssignments: assignmentRows[0]?.total ?? 0,
    pendingAssignments: assignmentRows[0]?.pending ?? 0,
    recentAssignments: assignmentRows[0]?.recent ?? 0,
    totalAssessments: assessmentRows[0]?.total ?? 0,
    upcomingAssessments: assessmentRows[0]?.upcoming ?? 0,
    totalAnnouncements: announcementRows[0]?.total ?? 0,
    recentAnnouncements: announcementRows[0]?.recent ?? 0,
    totalNotes: noteRows[0]?.total ?? 0,
    recentNotes: noteRows[0]?.recent ?? 0,
  };
}
