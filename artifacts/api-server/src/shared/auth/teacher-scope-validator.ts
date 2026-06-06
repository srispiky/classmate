import { inArray } from "drizzle-orm";
import type { SQL, Column } from "drizzle-orm";
import type { ScopeContext } from "../../lib/scope-context";
import { SQL_FALSE } from "../../lib/scope-filter";
import { CourseAuthorizationError } from "../../lib/course-scope-validator";

/**
 * Layer 3 — teacher-aware boolean course-access check.
 *
 * Unlike course-scope-validator.canAccessCourse(), this function enforces
 * teacher ownership — a teacher only accesses courses they own, not all courses.
 *
 * | Role    | Returns true when                                  |
 * |---------|----------------------------------------------------|
 * | admin   | always                                             |
 * | teacher | courseId ∈ scope.ownedCourseIds                    |
 * | student | courseId ∈ scope.enrolledCourseIds                 |
 * | parent  | courseId ∈ scope.childCourseIds                    |
 * | other   | never                                              |
 *
 * @param scope    - The ScopeContext built from req.session at route entry.
 * @param courseId - The course_id from the fetched row.
 */
export function canAccessCourse(scope: ScopeContext, courseId: number): boolean {
  if (scope.role === "admin") return true;

  if (scope.role === "teacher") {
    return scope.ownedCourseIds.includes(courseId);
  }

  if (scope.role === "student") {
    return scope.enrolledCourseIds.includes(courseId);
  }

  if (scope.role === "parent") {
    return scope.childCourseIds.includes(courseId);
  }

  return false;
}

/**
 * Layer 3 — teacher-aware course-access guard that throws on denial.
 *
 * Convenience wrapper around canAccessCourse() for use in route handlers that
 * prefer exception-based flow over explicit result checks.
 *
 * Reuses CourseAuthorizationError — no new error types introduced.
 *
 * @param scope    - The ScopeContext built from req.session at route entry.
 * @param courseId - The course_id from the fetched row.
 * @throws {CourseAuthorizationError} when access is denied.
 */
export function validateCourseAccess(scope: ScopeContext, courseId: number): void {
  if (!canAccessCourse(scope, courseId)) {
    throw new CourseAuthorizationError(courseId);
  }
}

/**
 * Returns true when the given courseId is owned by the requester in a
 * teacher-ownership sense.
 *
 * Designed for teacher-bound resource validation: does the caller have
 * teacher-level ownership over this course (write/manage operations)?
 *
 * | Role    | Returns true when                                  |
 * |---------|----------------------------------------------------|
 * | admin   | always (admins may act on any teacher-owned item)  |
 * | teacher | courseId ∈ scope.ownedCourseIds                    |
 * | student | never                                              |
 * | parent  | never                                              |
 * | other   | never                                              |
 *
 * @param scope    - The ScopeContext built from req.session at route entry.
 * @param courseId - The course_id to test ownership against.
 */
export function isTeacherOwnedCourse(scope: ScopeContext, courseId: number): boolean {
  if (scope.role === "admin") return true;
  if (scope.role === "teacher") return scope.ownedCourseIds.includes(courseId);
  return false;
}

/**
 * Layer 2 — teacher-aware WHERE condition for course-scoped resources.
 *
 * Canonical query-filter helper for resources that enforce teacher ownership.
 * Unlike applyCourseScopeFilter(), teachers are NOT granted global access —
 * they are filtered to their own courses via ownedCourseIds.
 *
 * | Role    | Condition                                               |
 * |---------|---------------------------------------------------------|
 * | admin   | undefined — no filter, full table access                |
 * | teacher | inArray(column, ownedCourseIds) — or SQL_FALSE           |
 * | student | inArray(column, enrolledCourseIds) — or SQL_FALSE        |
 * | parent  | inArray(column, childCourseIds) — or SQL_FALSE           |
 * | other   | SQL_FALSE — zero rows                                    |
 *
 * Usage:
 *   const conditions: SQL[] = [];
 *   const filter = applyTeacherScopeFilter(table.courseId, scope);
 *   if (filter !== undefined) conditions.push(filter);
 *
 * @param column - The course_id FK column of the resource table.
 * @param scope  - The ScopeContext built from req.session at route entry.
 */
export function applyTeacherScopeFilter(column: Column, scope: ScopeContext): SQL | undefined {
  if (scope.role === "admin") return undefined;

  if (scope.role === "teacher") {
    if (scope.ownedCourseIds.length === 0) return SQL_FALSE;
    return inArray(column, scope.ownedCourseIds);
  }

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
