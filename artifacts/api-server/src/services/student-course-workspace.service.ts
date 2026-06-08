import {
  getWorkspaceCourse,
  getCourseWorkspaceCounts,
} from "../lib/student-course-workspace.queries";
import type { ScopeContext } from "../lib/scope-context";

// ── DTO ───────────────────────────────────────────────────────────────────────

export interface StudentCourseWorkspaceDto {
  courseId: number;
  title: string;
  description: string;
  teacherId: number | null;

  totalAssignments: number;
  pendingAssignments: number;
  recentAssignments: number;

  totalAssessments: number;
  upcomingAssessments: number;

  totalAnnouncements: number;
  recentAnnouncements: number;

  totalNotes: number;
  recentNotes: number;
}

// ── Service ───────────────────────────────────────────────────────────────────

/**
 * StudentCourseWorkspaceService — aggregates all visible data for one enrolled course.
 *
 * Responsibilities:
 *   - Enforce enrollment ownership (scope.enrolledCourseIds)
 *   - Enforce linked student record (scope.studentId)
 *   - Coordinate repository calls (course row + 4 aggregate queries)
 *   - Compose the workspace DTO
 *
 * Authorization middleware (requireRole) runs before this service.
 * The service owns the business rules around enrollment and student linkage.
 */
export class StudentCourseWorkspaceService {
  /**
   * Returns the course workspace for an enrolled student.
   *
   * Returns null when:
   *   - courseId is not in scope.enrolledCourseIds (not enrolled or inactive enrollment)
   *   - scope.studentId is null (account not linked to a student record)
   *   - course does not exist or has been soft-deleted
   *
   * Controller maps null → 404 (IDOR-safe: does not distinguish between
   * "not enrolled" and "course not found").
   */
  static async getWorkspace(
    scope: ScopeContext,
    courseId: number,
  ): Promise<StudentCourseWorkspaceDto | null> {
    if (!scope.enrolledCourseIds.includes(courseId)) return null;

    const { studentId } = scope;
    if (studentId === null) return null;

    const [course, counts] = await Promise.all([
      getWorkspaceCourse(courseId),
      getCourseWorkspaceCounts(courseId, studentId),
    ]);

    if (!course) return null;

    return {
      courseId: course.id,
      title: course.name,
      description: course.description,
      teacherId: course.teacherId ?? null,
      ...counts,
    };
  }
}
