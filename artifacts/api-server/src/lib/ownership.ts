import type { ScopeContext } from "./scope-context";

/**
 * Result of a Layer 3 ownership check.
 * Returned by canAccess* helpers — route handlers map this to 403/200.
 */
export type OwnershipResult = "allowed" | "denied";

/**
 * Layer 3 — Post-fetch ownership check for student-owned resources.
 *
 * Called after a single resource is fetched by :id. Returns 'denied' if the
 * resource does not belong to the requester's scope, stopping serialisation
 * before any data is returned (Sprint 3 §2a Layer 3).
 *
 * Used by: assignments/:id, assessments/:id, activity/:id.
 *
 * | Role    | Allowed when                                            |
 * |---------|---------------------------------------------------------|
 * | admin   | always                                                  |
 * | teacher | always                                                  |
 * | student | resourceStudentId === scope.studentId (and not null)    |
 * | parent  | resourceStudentId ∈ scope.childStudentIds               |
 * | other   | never                                                   |
 *
 * @param resourceStudentId - The student_id field from the fetched row.
 * @param scope             - The ScopeContext built from req.session.
 */
export function canAccessStudentResource(
  resourceStudentId: number | null | undefined,
  scope: ScopeContext,
): OwnershipResult {
  if (scope.isGlobal) return "allowed";

  if (resourceStudentId == null) return "denied";

  if (scope.role === "student") {
    return scope.studentId !== null && resourceStudentId === scope.studentId
      ? "allowed"
      : "denied";
  }

  if (scope.role === "parent") {
    return scope.childStudentIds.includes(resourceStudentId) ? "allowed" : "denied";
  }

  return "denied";
}

/**
 * Layer 3 — Post-fetch ownership check for course-scoped resources.
 *
 * Used by: notes/:id, courses/:id.
 *
 * For student role: checks resourceCourseId ∈ scope.enrolledCourseIds.
 * For parent role: returns 'allowed' — the Layer 2 subquery already filtered
 * correctly and childStudentIds' enrolled courses are not cached in scope.
 * See Sprint 3 §9e for the deferred childEnrolledCourseIds optimisation.
 *
 * @param resourceCourseId - The course_id field from the fetched row.
 * @param scope            - The ScopeContext built from req.session.
 */
export function canAccessCourseResource(
  resourceCourseId: number | null | undefined,
  scope: ScopeContext,
): OwnershipResult {
  if (scope.isGlobal) return "allowed";

  if (resourceCourseId == null) return "denied";

  if (scope.role === "student") {
    return scope.enrolledCourseIds.includes(resourceCourseId) ? "allowed" : "denied";
  }

  if (scope.role === "parent") {
    // Parent course access is validated by the Layer 2 subquery (parentCourseEnrollmentFilter).
    // Layer 3 trusts the query output. See Sprint 3 §9e for future childEnrolledCourseIds caching.
    return "allowed";
  }

  return "denied";
}
