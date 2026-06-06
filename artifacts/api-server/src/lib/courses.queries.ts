import { eq, and, isNull } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { db, coursesTable } from "@workspace/db";
import type { ScopeContext } from "./scope-context";
import { coursePolicy } from "../shared/auth/policies/course-scope-policy";

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

/**
 * Layer 2 — scope-filtered course list.
 *
 * Applies CourseScopePolicy at the database level — no in-memory filtering.
 * Ordered by course name for stable, predictable output.
 */
export async function listCourses(
  scope: ScopeContext,
  filters: Partial<CourseFilters> = {},
): Promise<CourseRow[]> {
  const conditions = buildCourseListConditions(scope, filters);
  return db
    .select()
    .from(coursesTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(coursesTable.name);
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
