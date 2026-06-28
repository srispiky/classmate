/**
 * Course list query with cursor-based pagination.
 *
 * Layer 2 scope filtering is applied by the caller-supplied scopeCondition
 * (built from coursePolicy.getScopeCondition(scope)) before the cursor
 * condition is appended — the cursor never widens or bypasses the scope.
 *
 * Sort order: (name ASC, id ASC) — id is the primary-key tiebreaker for
 * duplicate names, guaranteeing a stable and deterministic page boundary.
 */

import { eq, and, or, gt, isNull } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { db, coursesTable } from "@workspace/db";
import type { ScopeContext } from "./scope-context";
import { coursePolicy } from "../shared/auth/policies/course-scope-policy";
import {
  encodeCursor,
  decodeStudentCursor,
  DEFAULT_LIMIT,
  type PaginatedResult,
} from "./pagination";

export type CourseRow = typeof coursesTable.$inferSelect;

export interface CourseFilters {
  status?: string;
}

/**
 * Builds WHERE conditions for listing courses.
 * Exported for unit testing — contains no DB calls.
 *
 * Layer 2 filtering uses CourseScopePolicy.getScopeCondition() which enforces
 * teacher ownership boundaries (unlike the older course-scope-validator which
 * granted teachers global access).
 *
 * | Role    | Scope condition                                          |
 * |---------|----------------------------------------------------------|
 * | admin   | none — full table access                                 |
 * | teacher | inArray(id, ownedCourseIds) — or SQL_FALSE               |
 * | student | inArray(id, enrolledCourseIds) — or SQL_FALSE            |
 * | parent  | inArray(id, childCourseIds) — or SQL_FALSE               |
 * | other   | SQL_FALSE — zero rows                                    |
 *
 * Soft-delete guard (isNull(deletedAt)) is always appended last.
 */
export function buildCourseListConditions(
  scope: ScopeContext,
  filters: Partial<CourseFilters>,
): SQL[] {
  const conditions: SQL[] = [];

  const scopeFilter = coursePolicy.getScopeCondition(scope);
  if (scopeFilter !== undefined) conditions.push(scopeFilter);

  if (filters.status != null) {
    conditions.push(eq(coursesTable.status, filters.status as "active" | "archived"));
  }

  conditions.push(isNull(coursesTable.deletedAt));

  return conditions;
}

export interface ListCoursesOptions {
  limit?: number;
  cursor?: string;
  scope: ScopeContext;
  filters?: Partial<CourseFilters>;
}

/**
 * Layer 2 — scope-filtered, cursor-paginated course list.
 *
 * Applies CourseScopePolicy at the database level — no in-memory filtering.
 * Sorted by (name ASC, id ASC) for a stable, deterministic page boundary.
 *
 * The cursor payload reuses the StudentCursorPayload shape {name, id}
 * because the sort key is identical: (name ASC, id ASC).
 */
export async function listCourses(
  scope: ScopeContext,
  filters: Partial<CourseFilters> = {},
  options: { limit?: number; cursor?: string } = {},
): Promise<PaginatedResult<CourseRow>> {
  const limit = Math.min(options.limit ?? DEFAULT_LIMIT, 100);
  const baseConditions = buildCourseListConditions(scope, filters);

  const conditions: (SQL | undefined)[] = [...baseConditions];

  if (options.cursor) {
    const decoded = decodeStudentCursor(options.cursor);
    if (!decoded) {
      return { items: [], pagination: { nextCursor: null, hasMore: false, limit } };
    }
    const cursorCond = or(
      gt(coursesTable.name, decoded.name),
      and(eq(coursesTable.name, decoded.name), gt(coursesTable.id, decoded.id)),
    );
    conditions.push(cursorCond);
  }

  const validConditions = conditions.filter((c): c is SQL => c !== undefined);

  const rawRows = await db
    .select()
    .from(coursesTable)
    .where(validConditions.length > 0 ? and(...validConditions) : undefined)
    .orderBy(coursesTable.name, coursesTable.id)
    .limit(limit + 1);

  const hasMore = rawRows.length > limit;
  const pageRows = hasMore ? rawRows.slice(0, limit) : rawRows;
  const lastRow = pageRows.at(-1);

  const nextCursor =
    hasMore && lastRow
      ? encodeCursor({ name: lastRow.name, id: lastRow.id })
      : null;

  return {
    items: pageRows,
    pagination: { nextCursor, hasMore, limit },
  };
}

/**
 * Fetches a single course by ID with soft-delete awareness.
 *
 * Intentionally does NOT apply a scope filter — the route handler performs
 * the Layer 3 coursePolicy.validateAccess() check after this call.
 *
 * Returning null means the course does not exist or has been soft-deleted (→ 404).
 * A found course whose id fails validateAccess yields 403, not 404 — this is
 * the explicit IDOR response required by the RBAC spec.
 */
export async function getCourseById(id: number): Promise<CourseRow | null> {
  const [row] = await db
    .select()
    .from(coursesTable)
    .where(and(eq(coursesTable.id, id), isNull(coursesTable.deletedAt)))
    .limit(1);

  return row ?? null;
}
