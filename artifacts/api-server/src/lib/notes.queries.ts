import { eq, and, isNull } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { db, notesTable, coursesTable } from "@workspace/db";
import type { ScopeContext } from "./scope-context";
import { courseIdScopeFilter, parentCourseEnrollmentFilter } from "./scope-filter";

export interface NoteFilters {
  courseId?: number;
}

export interface NoteRow {
  id: number;
  title: string;
  content: string;
  courseId: number;
  courseName: string;
  topic: string;
  videoUrl: string | null;
  createdAt: Date;
  deletedAt: Date | null;
}

type RawRow = {
  id: number;
  title: string;
  content: string;
  courseId: number;
  topic: string;
  videoUrl: string | null;
  createdAt: Date;
  deletedAt: Date | null;
  courseName: string | null;
};

function toNoteRow(r: RawRow): NoteRow {
  return {
    id: r.id,
    title: r.title,
    content: r.content,
    courseId: r.courseId,
    topic: r.topic,
    videoUrl: r.videoUrl,
    createdAt: r.createdAt,
    deletedAt: r.deletedAt,
    courseName: r.courseName ?? "Unknown",
  };
}

const JOIN_SELECT = {
  id: notesTable.id,
  title: notesTable.title,
  content: notesTable.content,
  courseId: notesTable.courseId,
  topic: notesTable.topic,
  videoUrl: notesTable.videoUrl,
  createdAt: notesTable.createdAt,
  deletedAt: notesTable.deletedAt,
  courseName: coursesTable.name,
} as const;

/**
 * Builds WHERE conditions for listing notes.
 * Exported for unit testing — contains no DB calls.
 *
 * Notes are course-scoped, not student-scoped. Layer 2 rules:
 *
 * - admin/teacher:  no scope filter (deletedAt guard + optional courseId only)
 * - student:        inArray(course_id, enrolledCourseIds) — or SQL_FALSE if empty
 * - parent:         course_id IN (SELECT course_id FROM course_enrollments
 *                     WHERE student_id IN childStudentIds AND is_active = true)
 *                   — or SQL_FALSE if childStudentIds is empty
 * - other roles:    SQL_FALSE (zero rows)
 *
 * The courseId query param is applied for all roles — it further narrows within the
 * scope, always safe to AND with the scope filter.
 *
 * Parent scope requires a subquery and CANNOT go through courseIdScopeFilter()
 * (that function deliberately returns undefined for parent). This function handles
 * parent explicitly by calling parentCourseEnrollmentFilter().
 */
export function buildNoteListConditions(
  scope: ScopeContext,
  filters: Partial<NoteFilters>,
): SQL[] {
  const conditions: SQL[] = [];

  if (scope.role === "parent") {
    // Parent: subquery against course_enrollments keyed on childStudentIds.
    // parentCourseEnrollmentFilter() returns SQL_FALSE when childStudentIds is empty.
    conditions.push(parentCourseEnrollmentFilter(notesTable.courseId, scope.childStudentIds));
  } else {
    // admin/teacher: undefined (no push) → full table access
    // student: inArray(courseId, enrolledCourseIds) or SQL_FALSE
    // other: SQL_FALSE
    const scopeFilter = courseIdScopeFilter(notesTable.courseId, scope);
    if (scopeFilter !== undefined) conditions.push(scopeFilter);
  }

  if (filters.courseId != null) {
    conditions.push(eq(notesTable.courseId, filters.courseId));
  }

  conditions.push(isNull(notesTable.deletedAt));

  return conditions;
}

/**
 * Layer 2 — scope-filtered note list.
 *
 * Uses a JOIN to resolve course name in a single query.
 * Scope filter is applied before ORDER BY.
 */
export async function listNotes(
  scope: ScopeContext,
  filters: Partial<NoteFilters> = {},
): Promise<NoteRow[]> {
  const conditions = buildNoteListConditions(scope, filters);

  const rows = await db
    .select(JOIN_SELECT)
    .from(notesTable)
    .leftJoin(coursesTable, eq(notesTable.courseId, coursesTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(notesTable.createdAt);

  return rows.map(toNoteRow);
}

/**
 * Fetches a single note by ID with scope filtering and soft-delete awareness.
 *
 * Unlike student-owned resources (assignments, assessments) where the detail
 * query fetches without scope so the route can return 403 for IDOR, notes are
 * course-scoped — returning 404 for out-of-scope access is the correct behaviour
 * (no IDOR concern; the route simply does not expose notes outside the requester's
 * enrolled courses). Scope is applied in the query for both list and detail.
 *
 * Parent scope uses parentCourseEnrollmentFilter() — a subquery on course_enrollments —
 * because childStudentIds' enrolled course IDs are not cached in scope.
 */
export async function getNoteById(id: number, scope: ScopeContext): Promise<NoteRow | null> {
  const conditions: SQL[] = [eq(notesTable.id, id)];

  if (scope.role === "parent") {
    conditions.push(parentCourseEnrollmentFilter(notesTable.courseId, scope.childStudentIds));
  } else {
    const scopeFilter = courseIdScopeFilter(notesTable.courseId, scope);
    if (scopeFilter !== undefined) conditions.push(scopeFilter);
  }

  conditions.push(isNull(notesTable.deletedAt));

  const [row] = await db
    .select(JOIN_SELECT)
    .from(notesTable)
    .leftJoin(coursesTable, eq(notesTable.courseId, coursesTable.id))
    .where(and(...conditions))
    .limit(1);

  return row ? toNoteRow(row) : null;
}
