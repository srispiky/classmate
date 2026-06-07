import { eq, and, isNull } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { db, assignmentsTable, studentsTable, coursesTable } from "@workspace/db";
import type { ScopeContext } from "./scope-context";
import { mixedResourceScopeFilter } from "./scope-filter";

export interface AssignmentFilters {
  courseId?: number;
  studentId?: number;
}

export interface AssignmentRow {
  id: number;
  title: string;
  description: string;
  courseId: number;
  courseName: string;
  studentId: number;
  studentName: string;
  dueDate: string;
  status: string;
  score: number | null;
  maxScore: number;
  feedback: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: number | null;
  updatedBy: number | null;
  deletedAt: Date | null;
}

type RawRow = {
  id: number;
  title: string;
  description: string;
  courseId: number;
  studentId: number;
  dueDate: string;
  status: string;
  score: number | null;
  maxScore: number;
  feedback: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: number | null;
  updatedBy: number | null;
  deletedAt: Date | null;
  studentName: string | null;
  courseName: string | null;
};

function toAssignmentRow(r: RawRow): AssignmentRow {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    courseId: r.courseId,
    studentId: r.studentId,
    dueDate: r.dueDate,
    status: r.status,
    score: r.score,
    maxScore: r.maxScore,
    feedback: r.feedback,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    createdBy: r.createdBy,
    updatedBy: r.updatedBy,
    deletedAt: r.deletedAt,
    studentName: r.studentName ?? "Unknown",
    courseName: r.courseName ?? "Unknown",
  };
}

const JOIN_SELECT = {
  id: assignmentsTable.id,
  title: assignmentsTable.title,
  description: assignmentsTable.description,
  courseId: assignmentsTable.courseId,
  studentId: assignmentsTable.studentId,
  dueDate: assignmentsTable.dueDate,
  status: assignmentsTable.status,
  score: assignmentsTable.score,
  maxScore: assignmentsTable.maxScore,
  feedback: assignmentsTable.feedback,
  createdAt: assignmentsTable.createdAt,
  updatedAt: assignmentsTable.updatedAt,
  createdBy: assignmentsTable.createdBy,
  updatedBy: assignmentsTable.updatedBy,
  deletedAt: assignmentsTable.deletedAt,
  studentName: studentsTable.name,
  courseName: coursesTable.name,
} as const;

/**
 * Builds the WHERE conditions for listing assignments.
 * Exported for unit testing — contains no DB calls.
 *
 * Layer 2 scope filter rules:
 * - admin:   no scope filter (only soft-delete guard + optional query filters)
 * - teacher: inArray(course_id, ownedCourseIds) — or SQL_FALSE if no owned courses
 * - student: eq(student_id, scope.studentId) — or SQL_FALSE if account is unlinked
 * - parent:  inArray(student_id, scope.childStudentIds) — or SQL_FALSE if empty
 *
 * The extra `studentId` query param is only honoured for global roles (admin/teacher).
 * For scoped roles the scope filter already constrains the visible rows — adding a
 * mismatched studentId produces an impossible AND condition (zero rows), which is correct.
 */
export function buildAssignmentListConditions(
  scope: ScopeContext,
  filters: Partial<AssignmentFilters>,
): SQL[] {
  const conditions: SQL[] = [];

  const scopeFilter = mixedResourceScopeFilter(assignmentsTable.courseId, assignmentsTable.studentId, scope);
  if (scopeFilter !== undefined) conditions.push(scopeFilter);

  if (filters.courseId != null) {
    conditions.push(eq(assignmentsTable.courseId, filters.courseId));
  }

  if (filters.studentId != null && scope.isGlobal) {
    conditions.push(eq(assignmentsTable.studentId, filters.studentId));
  }

  conditions.push(isNull(assignmentsTable.deletedAt));

  return conditions;
}

/**
 * Layer 2 — scope-filtered assignment list.
 *
 * Uses JOINs to resolve student and course names in a single query,
 * replacing the prior N+1 pattern (N reads per assignment).
 * Scope filter is applied before ORDER BY.
 */
export async function listAssignments(
  scope: ScopeContext,
  filters: Partial<AssignmentFilters> = {},
): Promise<AssignmentRow[]> {
  const conditions = buildAssignmentListConditions(scope, filters);

  const rows = await db
    .select(JOIN_SELECT)
    .from(assignmentsTable)
    .leftJoin(studentsTable, eq(assignmentsTable.studentId, studentsTable.id))
    .leftJoin(coursesTable, eq(assignmentsTable.courseId, coursesTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(assignmentsTable.dueDate);

  return rows.map(toAssignmentRow);
}

/**
 * Fetches a single assignment by ID with soft-delete awareness.
 *
 * Intentionally does NOT apply a scope filter — the route handler performs
 * the Layer 3 canAccessStudentResource() check after this call, returning 403
 * for IDOR attempts rather than the misleading 404 a scope filter would produce.
 */
export async function getAssignmentById(id: number): Promise<AssignmentRow | null> {
  const [row] = await db
    .select(JOIN_SELECT)
    .from(assignmentsTable)
    .leftJoin(studentsTable, eq(assignmentsTable.studentId, studentsTable.id))
    .leftJoin(coursesTable, eq(assignmentsTable.courseId, coursesTable.id))
    .where(and(eq(assignmentsTable.id, id), isNull(assignmentsTable.deletedAt)))
    .limit(1);

  return row ? toAssignmentRow(row) : null;
}
