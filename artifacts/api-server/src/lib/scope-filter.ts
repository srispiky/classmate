import { sql, eq, inArray } from "drizzle-orm";
import type { SQL, Column } from "drizzle-orm";
import type { ScopeContext } from "./scope-context";

/**
 * Sentinel returned when a scope constraint must produce zero rows.
 * Avoids null checks in callers — always a valid Drizzle WHERE condition.
 *
 * Cases: unlinked student (studentId=null), empty enrolledCourseIds, empty childStudentIds.
 * PostgreSQL evaluates WHERE false — no rows returned. Correct by design (Sprint 3 §8g).
 */
export const SQL_FALSE: SQL = sql`false`;

/**
 * WHERE clause for resources that carry a student_id FK.
 *
 * Used by: assignments, assessments, activity, students (list).
 *
 * | Role    | Condition                                        |
 * |---------|--------------------------------------------------|
 * | admin   | undefined — no filter, full table visible        |
 * | teacher | undefined — no filter, full table visible        |
 * | student | eq(column, studentId) — or SQL_FALSE if unlinked |
 * | parent  | inArray(column, childStudentIds) — or SQL_FALSE  |
 * | other   | SQL_FALSE — zero rows                            |
 *
 * @param column  - The student_id FK column of the resource table.
 * @param scope   - The ScopeContext built from req.session at route entry.
 */
export function studentIdScopeFilter(column: Column, scope: ScopeContext): SQL | undefined {
  if (scope.isGlobal) return undefined;

  if (scope.role === "student") {
    if (scope.studentId === null) return SQL_FALSE;
    return eq(column, scope.studentId);
  }

  if (scope.role === "parent") {
    if (scope.childStudentIds.length === 0) return SQL_FALSE;
    return inArray(column, scope.childStudentIds);
  }

  return SQL_FALSE;
}

/**
 * WHERE clause for student access to course-scoped resources.
 *
 * Used by: notes (student role), courses (student role).
 *
 * Parent course scope requires a correlated subquery — use parentCourseEnrollmentFilter() instead.
 * When role === 'parent' this function returns undefined so the caller can compose the subquery.
 *
 * | Role    | Condition                                             |
 * |---------|-------------------------------------------------------|
 * | admin   | undefined — no filter                                 |
 * | teacher | undefined — no filter                                 |
 * | student | inArray(column, enrolledCourseIds) — or SQL_FALSE     |
 * | parent  | undefined — caller MUST apply parentCourseEnrollmentFilter() |
 * | other   | SQL_FALSE                                             |
 *
 * @param column  - The course_id FK column of the resource table.
 * @param scope   - The ScopeContext built from req.session at route entry.
 */
export function courseIdScopeFilter(column: Column, scope: ScopeContext): SQL | undefined {
  if (scope.isGlobal) return undefined;

  if (scope.role === "student") {
    if (scope.enrolledCourseIds.length === 0) return SQL_FALSE;
    return inArray(column, scope.enrolledCourseIds);
  }

  if (scope.role === "parent") {
    // Parent course scope is resolved with a subquery against course_enrollments.
    // Returning undefined so the caller knows to apply parentCourseEnrollmentFilter().
    return undefined;
  }

  return SQL_FALSE;
}

/**
 * WHERE clause for parent access to course-scoped resources.
 *
 * Generates a correlated subquery against course_enrollments:
 *   column IN (
 *     SELECT DISTINCT ce.course_id
 *     FROM course_enrollments ce
 *     WHERE ce.student_id = ANY(ARRAY[...childStudentIds]::integer[])
 *     AND ce.is_active = true
 *   )
 *
 * Returns SQL_FALSE when childStudentIds is empty — zero rows returned, correct by design.
 * child IDs are guaranteed integers (number[]) — sql.raw() is safe here (no user-supplied strings).
 *
 * @param courseColumn     - The course_id FK column of the resource table.
 * @param childStudentIds  - From scope.childStudentIds.
 */
export function parentCourseEnrollmentFilter(courseColumn: Column, childStudentIds: number[]): SQL {
  if (childStudentIds.length === 0) return SQL_FALSE;

  const idsLiteral = childStudentIds.map(String).join(",");
  return sql`${courseColumn} IN (
    SELECT DISTINCT ce.course_id
    FROM course_enrollments ce
    WHERE ce.student_id = ANY(ARRAY[${sql.raw(idsLiteral)}]::integer[])
    AND ce.is_active = true
  )`;
}
