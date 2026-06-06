import { assignmentsTable } from "@workspace/db";
import type { ScopeContext } from "../scope-context";
import { mixedResourceScopeFilter } from "../scope-filter";
import { canAccessMixedResource } from "../ownership";
import { PolicyAuthorizationError, type ResourceScopePolicy } from "./resource-scope-policy";
import type { SQL } from "drizzle-orm";

/**
 * Minimum shape required to validate assignment access.
 * Structural: any object with studentId and courseId fields qualifies.
 * Both fields are required for role-specific checks:
 * - teacher: courseId is used for ownership validation against scope.ownedCourseIds
 * - student/parent: studentId is used for ownership validation
 */
export interface AssignmentLike {
  studentId: number | null | undefined;
  courseId?: number | null;
}

/**
 * Authorization policy for Assignments (mixed course+student scoped resource).
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
export class AssignmentScopePolicy implements ResourceScopePolicy<AssignmentLike> {
  getScopeCondition(scope: ScopeContext): SQL | undefined {
    return mixedResourceScopeFilter(assignmentsTable.courseId, assignmentsTable.studentId, scope);
  }

  validateAccess(scope: ScopeContext, resource: AssignmentLike): void {
    const result = canAccessMixedResource(resource.studentId, resource.courseId, scope);
    if (result === "denied") {
      throw new PolicyAuthorizationError(
        `Access denied to assignment (courseId=${resource.courseId ?? "unknown"}, studentId=${resource.studentId ?? "unknown"})`,
      );
    }
  }
}

export const assignmentPolicy = new AssignmentScopePolicy();
