import { eq, and, isNull } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { db, notesTable, coursesTable } from "@workspace/db";
import type { ScopeContext } from "./scope-context";
import { applyCourseScopeFilter } from "./course-scope-validator";

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
 * Notes are course-scoped. Layer 2 filtering delegates entirely to
 * applyCourseScopeFilter() from course-scope-validator — the canonical
 * helper for all course-scoped resources.
 *
 * | Role    | Scope condition                                         |
 * |---------|---------------------------------------------------------|
 * | admin   | none — full table access                                |
 * | teacher | none — full table access                                |
 * | student | inArray(course_id, enrolledCourseIds) — or SQL_FALSE    |
 * | parent  | inArray(course_id, childCourseIds) — or SQL_FALSE        |
 * | other   | SQL_FALSE — zero rows                                   |
 *
 * The courseId query param is applied for all roles — it further narrows within
 * the requester's scope and is always safe to AND with the scope filter.
 */
export function buildNoteListConditions(
  scope: ScopeContext,
  filters: Partial<NoteFilters>,
): SQL[] {
  const conditions: SQL[] = [];

  const scopeFilter = applyCourseScopeFilter(notesTable.courseId, scope);
  if (scopeFilter !== undefined) conditions.push(scopeFilter);

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
 * Notes are course-scoped — scope filter is applied in the detail query (not post-fetch)
 * because there is no IDOR concern at the course level. Out-of-scope access yields 404,
 * which does not reveal whether the note exists in another course scope.
 *
 * Uses applyCourseScopeFilter() — the same Layer 2 mechanism as the list endpoint.
 * Parent scope uses scope.childCourseIds (pre-computed at login, Sprint 3 §9e).
 */
export async function getNoteById(id: number, scope: ScopeContext): Promise<NoteRow | null> {
  const conditions: SQL[] = [eq(notesTable.id, id)];

  const scopeFilter = applyCourseScopeFilter(notesTable.courseId, scope);
  if (scopeFilter !== undefined) conditions.push(scopeFilter);

  conditions.push(isNull(notesTable.deletedAt));

  const [row] = await db
    .select(JOIN_SELECT)
    .from(notesTable)
    .leftJoin(coursesTable, eq(notesTable.courseId, coursesTable.id))
    .where(and(...conditions))
    .limit(1);

  return row ? toNoteRow(row) : null;
}
