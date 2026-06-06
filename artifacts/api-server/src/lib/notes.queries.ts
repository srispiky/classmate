import { eq, and, isNull } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { db, notesTable, coursesTable } from "@workspace/db";
import type { ScopeContext } from "./scope-context";
import { applyTeacherScopeFilter } from "../shared/auth/teacher-scope-validator";

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
 * Layer 2 filtering uses applyTeacherScopeFilter() — enforces teacher ownership.
 * Teachers see only notes for courses they own; global access is not granted.
 *
 * | Role    | Scope condition                                         |
 * |---------|---------------------------------------------------------|
 * | admin   | none — full table access                                |
 * | teacher | inArray(course_id, ownedCourseIds) — or SQL_FALSE       |
 * | student | inArray(course_id, enrolledCourseIds) — or SQL_FALSE    |
 * | parent  | inArray(course_id, childCourseIds) — or SQL_FALSE       |
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

  const scopeFilter = applyTeacherScopeFilter(notesTable.courseId, scope);
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
 * Uses a JOIN to resolve course name in a single query (no N+1).
 * Scope filter applied at the database level — no in-memory filtering.
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
 * Fetches a single note by ID with soft-delete awareness.
 *
 * Intentionally does NOT apply a scope filter — the route handler performs
 * the Layer 3 validateCourseAccess() check after this call (Sprint 3 Chunk 6).
 *
 * Separation of concerns:
 *   - Layer 2 (applyCourseScopeFilter) narrows the LIST query at the DB level.
 *   - Layer 3 (validateCourseAccess)  is the defense-in-depth guard on detail reads.
 *
 * Returning null means the note does not exist or has been soft-deleted.
 * A found note whose courseId fails validateCourseAccess yields 403, not 404 —
 * this is the explicit IDOR response required by Sprint 3 Chunk 6.
 */
export async function getNoteById(id: number): Promise<NoteRow | null> {
  const [row] = await db
    .select(JOIN_SELECT)
    .from(notesTable)
    .leftJoin(coursesTable, eq(notesTable.courseId, coursesTable.id))
    .where(and(eq(notesTable.id, id), isNull(notesTable.deletedAt)))
    .limit(1);

  return row ? toNoteRow(row) : null;
}
