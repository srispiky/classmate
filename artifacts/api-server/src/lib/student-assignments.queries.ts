import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db, assignmentsTable } from "@workspace/db";

// ── Row types ─────────────────────────────────────────────────────────────────

export interface AssignmentSummaryRow {
  id: number;
  courseId: number;
  title: string;
  status: string;
  dueDate: string;
  score: number | null;
  maxScore: number;
}

export interface AssignmentDetailRow extends AssignmentSummaryRow {
  description: string;
  createdAt: Date;
  updatedAt: Date;
}

// ── Queries ───────────────────────────────────────────────────────────────────

/**
 * Repository: list all non-deleted assignments for a student, scoped to a set
 * of enrolled course IDs.
 *
 * Caller must pass a non-empty enrolledCourseIds array; an empty array is a
 * valid no-op and returns [] immediately without hitting the DB.
 *
 * Ordered by dueDate ascending so upcoming work appears first.
 *
 * @param studentId        - From scope.studentId (session-derived).
 * @param enrolledCourseIds - From scope.enrolledCourseIds (session-derived).
 */
export async function listStudentAssignments(
  studentId: number,
  enrolledCourseIds: number[],
): Promise<AssignmentSummaryRow[]> {
  if (enrolledCourseIds.length === 0) return [];

  return db
    .select({
      id: assignmentsTable.id,
      courseId: assignmentsTable.courseId,
      title: assignmentsTable.title,
      status: assignmentsTable.status,
      dueDate: assignmentsTable.dueDate,
      score: assignmentsTable.score,
      maxScore: assignmentsTable.maxScore,
    })
    .from(assignmentsTable)
    .where(
      and(
        inArray(assignmentsTable.courseId, enrolledCourseIds),
        eq(assignmentsTable.studentId, studentId),
        isNull(assignmentsTable.deletedAt),
      ),
    )
    .orderBy(asc(assignmentsTable.dueDate));
}

/**
 * Repository: fetch a single assignment by ID for a specific student.
 *
 * Returns null for:
 *   - non-existent assignments
 *   - soft-deleted assignments
 *   - assignments belonging to a different student
 *
 * The enrollment check (courseId ∈ enrolledCourseIds) is the service layer's
 * responsibility so that IDOR protection is applied uniformly.
 *
 * @param assignmentId - Path-param-derived assignment ID.
 * @param studentId    - From scope.studentId (session-derived).
 */
export async function getStudentAssignment(
  assignmentId: number,
  studentId: number,
): Promise<AssignmentDetailRow | null> {
  const rows = await db
    .select({
      id: assignmentsTable.id,
      courseId: assignmentsTable.courseId,
      title: assignmentsTable.title,
      description: assignmentsTable.description,
      status: assignmentsTable.status,
      dueDate: assignmentsTable.dueDate,
      score: assignmentsTable.score,
      maxScore: assignmentsTable.maxScore,
      createdAt: assignmentsTable.createdAt,
      updatedAt: assignmentsTable.updatedAt,
    })
    .from(assignmentsTable)
    .where(
      and(
        eq(assignmentsTable.id, assignmentId),
        eq(assignmentsTable.studentId, studentId),
        isNull(assignmentsTable.deletedAt),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}
