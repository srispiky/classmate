import { assessmentsTable } from "@workspace/db";
import type { ScopeContext } from "../scope-context";
import { mixedResourceScopeFilter } from "../scope-filter";
import { canAccessMixedResource } from "../ownership";
import { PolicyAuthorizationError, type ResourceScopePolicy } from "./resource-scope-policy";
import type { SQL } from "drizzle-orm";

/**
 * Minimum shape required to validate assessment access.
 * Structural: any object with studentId and courseId fields qualifies.
 * Both fields are required for role-specific checks:
 * - teacher: courseId is used for ownership validation against scope.ownedCourseIds
 * - student/parent: studentId is used for ownership validation
 */
export interface AssessmentLike {
  studentId: number | null | undefined;
  courseId?: number | null;
}

/**
 * Authorization policy for Assessments (mixed course+student scoped resource).
 *
 * Identical authorization rules to AssignmentScopePolicy — both are
 * mixed-resource (courseId + studentId) scoped. Keeping as a separate class
 * preserves independent evolvability (e.g. future assessment-specific rules).
 *
 * Layer 2 — getScopeCondition():
 *   Delegates to mixedResourceScopeFilter.
 *   | Role    | Column    | Condition                                      |
 *   |---------|-----------|------------------------------------------------|
 *   | admin   | —         | undefined (no filter)                          |
 *   | teacher | courseId  | inArray(course_id, ownedCourseIds) or SQL_FALSE |
 *   | student | studentId | eq(student_id, scope.studentId)                |
 *   | parent  | studentId | inArray(student_id, scope.childStudentIds)     |
 *   | other   | —         | SQL_FALSE                                      |
 *
 * Layer 3 — validateAccess():
 *   Delegates to canAccessMixedResource for post-fetch ownership check.
 *   Teacher access is validated against scope.ownedCourseIds (course ownership).
 *   Throws PolicyAuthorizationError when access is denied.
 */
export class AssessmentScopePolicy implements ResourceScopePolicy<AssessmentLike> {
  getScopeCondition(scope: ScopeContext): SQL | undefined {
    return mixedResourceScopeFilter(assessmentsTable.courseId, assessmentsTable.studentId, scope);
  }

  validateAccess(scope: ScopeContext, resource: AssessmentLike): void {
    const result = canAccessMixedResource(resource.studentId, resource.courseId, scope);
    if (result === "denied") {
      throw new PolicyAuthorizationError(
        `Access denied to assessment (courseId=${resource.courseId ?? "unknown"}, studentId=${resource.studentId ?? "unknown"})`,
      );
    }
  }
}

export const assessmentPolicy = new AssessmentScopePolicy();
