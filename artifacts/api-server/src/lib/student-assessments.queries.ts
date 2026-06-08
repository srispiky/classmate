import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db, assessmentsTable } from "@workspace/db";

// ── Row types ─────────────────────────────────────────────────────────────────

export interface AssessmentSummaryRow {
  id: number;
  courseId: number;
  title: string;
  score: number;
  maxScore: number;
}

export interface AssessmentDetailRow extends AssessmentSummaryRow {
  strengths: string[];
  weaknesses: string[];
  createdAt: Date;
  updatedAt: Date;
}

// ── Queries ───────────────────────────────────────────────────────────────────

/**
 * Repository: list all non-deleted assessments for a student, scoped to a set
 * of enrolled course IDs.
 *
 * Returns [] immediately for an empty enrolledCourseIds array without hitting
 * the DB (Drizzle inArray([]) would produce invalid SQL).
 *
 * Ordered by createdAt descending — most recent assessments first.
 *
 * @param studentId         - From scope.studentId (session-derived).
 * @param enrolledCourseIds - From scope.enrolledCourseIds (session-derived).
 */
export async function listStudentAssessments(
  studentId: number,
  enrolledCourseIds: number[],
): Promise<AssessmentSummaryRow[]> {
  if (enrolledCourseIds.length === 0) return [];

  return db
    .select({
      id: assessmentsTable.id,
      courseId: assessmentsTable.courseId,
      title: assessmentsTable.title,
      score: assessmentsTable.score,
      maxScore: assessmentsTable.maxScore,
    })
    .from(assessmentsTable)
    .where(
      and(
        inArray(assessmentsTable.courseId, enrolledCourseIds),
        eq(assessmentsTable.studentId, studentId),
        isNull(assessmentsTable.deletedAt),
      ),
    )
    .orderBy(desc(assessmentsTable.createdAt));
}

/**
 * Repository: fetch a single assessment by ID for a specific student.
 *
 * Returns null for:
 *   - non-existent assessments
 *   - soft-deleted assessments
 *   - assessments belonging to a different student
 *
 * The enrollment check (courseId ∈ enrolledCourseIds) is the service layer's
 * responsibility — IDOR protection requires it to be uniform across all denial
 * cases.
 *
 * @param assessmentId - Path-param-derived assessment ID.
 * @param studentId    - From scope.studentId (session-derived).
 */
export async function getStudentAssessment(
  assessmentId: number,
  studentId: number,
): Promise<AssessmentDetailRow | null> {
  const rows = await db
    .select({
      id: assessmentsTable.id,
      courseId: assessmentsTable.courseId,
      title: assessmentsTable.title,
      score: assessmentsTable.score,
      maxScore: assessmentsTable.maxScore,
      strengths: assessmentsTable.strengths,
      weaknesses: assessmentsTable.weaknesses,
      createdAt: assessmentsTable.createdAt,
      updatedAt: assessmentsTable.updatedAt,
    })
    .from(assessmentsTable)
    .where(
      and(
        eq(assessmentsTable.id, assessmentId),
        eq(assessmentsTable.studentId, studentId),
        isNull(assessmentsTable.deletedAt),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}
