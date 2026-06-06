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
 * WHERE clause for course-scoped resources (notes, announcements, study materials, etc.).
 *
 * Used by: notes. Prefer applyCourseScopeFilter() from course-scope-validator for
 * application-layer query builders — it is the canonical public API. This function is
 * the primitive implementation it delegates to.
 *
 * | Role    | Condition                                               |
 * |---------|--------------------------------------------------------|
 * | admin   | undefined — no filter                                   |
 * | teacher | undefined — no filter                                   |
 * | student | inArray(column, enrolledCourseIds) — or SQL_FALSE        |
 * | parent  | inArray(column, childCourseIds) — or SQL_FALSE           |
 * | other   | SQL_FALSE                                                |
 *
 * Parent scope uses scope.childCourseIds (pre-computed by SessionEnricher at login).
 * This avoids a per-request subquery on course_enrollments. Sprint 3 §9e.
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
    if (scope.childCourseIds.length === 0) return SQL_FALSE;
    return inArray(column, scope.childCourseIds);
  }

  return SQL_FALSE;
}

/**
 * WHERE clause for resources that carry BOTH a course_id FK (teacher access)
 * AND a student_id FK (student/parent access).
 *
 * Used by: assignments, assessments. Replaces studentIdScopeFilter for these
 * resources to enforce teacher course-ownership (Sprint 4 Chunk 9).
 *
 * | Role    | Column used   | Condition                                         |
 * |---------|---------------|---------------------------------------------------|
 * | admin   | —             | undefined — no filter, full table visible         |
 * | teacher | courseIdColumn| inArray(course_id, ownedCourseIds) or SQL_FALSE   |
 * | student | studentId     | eq(student_id, studentId) or SQL_FALSE if null    |
 * | parent  | studentId     | inArray(student_id, childStudentIds) or SQL_FALSE |
 * | other   | —             | SQL_FALSE                                         |
 *
 * Teacher access is course-ownership based (not student-based).
 * Student and parent access rules are unchanged from studentIdScopeFilter.
 *
 * @param courseIdColumn   - The course_id FK column (used for teacher scope).
 * @param studentIdColumn  - The student_id FK column (used for student/parent scope).
 * @param scope            - The ScopeContext built from req.session at route entry.
 */
export function mixedResourceScopeFilter(
  courseIdColumn: Column,
  studentIdColumn: Column,
  scope: ScopeContext,
): SQL | undefined {
  if (scope.role === "admin") return undefined;

  if (scope.role === "teacher") {
    if (scope.ownedCourseIds.length === 0) return SQL_FALSE;
    return inArray(courseIdColumn, scope.ownedCourseIds);
  }

  if (scope.role === "student") {
    if (scope.studentId === null) return SQL_FALSE;
    return eq(studentIdColumn, scope.studentId);
  }

  if (scope.role === "parent") {
    if (scope.childStudentIds.length === 0) return SQL_FALSE;
    return inArray(studentIdColumn, scope.childStudentIds);
  }

  return SQL_FALSE;
}

/**
 * Low-level WHERE clause that restricts a course_id column to courses attended
 * by any of the supplied child students.
 *
 * Generates a correlated subquery against course_enrollments:
 *   column IN (
 *     SELECT DISTINCT ce.course_id
 *     FROM course_enrollments ce
 *     WHERE ce.student_id = ANY(ARRAY[...childStudentIds]::integer[])
 *     AND ce.is_active = true
 *   )
 *
 * Returns SQL_FALSE when childStudentIds is empty.
 * child IDs are guaranteed integers (number[]) — sql.raw() is safe here (no user-supplied strings).
 *
 * NOTE: This function is retained as a low-level primitive. Application-layer query builders
 * should use courseIdScopeFilter() (or applyCourseScopeFilter from course-scope-validator)
 * which reads pre-computed childCourseIds from scope rather than issuing a subquery.
 * Use this function only when you need a runtime subquery and cannot rely on session data.
 *
 * @param courseColumn     - The course_id FK column of the resource table.
 * @param childStudentIds  - The child student IDs to resolve enrollments for.
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
