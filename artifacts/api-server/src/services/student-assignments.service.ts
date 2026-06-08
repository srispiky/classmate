import {
  listStudentAssignments,
  getStudentAssignment,
} from "../lib/student-assignments.queries";
import type { ScopeContext } from "../lib/scope-context";

// ── DTOs ──────────────────────────────────────────────────────────────────────

export interface StudentAssignmentSummaryDto {
  assignmentId: number;
  courseId: number;
  title: string;
  status: string;
  dueDate: string;
  score: number | null;
  maxScore: number;
}

export interface StudentAssignmentDetailDto extends StudentAssignmentSummaryDto {
  description: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

// ── Service ───────────────────────────────────────────────────────────────────

/**
 * StudentAssignmentService — student-scoped assignment access.
 *
 * Ownership rules enforced here:
 *   1. scope.studentId must be non-null (linked student record).
 *   2. List: only returns assignments whose courseId ∈ scope.enrolledCourseIds.
 *      The repository handles this via an inArray filter.
 *   3. Detail: requires DB row's courseId ∈ scope.enrolledCourseIds.
 *      This check runs AFTER the DB query so the same 404 is returned
 *      for non-existent, deleted, wrong-student, and non-enrolled — IDOR-safe.
 *
 * Authorization middleware (requireRole) runs before this service.
 * No SQL in this layer.
 */
export class StudentAssignmentService {
  /**
   * Returns all assignments visible to the student across enrolled courses.
   *
   * Returns [] when:
   *   - scope.studentId is null (unlinked account)
   *   - scope.enrolledCourseIds is empty
   *
   * Ordered by dueDate ascending.
   */
  static async listAssignments(
    scope: ScopeContext,
  ): Promise<StudentAssignmentSummaryDto[]> {
    if (scope.studentId === null) return [];
    if (scope.enrolledCourseIds.length === 0) return [];

    const rows = await listStudentAssignments(scope.studentId, scope.enrolledCourseIds);

    return rows.map((row) => ({
      assignmentId: row.id,
      courseId: row.courseId,
      title: row.title,
      status: row.status,
      dueDate: row.dueDate,
      score: row.score ?? null,
      maxScore: row.maxScore,
    }));
  }

  /**
   * Returns a single assignment detail.
   *
   * Returns null when:
   *   - scope.studentId is null
   *   - assignment does not exist
   *   - assignment is soft-deleted
   *   - assignment belongs to a different student
   *   - assignment's course is not in scope.enrolledCourseIds
   *
   * Controller maps null → 404. Callers cannot distinguish the denial reason —
   * this is intentional for IDOR safety.
   */
  static async getAssignment(
    scope: ScopeContext,
    assignmentId: number,
  ): Promise<StudentAssignmentDetailDto | null> {
    const { studentId } = scope;
    if (studentId === null) return null;

    const row = await getStudentAssignment(assignmentId, studentId);
    if (!row) return null;

    // Enrollment check: course must be in the student's active enrolled set.
    if (!scope.enrolledCourseIds.includes(row.courseId)) return null;

    return {
      assignmentId: row.id,
      courseId: row.courseId,
      title: row.title,
      description: row.description,
      status: row.status,
      dueDate: row.dueDate,
      score: row.score ?? null,
      maxScore: row.maxScore,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
