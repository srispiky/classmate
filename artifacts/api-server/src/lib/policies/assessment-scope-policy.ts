import { assessmentsTable } from "@workspace/db";
import type { ScopeContext } from "../scope-context";
import { studentIdScopeFilter } from "../scope-filter";
import { canAccessStudentResource } from "../ownership";
import { PolicyAuthorizationError, type ResourceScopePolicy } from "./resource-scope-policy";
import type { SQL } from "drizzle-orm";

/**
 * Minimum shape required to validate assessment access.
 * Structural: any object with a numeric-or-null studentId field qualifies.
 */
export interface AssessmentLike {
  studentId: number | null | undefined;
}

/**
 * Authorization policy for Assessments (student-scoped resource).
 *
 * Identical authorization rules to AssignmentScopePolicy — both are
 * student-scoped resources. Keeping as a separate class preserves
 * independent evolvability (e.g. future assessment-specific rules).
 *
 * Layer 2 — getScopeCondition():
 *   Delegates to studentIdScopeFilter on the assessments.student_id column.
 *   | Role    | Condition                                      |
 *   |---------|------------------------------------------------|
 *   | admin   | undefined (no filter)                          |
 *   | teacher | undefined (no filter)                          |
 *   | student | eq(student_id, scope.studentId)                |
 *   | parent  | inArray(student_id, scope.childStudentIds)     |
 *   | other   | SQL_FALSE                                      |
 *
 * Layer 3 — validateAccess():
 *   Delegates to canAccessStudentResource for post-fetch ownership check.
 *   Throws PolicyAuthorizationError when access is denied.
 */
export class AssessmentScopePolicy implements ResourceScopePolicy<AssessmentLike> {
  getScopeCondition(scope: ScopeContext): SQL | undefined {
    return studentIdScopeFilter(assessmentsTable.studentId, scope);
  }

  validateAccess(scope: ScopeContext, resource: AssessmentLike): void {
    const result = canAccessStudentResource(resource.studentId, scope);
    if (result === "denied") {
      throw new PolicyAuthorizationError(
        `Access denied to assessment for student ${resource.studentId ?? "unknown"}`,
      );
    }
  }
}

export const assessmentPolicy = new AssessmentScopePolicy();
