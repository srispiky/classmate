import {
  listStudentAnnouncements,
  getStudentAnnouncement,
} from "../lib/student-announcements.queries";
import type { ScopeContext } from "../lib/scope-context";

// ── DTOs ──────────────────────────────────────────────────────────────────────

export interface StudentAnnouncementSummaryDto {
  announcementId: number;
  courseId: number;
  title: string;
  priority: string;
  authorName: string;
  createdAt: string; // ISO 8601
}

export interface StudentAnnouncementDetailDto extends StudentAnnouncementSummaryDto {
  content: string;
  updatedAt: string; // ISO 8601
}

// ── Service ───────────────────────────────────────────────────────────────────

/**
 * StudentAnnouncementService — student-scoped announcement access.
 *
 * Ownership model differs from assignments/assessments:
 *   - Announcements have no studentId FK — they are course-scoped only.
 *   - Ownership is enforced solely via scope.enrolledCourseIds.
 *   - Cross-student isolation is not applicable; all students in the same
 *     course see the same announcements.
 *
 * Ownership rules:
 *   1. List: only returns announcements whose courseId ∈ scope.enrolledCourseIds.
 *      The repository handles this via an inArray filter.
 *   2. Detail: requires row's courseId ∈ scope.enrolledCourseIds.
 *      Applied post-query for IDOR safety.
 *
 * Note: scope.studentId null-check is omitted for list/detail because
 * announcements require no student identity — enrollment is sufficient.
 * The studentId check is still present for overall portal entry via dashboard.
 *
 * Authorization middleware (requireRole) runs before this service.
 * No SQL in this layer.
 */
export class StudentAnnouncementService {
  /**
   * Returns all announcements visible to the student across enrolled courses.
   *
   * Returns [] when scope.enrolledCourseIds is empty.
   *
   * Ordered by createdAt descending (newest first).
   */
  static async listAnnouncements(
    scope: ScopeContext,
  ): Promise<StudentAnnouncementSummaryDto[]> {
    if (scope.enrolledCourseIds.length === 0) return [];

    const rows = await listStudentAnnouncements(scope.enrolledCourseIds);

    return rows.map((row) => ({
      announcementId: row.id,
      courseId: row.courseId,
      title: row.title,
      priority: row.priority,
      authorName: row.authorName,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  /**
   * Returns a single announcement detail.
   *
   * Returns null when:
   *   - announcement does not exist
   *   - announcement is soft-deleted
   *   - announcement's course is not in scope.enrolledCourseIds
   *
   * Controller maps null → 404. Callers cannot distinguish the denial reason —
   * intentional for IDOR safety.
   */
  static async getAnnouncement(
    scope: ScopeContext,
    announcementId: number,
  ): Promise<StudentAnnouncementDetailDto | null> {
    const row = await getStudentAnnouncement(announcementId);
    if (!row) return null;

    // Enrollment check: the announcement's course must be in the student's
    // active enrolled set. Returns the same null as "not found" — IDOR-safe.
    if (!scope.enrolledCourseIds.includes(row.courseId)) return null;

    return {
      announcementId: row.id,
      courseId: row.courseId,
      title: row.title,
      content: row.content,
      priority: row.priority,
      authorName: row.authorName,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
