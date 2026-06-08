import {
  listStudentAssessments,
  getStudentAssessment,
} from "../lib/student-assessments.queries";
import type { ScopeContext } from "../lib/scope-context";

// ── DTOs ──────────────────────────────────────────────────────────────────────

/**
 * Note on schema adaptation:
 *
 * The chunk spec references assessmentType and dueDate fields, which do not
 * exist in the assessments table. The actual schema stores strengths[] and
 * weaknesses[] arrays instead of typed/dated assessments.
 *
 * StudentAssessmentSummaryDto uses the actual columns: id, courseId, title,
 * score, maxScore.
 *
 * StudentAssessmentDetailDto adds the available qualitative fields: strengths
 * and weaknesses, along with the standard audit timestamps.
 */

export interface StudentAssessmentSummaryDto {
  assessmentId: number;
  courseId: number;
  title: string;
  score: number;
  maxScore: number;
}

export interface StudentAssessmentDetailDto extends StudentAssessmentSummaryDto {
  strengths: string[];
  weaknesses: string[];
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

// ── Service ───────────────────────────────────────────────────────────────────

/**
 * StudentAssessmentService — student-scoped assessment access.
 *
 * Ownership rules enforced here:
 *   1. scope.studentId must be non-null (linked student record).
 *   2. List: only returns assessments whose courseId ∈ scope.enrolledCourseIds.
 *      The repository handles this via an inArray filter at the DB level.
 *   3. Detail: requires DB row's courseId ∈ scope.enrolledCourseIds.
 *      This check runs AFTER the DB query so the same 404 is returned for
 *      non-existent, deleted, wrong-student, and non-enrolled — IDOR-safe.
 *
 * Authorization middleware (requireRole) runs before this service.
 * No SQL in this layer.
 */
export class StudentAssessmentService {
  /**
   * Returns all assessments visible to the student across enrolled courses.
   *
   * Returns [] when:
   *   - scope.studentId is null (unlinked account)
   *   - scope.enrolledCourseIds is empty
   *
   * Ordered by createdAt descending (most recent first).
   */
  static async listAssessments(
    scope: ScopeContext,
  ): Promise<StudentAssessmentSummaryDto[]> {
    if (scope.studentId === null) return [];
    if (scope.enrolledCourseIds.length === 0) return [];

    const rows = await listStudentAssessments(scope.studentId, scope.enrolledCourseIds);

    return rows.map((row) => ({
      assessmentId: row.id,
      courseId: row.courseId,
      title: row.title,
      score: row.score,
      maxScore: row.maxScore,
    }));
  }

  /**
   * Returns a single assessment detail.
   *
   * Returns null when:
   *   - scope.studentId is null
   *   - assessment does not exist
   *   - assessment is soft-deleted
   *   - assessment belongs to a different student
   *   - assessment's course is not in scope.enrolledCourseIds
   *
   * Controller maps null → 404. Callers cannot distinguish the denial reason —
   * intentional for IDOR safety.
   */
  static async getAssessment(
    scope: ScopeContext,
    assessmentId: number,
  ): Promise<StudentAssessmentDetailDto | null> {
    const { studentId } = scope;
    if (studentId === null) return null;

    const row = await getStudentAssessment(assessmentId, studentId);
    if (!row) return null;

    // Enrollment check: course must be in the student's active enrolled set.
    if (!scope.enrolledCourseIds.includes(row.courseId)) return null;

    return {
      assessmentId: row.id,
      courseId: row.courseId,
      title: row.title,
      score: row.score,
      maxScore: row.maxScore,
      strengths: row.strengths,
      weaknesses: row.weaknesses,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
