import {
  getStudentDisplayName,
  getStudentDashboardCounts,
  getStudentDashboardRecentActivity,
} from "../lib/student-dashboard.queries";
import type { ScopeContext } from "../lib/scope-context";

// ── Recent activity item DTOs ─────────────────────────────────────────────────

export interface DashboardRecentAssignmentDto {
  assignmentId: number;
  courseId: number;
  title: string;
  dueDate: string;
  createdAt: string; // ISO 8601
}

export interface DashboardRecentAssessmentDto {
  assessmentId: number;
  courseId: number;
  title: string;
  createdAt: string; // ISO 8601
}

export interface DashboardRecentAnnouncementDto {
  announcementId: number;
  courseId: number;
  title: string;
  priority: string;
  createdAt: string; // ISO 8601
}

export interface DashboardRecentNoteDto {
  noteId: number;
  courseId: number;
  title: string;
  topic: string;
  createdAt: string; // ISO 8601
}

// ── Dashboard DTO ─────────────────────────────────────────────────────────────

export interface StudentDashboardDTO {
  // Identity
  studentId: number;
  displayName: string;

  // Scalar counts (backward-compatible — unchanged from Chunk 1)
  activeCourseCount: number;
  totalAssignments: number;
  pendingAssignments: number;
  totalAssessments: number;
  upcomingAssessments: number;
  unreadAnnouncements: number;
  availableNotes: number;

  // Recent activity collections (new in Chunk 8)
  recentAssignments: DashboardRecentAssignmentDto[];
  recentAssessments: DashboardRecentAssessmentDto[];
  recentAnnouncements: DashboardRecentAnnouncementDto[];
  recentNotes: DashboardRecentNoteDto[];
}

// ── Service ───────────────────────────────────────────────────────────────────

/**
 * StudentDashboardService — aggregates dashboard metrics for a student.
 *
 * Responsibilities:
 *   - Validate that the scope carries a linked student record
 *   - Coordinate repository calls
 *   - Compose the dashboard DTO
 *
 * Authorization is enforced by the controller (requireRole) before this
 * service is invoked. The service enforces the additional business rule that
 * the session must be linked to an actual student record (scope.studentId != null).
 *
 * Query strategy (Chunk 8):
 *   All three top-level repository calls run in parallel:
 *     1. getStudentDisplayName — single row lookup
 *     2. getStudentDashboardCounts — 2 sequential batches of parallel COUNTs
 *     3. getStudentDashboardRecentActivity — 4 parallel SELECT … LIMIT 5 queries
 *   Total wall-clock time ≈ max(displayName, counts, recentActivity) ≈ 2 DB round-trips.
 */
export class StudentDashboardService {
  /**
   * Builds the student dashboard for the authenticated student.
   *
   * Returns null when:
   *   - scope.studentId is null (account not linked to a student record)
   *   - no student row found for scope.studentId (record deleted or never created)
   *
   * The controller maps null → 404.
   */
  static async getDashboard(scope: ScopeContext): Promise<StudentDashboardDTO | null> {
    const { studentId, enrolledCourseIds } = scope;
    if (studentId === null) return null;

    const [displayName, counts, recentActivity] = await Promise.all([
      getStudentDisplayName(studentId),
      getStudentDashboardCounts(studentId, enrolledCourseIds),
      getStudentDashboardRecentActivity(studentId, enrolledCourseIds),
    ]);

    if (displayName === null) return null;

    const { recentAssignments, recentAssessments, recentAnnouncements, recentNotes } =
      recentActivity;

    return {
      studentId,
      displayName,
      ...counts,
      recentAssignments: recentAssignments.map((r) => ({
        assignmentId: r.id,
        courseId: r.courseId,
        title: r.title,
        dueDate: r.dueDate,
        createdAt: r.createdAt.toISOString(),
      })),
      recentAssessments: recentAssessments.map((r) => ({
        assessmentId: r.id,
        courseId: r.courseId,
        title: r.title,
        createdAt: r.createdAt.toISOString(),
      })),
      recentAnnouncements: recentAnnouncements.map((r) => ({
        announcementId: r.id,
        courseId: r.courseId,
        title: r.title,
        priority: r.priority,
        createdAt: r.createdAt.toISOString(),
      })),
      recentNotes: recentNotes.map((r) => ({
        noteId: r.id,
        courseId: r.courseId,
        title: r.title,
        topic: r.topic,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }
}
