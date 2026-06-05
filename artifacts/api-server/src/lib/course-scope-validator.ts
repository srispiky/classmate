import type { SQL, Column } from "drizzle-orm";
import type { ScopeContext } from "./scope-context";
import { courseIdScopeFilter } from "./scope-filter";

/**
 * Thrown by validateCourseAccess() when a requester's scope does not include
 * the requested course. Route handlers catch this and return 403.
 */
export class CourseAuthorizationError extends Error {
  readonly courseId: number;

  constructor(courseId: number) {
    super(`Access denied to course ${courseId}`);
    this.name = "CourseAuthorizationError";
    this.courseId = courseId;
  }
}

/**
 * Layer 3 — boolean course-access check.
 *
 * Determines whether the requester's scope includes the given course. Use for
 * post-fetch validation of single-resource responses (detail endpoints).
 *
 * | Role    | Returns true when                                  |
 * |---------|----------------------------------------------------|
 * | admin   | always                                             |
 * | teacher | always                                             |
 * | student | courseId ∈ scope.enrolledCourseIds                 |
 * | parent  | courseId ∈ scope.childCourseIds                    |
 * | other   | never                                              |
 *
 * @param scope    - The ScopeContext built from req.session at route entry.
 * @param courseId - The course_id from the fetched row.
 */
export function canAccessCourse(scope: ScopeContext, courseId: number): boolean {
  if (scope.isGlobal) return true;

  if (scope.role === "student") {
    return scope.enrolledCourseIds.includes(courseId);
  }

  if (scope.role === "parent") {
    return scope.childCourseIds.includes(courseId);
  }

  return false;
}

/**
 * Layer 3 — course-access guard that throws on denial.
 *
 * Convenience wrapper around canAccessCourse() for use in route handlers that
 * prefer exception-based flow over explicit result checks.
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
 * Layer 2 — reusable WHERE condition for course-scoped resources.
 *
 * Canonical query-filter helper for any resource with a course_id FK. Returns a
 * Drizzle SQL condition suitable for use in a .where() clause or spread into a
 * conditions array alongside other predicates.
 *
 * This is the public API for course-scoped query builders. Internally delegates to
 * courseIdScopeFilter() from scope-filter.ts.
 *
 * Usage:
 *   const conditions: SQL[] = [];
 *   const courseFilter = applyCourseScopeFilter(table.courseId, scope);
 *   if (courseFilter !== undefined) conditions.push(courseFilter);
 *
 * | Role    | Condition                                               |
 * |---------|---------------------------------------------------------|
 * | admin   | undefined — no filter, full table access                |
 * | teacher | undefined — no filter, full table access                |
 * | student | inArray(column, enrolledCourseIds) — or SQL_FALSE        |
 * | parent  | inArray(column, childCourseIds) — or SQL_FALSE           |
 * | other   | SQL_FALSE — zero rows                                    |
 *
 * Future course-scoped resources (announcements, study materials, discussions)
 * should import this function rather than calling courseIdScopeFilter directly.
 *
 * @param column - The course_id FK column of the resource table.
 * @param scope  - The ScopeContext built from req.session at route entry.
 */
export function applyCourseScopeFilter(column: Column, scope: ScopeContext): SQL | undefined {
  return courseIdScopeFilter(column, scope);
}
