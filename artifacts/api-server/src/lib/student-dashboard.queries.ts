import { sql, eq, inArray, isNull, and, desc } from "drizzle-orm";
import {
  db,
  studentsTable,
  coursesTable,
  assignmentsTable,
  assessmentsTable,
  announcementsTable,
  notesTable,
} from "@workspace/db";

// ── Scalar count types ────────────────────────────────────────────────────────

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

// ── Recent activity row types ─────────────────────────────────────────────────

export interface RecentAssignmentRow {
  id: number;
  courseId: number;
  title: string;
  dueDate: string;
  createdAt: Date;
}

export interface RecentAssessmentRow {
  id: number;
  courseId: number;
  title: string;
  createdAt: Date;
}

export interface RecentAnnouncementRow {
  id: number;
  courseId: number;
  title: string;
  priority: string;
  createdAt: Date;
}

export interface RecentNoteRow {
  id: number;
  courseId: number;
  title: string;
  topic: string;
  createdAt: Date;
}

export interface StudentDashboardRecentActivity {
  recentAssignments: RecentAssignmentRow[];
  recentAssessments: RecentAssessmentRow[];
  recentAnnouncements: RecentAnnouncementRow[];
  recentNotes: RecentNoteRow[];
}

// ── Queries ───────────────────────────────────────────────────────────────────

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

/**
 * Fetch recent activity collections for the dashboard in a single parallelised call.
 *
 * Runs four queries in parallel:
 *   - recent assignments (student-scoped, always runs)
 *   - recent assessments (student-scoped, always runs)
 *   - recent announcements (course-scoped, empty array when no enrollment)
 *   - recent notes (course-scoped, empty array when no enrollment)
 *
 * All queries use LIMIT 5 and ORDER BY created_at DESC. No N+1 patterns —
 * each resource is fetched in a single SQL statement.
 *
 * @param studentId        - The student's primary key.
 * @param enrolledCourseIds - Pre-computed list from ScopeContext.enrolledCourseIds.
 * @param limit            - Maximum items per collection (default 5).
 */
export async function getStudentDashboardRecentActivity(
  studentId: number,
  enrolledCourseIds: number[],
  limit = 5,
): Promise<StudentDashboardRecentActivity> {
  const [recentAssignments, recentAssessments, recentAnnouncements, recentNotes] =
    await Promise.all([
      // Student-scoped — runs regardless of enrollment
      db
        .select({
          id: assignmentsTable.id,
          courseId: assignmentsTable.courseId,
          title: assignmentsTable.title,
          dueDate: assignmentsTable.dueDate,
          createdAt: assignmentsTable.createdAt,
        })
        .from(assignmentsTable)
        .where(and(eq(assignmentsTable.studentId, studentId), isNull(assignmentsTable.deletedAt)))
        .orderBy(desc(assignmentsTable.createdAt))
        .limit(limit),

      // Student-scoped — runs regardless of enrollment
      db
        .select({
          id: assessmentsTable.id,
          courseId: assessmentsTable.courseId,
          title: assessmentsTable.title,
          createdAt: assessmentsTable.createdAt,
        })
        .from(assessmentsTable)
        .where(
          and(eq(assessmentsTable.studentId, studentId), isNull(assessmentsTable.deletedAt)),
        )
        .orderBy(desc(assessmentsTable.createdAt))
        .limit(limit),

      // Course-scoped — empty when no enrollment
      enrolledCourseIds.length === 0
        ? Promise.resolve([] as RecentAnnouncementRow[])
        : db
            .select({
              id: announcementsTable.id,
              courseId: announcementsTable.courseId,
              title: announcementsTable.title,
              priority: announcementsTable.priority,
              createdAt: announcementsTable.createdAt,
            })
            .from(announcementsTable)
            .where(
              and(
                inArray(announcementsTable.courseId, enrolledCourseIds),
                isNull(announcementsTable.deletedAt),
              ),
            )
            .orderBy(desc(announcementsTable.createdAt))
            .limit(limit),

      // Course-scoped — empty when no enrollment
      enrolledCourseIds.length === 0
        ? Promise.resolve([] as RecentNoteRow[])
        : db
            .select({
              id: notesTable.id,
              courseId: notesTable.courseId,
              title: notesTable.title,
              topic: notesTable.topic,
              createdAt: notesTable.createdAt,
            })
            .from(notesTable)
            .where(
              and(
                inArray(notesTable.courseId, enrolledCourseIds),
                isNull(notesTable.deletedAt),
              ),
            )
            .orderBy(desc(notesTable.createdAt))
            .limit(limit),
    ]);

  return { recentAssignments, recentAssessments, recentAnnouncements, recentNotes };
}
