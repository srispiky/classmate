import { eq, and, isNull } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { db, assessmentsTable, studentsTable, coursesTable } from "@workspace/db";
import type { ScopeContext } from "./scope-context";
import { mixedResourceScopeFilter } from "./scope-filter";

export interface AssessmentFilters {
  studentId?: number;
  courseId?: number;
}

export interface AssessmentRow {
  id: number;
  studentId: number;
  studentName: string;
  courseId: number;
  courseName: string;
  title: string;
  score: number;
  maxScore: number;
  strengths: string[];
  weaknesses: string[];
  createdAt: Date;
  deletedAt: Date | null;
}

type RawRow = {
  id: number;
  studentId: number;
  courseId: number;
  title: string;
  score: number;
  maxScore: number;
  strengths: string[];
  weaknesses: string[];
  createdAt: Date;
  deletedAt: Date | null;
  studentName: string | null;
  courseName: string | null;
};

function toAssessmentRow(r: RawRow): AssessmentRow {
  return {
    id: r.id,
    studentId: r.studentId,
    courseId: r.courseId,
    title: r.title,
    score: r.score,
    maxScore: r.maxScore,
    strengths: r.strengths,
    weaknesses: r.weaknesses,
    createdAt: r.createdAt,
    deletedAt: r.deletedAt,
    studentName: r.studentName ?? "Unknown",
    courseName: r.courseName ?? "Unknown",
  };
}

const JOIN_SELECT = {
  id: assessmentsTable.id,
  studentId: assessmentsTable.studentId,
  courseId: assessmentsTable.courseId,
  title: assessmentsTable.title,
  score: assessmentsTable.score,
  maxScore: assessmentsTable.maxScore,
  strengths: assessmentsTable.strengths,
  weaknesses: assessmentsTable.weaknesses,
  createdAt: assessmentsTable.createdAt,
  deletedAt: assessmentsTable.deletedAt,
  studentName: studentsTable.name,
  courseName: coursesTable.name,
} as const;

/**
 * Builds WHERE conditions for listing assessments.
 * Exported for unit testing — contains no DB calls.
 *
 * Layer 2 scope filter rules:
 * - admin:   no scope filter (only soft-delete guard + optional query filters)
 * - teacher: inArray(course_id, ownedCourseIds) — or SQL_FALSE if no owned courses
 * - student: eq(student_id, scope.studentId) — or SQL_FALSE if unlinked
 * - parent:  inArray(student_id, scope.childStudentIds) — or SQL_FALSE if empty
 *
 * The `studentId` query param is only honoured for global roles (admin/teacher).
 * For scoped roles the scope filter already constrains the visible rows.
 */
export function buildAssessmentListConditions(
  scope: ScopeContext,
  filters: Partial<AssessmentFilters>,
): SQL[] {
  const conditions: SQL[] = [];

  const scopeFilter = mixedResourceScopeFilter(assessmentsTable.courseId, assessmentsTable.studentId, scope);
  if (scopeFilter !== undefined) conditions.push(scopeFilter);

  if (filters.courseId != null) {
    conditions.push(eq(assessmentsTable.courseId, filters.courseId));
  }

  if (filters.studentId != null && scope.isGlobal) {
    conditions.push(eq(assessmentsTable.studentId, filters.studentId));
  }

  conditions.push(isNull(assessmentsTable.deletedAt));

  return conditions;
}

/**
 * Layer 2 — scope-filtered assessment list.
 *
 * Uses JOINs to resolve student and course names in a single query.
 * Scope filter is applied before ORDER BY.
 */
export async function listAssessments(
  scope: ScopeContext,
  filters: Partial<AssessmentFilters> = {},
): Promise<AssessmentRow[]> {
  const conditions = buildAssessmentListConditions(scope, filters);

  const rows = await db
    .select(JOIN_SELECT)
    .from(assessmentsTable)
    .leftJoin(studentsTable, eq(assessmentsTable.studentId, studentsTable.id))
    .leftJoin(coursesTable, eq(assessmentsTable.courseId, coursesTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(assessmentsTable.createdAt);

  return rows.map(toAssessmentRow);
}

/**
 * Fetches a single assessment by ID with soft-delete awareness.
 *
 * Intentionally does NOT apply a scope filter — the route handler performs
 * the Layer 3 canAccessStudentResource() check after this call, returning 403
 * for IDOR attempts rather than the misleading 404 a scope filter would produce.
 */
export async function getAssessmentById(id: number): Promise<AssessmentRow | null> {
  const [row] = await db
    .select(JOIN_SELECT)
    .from(assessmentsTable)
    .leftJoin(studentsTable, eq(assessmentsTable.studentId, studentsTable.id))
    .leftJoin(coursesTable, eq(assessmentsTable.courseId, coursesTable.id))
    .where(and(eq(assessmentsTable.id, id), isNull(assessmentsTable.deletedAt)))
    .limit(1);

  return row ? toAssessmentRow(row) : null;
}

/**
 * Returns all non-deleted assessments for a given student.
 * Used by AI-suggestions handlers — no scope filtering needed because
 * the caller (route handler) has already verified ownership before invoking this.
 */
export async function listAssessmentsForStudent(studentId: number): Promise<AssessmentRow[]> {
  const rows = await db
    .select(JOIN_SELECT)
    .from(assessmentsTable)
    .leftJoin(studentsTable, eq(assessmentsTable.studentId, studentsTable.id))
    .leftJoin(coursesTable, eq(assessmentsTable.courseId, coursesTable.id))
    .where(and(eq(assessmentsTable.studentId, studentId), isNull(assessmentsTable.deletedAt)))
    .orderBy(assessmentsTable.createdAt);

  return rows.map(toAssessmentRow);
}
