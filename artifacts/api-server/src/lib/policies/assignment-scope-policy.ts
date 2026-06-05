import { assignmentsTable } from "@workspace/db";
import type { ScopeContext } from "../scope-context";
import { studentIdScopeFilter } from "../scope-filter";
import { canAccessStudentResource } from "../ownership";
import { PolicyAuthorizationError, type ResourceScopePolicy } from "./resource-scope-policy";
import type { SQL } from "drizzle-orm";

/**
 * Minimum shape required to validate assignment access.
 * Structural: any object with a numeric-or-null studentId field qualifies.
 */
export interface AssignmentLike {
  studentId: number | null | undefined;
}

/**
 * Authorization policy for Assignments (student-scoped resource).
 *
 * Layer 2 — getScopeCondition():
 *   Delegates to studentIdScopeFilter on the assignments.student_id column.
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
export class AssignmentScopePolicy implements ResourceScopePolicy<AssignmentLike> {
  getScopeCondition(scope: ScopeContext): SQL | undefined {
    return studentIdScopeFilter(assignmentsTable.studentId, scope);
  }

  validateAccess(scope: ScopeContext, resource: AssignmentLike): void {
    const result = canAccessStudentResource(resource.studentId, scope);
    if (result === "denied") {
      throw new PolicyAuthorizationError(
        `Access denied to assignment for student ${resource.studentId ?? "unknown"}`,
      );
    }
  }
}

export const assignmentPolicy = new AssignmentScopePolicy();
