import { eq, and, isNull } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { db, announcementsTable, coursesTable } from "@workspace/db";
import type { ScopeContext } from "./scope-context";
import { announcementPolicy } from "./policies/announcement-scope-policy";

export interface AnnouncementFilters {
  courseId?: number;
}

export interface AnnouncementRow {
  id: number;
  title: string;
  content: string;
  courseId: number;
  courseName: string;
  authorName: string;
  priority: string;
  createdAt: Date;
  deletedAt: Date | null;
}

type RawRow = {
  id: number;
  title: string;
  content: string;
  courseId: number;
  authorName: string;
  priority: string;
  createdAt: Date;
  deletedAt: Date | null;
  courseName: string | null;
};

function toAnnouncementRow(r: RawRow): AnnouncementRow {
  return {
    id: r.id,
    title: r.title,
    content: r.content,
    courseId: r.courseId,
    authorName: r.authorName,
    priority: r.priority,
    createdAt: r.createdAt,
    deletedAt: r.deletedAt,
    courseName: r.courseName ?? "Unknown",
  };
}

const JOIN_SELECT = {
  id: announcementsTable.id,
  title: announcementsTable.title,
  content: announcementsTable.content,
  courseId: announcementsTable.courseId,
  authorName: announcementsTable.authorName,
  priority: announcementsTable.priority,
  createdAt: announcementsTable.createdAt,
  deletedAt: announcementsTable.deletedAt,
  courseName: coursesTable.name,
} as const;

/**
 * Builds WHERE conditions for listing announcements.
 * Exported for unit testing — contains no DB calls.
 *
 * Layer 2 filtering delegates to AnnouncementScopePolicy.getScopeCondition() —
 * the canonical course-scoped policy helper. Consistent with NotesScopePolicy.
 *
 * | Role    | Scope condition                                         |
 * |---------|---------------------------------------------------------|
 * | admin   | none — full table access                                |
 * | teacher | none — full table access                                |
 * | student | inArray(course_id, enrolledCourseIds) — or SQL_FALSE    |
 * | parent  | inArray(course_id, childCourseIds) — or SQL_FALSE        |
 * | other   | SQL_FALSE — zero rows                                   |
 */
export function buildAnnouncementListConditions(
  scope: ScopeContext,
  filters: Partial<AnnouncementFilters>,
): SQL[] {
  const conditions: SQL[] = [];

  const scopeCondition = announcementPolicy.getScopeCondition(scope);
  if (scopeCondition !== undefined) conditions.push(scopeCondition);

  if (filters.courseId != null) {
    conditions.push(eq(announcementsTable.courseId, filters.courseId));
  }

  conditions.push(isNull(announcementsTable.deletedAt));

  return conditions;
}

/**
 * Layer 2 — scope-filtered announcement list.
 *
 * Uses a LEFT JOIN to resolve course name in a single query (no N+1).
 * Scope filter applied at the database level via AnnouncementScopePolicy.
 * Results ordered by createdAt descending (newest first for announcements).
 */
export async function listAnnouncements(
  scope: ScopeContext,
  filters: Partial<AnnouncementFilters> = {},
): Promise<AnnouncementRow[]> {
  const conditions = buildAnnouncementListConditions(scope, filters);

  const rows = await db
    .select(JOIN_SELECT)
    .from(announcementsTable)
    .leftJoin(coursesTable, eq(announcementsTable.courseId, coursesTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(announcementsTable.createdAt);

  return rows.map(toAnnouncementRow);
}

/**
 * Fetches a single announcement by ID with soft-delete awareness.
 *
 * Intentionally does NOT apply a scope filter — the route handler performs
 * the Layer 3 announcementPolicy.validateAccess() check after this call.
 *
 * Separation of concerns:
 *   - Layer 2 (getScopeCondition) narrows the LIST query at the DB level.
 *   - Layer 3 (validateAccess)    is the defense-in-depth guard on detail reads.
 *
 * Returning null means the announcement does not exist or has been soft-deleted.
 * A found announcement whose courseId fails validateAccess yields 403, not 404 —
 * preventing resource enumeration while giving clear IDOR signal.
 */
export async function getAnnouncementById(id: number): Promise<AnnouncementRow | null> {
  const [row] = await db
    .select(JOIN_SELECT)
    .from(announcementsTable)
    .leftJoin(coursesTable, eq(announcementsTable.courseId, coursesTable.id))
    .where(and(eq(announcementsTable.id, id), isNull(announcementsTable.deletedAt)))
    .limit(1);

  return row ? toAnnouncementRow(row) : null;
}
