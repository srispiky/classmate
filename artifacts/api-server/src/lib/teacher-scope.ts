/**
 * Teacher ownership scope helpers — Sprint 4 Chunk 4
 *
 * Reusable utilities for checking course ownership within a ScopeContext.
 * These helpers are pure functions: no DB access, no side effects.
 * All ownership information comes from scope.ownedCourseIds, which is
 * pre-computed at login time by SessionEnricherService.enrichTeacher().
 *
 * Role behaviours:
 *   admin   — owns every course (global access)
 *   teacher — owns courses listed in scope.ownedCourseIds
 *   student — does not own any course
 *   parent  — does not own any course
 *   guest   — does not own any course
 *
 * These helpers are infrastructure only. Authorization policies that consume
 * them (CourseScopePolicy, AssignmentScopePolicy, etc.) are introduced in
 * subsequent Sprint 4 chunks.
 */
import type { ScopeContext } from "./scope-context";

/**
 * Returns true if the requesting user has ownership access to the given course.
 *
 * Admin: always true (global access, no ownership boundary).
 * Teacher: true only when courseId is present in scope.ownedCourseIds.
 * All other roles: false — ownership is not a concept that applies to them.
 *
 * @param scope    The request-scoped authorization context.
 * @param courseId The numeric ID of the course to check.
 */
export function isOwnedCourse(scope: ScopeContext, courseId: number): boolean {
  if (scope.role === "admin") return true;
  if (scope.role === "teacher") return scope.ownedCourseIds.includes(courseId);
  return false;
}

/**
 * Returns true when the teacher's scope contains at least one owned course.
 * Returns false for all non-teacher roles (their ownedCourseIds is always []).
 *
 * Useful as a fast pre-check before iterating ownedCourseIds.
 *
 * @param scope The request-scoped authorization context.
 */
export function hasOwnedCourses(scope: ScopeContext): boolean {
  return scope.ownedCourseIds.length > 0;
}

/**
 * Returns the list of course IDs owned by this teacher.
 * Returns an empty array for all non-teacher roles.
 *
 * The returned array is the same reference stored in scope — do not mutate it.
 *
 * @param scope The request-scoped authorization context.
 */
export function getOwnedCourseIds(scope: ScopeContext): number[] {
  return scope.ownedCourseIds;
}
