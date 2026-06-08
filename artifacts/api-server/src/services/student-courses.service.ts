import { listStudentCourses, getStudentCourseById } from "../lib/student-courses.queries";
import type { ScopeContext } from "../lib/scope-context";

// ── DTOs ──────────────────────────────────────────────────────────────────────

export interface StudentCourseSummaryDto {
  courseId: number;
  title: string;
  description: string;
  teacherId: number | null;
  /**
   * Always "active" — scope.enrolledCourseIds is pre-computed from active
   * enrollments only by SessionEnricherService. Included for API completeness.
   */
  enrollmentStatus: "active";
}

export interface StudentCourseDetailDto {
  courseId: number;
  title: string;
  description: string;
  teacherId: number | null;
  createdAt: string;
  updatedAt: string;
}

// ── Service ───────────────────────────────────────────────────────────────────

/**
 * StudentCourseService — aggregates course visibility for students.
 *
 * Responsibilities:
 *   - Retrieve enrolled courses (list and single)
 *   - Enforce enrollment ownership at the service boundary
 *   - Compose course DTOs from repository rows
 *
 * Authorization (requireRole) is enforced by the controller before this
 * service is invoked. This service enforces the business rule that a student
 * can only retrieve courses present in scope.enrolledCourseIds.
 */
export class StudentCourseService {
  /**
   * Returns all courses the student is actively enrolled in.
   *
   * Scope filtering is applied at the DB level by CourseScopePolicy
   * inside listStudentCourses(). Empty enrolledCourseIds → empty list.
   */
  static async listCourses(scope: ScopeContext): Promise<StudentCourseSummaryDto[]> {
    const rows = await listStudentCourses(scope);
    return rows.map((row) => ({
      courseId: row.id,
      title: row.name,
      description: row.description,
      teacherId: row.teacherId ?? null,
      enrollmentStatus: "active" as const,
    }));
  }

  /**
   * Returns details for a single enrolled course.
   *
   * Returns null when:
   *   - courseId is not in scope.enrolledCourseIds (not enrolled or inactive enrollment)
   *   - course row does not exist or has been soft-deleted
   *
   * The controller maps null → 404 (not 403) to prevent IDOR enumeration.
   * Students should not learn whether a course exists if they are not enrolled in it.
   */
  static async getCourse(
    scope: ScopeContext,
    courseId: number,
  ): Promise<StudentCourseDetailDto | null> {
    if (!scope.enrolledCourseIds.includes(courseId)) return null;

    const row = await getStudentCourseById(courseId);
    if (!row) return null;

    return {
      courseId: row.id,
      title: row.name,
      description: row.description,
      teacherId: row.teacherId ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
