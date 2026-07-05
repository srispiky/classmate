import { studentsTable } from "@workspace/db";
import type { SQL } from "drizzle-orm";
import type { ScopeContext } from "../scope-context";
import { SQL_FALSE } from "../scope-filter";
import { inArray } from "drizzle-orm";
import { PolicyAuthorizationError, type ResourceScopePolicy } from "./resource-scope-policy";

/**
 * Minimum shape required to validate parent access to a student resource.
 */
export interface ParentStudentLike {
  id: number;
}

/**
 * Authorization policy for Parent → Student access.
 *
 * Layer 2 — getScopeCondition():
 *   | Role   | Condition                                          |
 *   |--------|----------------------------------------------------|
 *   | parent | students.id IN (childStudentIds) or SQL_FALSE      |
 *   | other  | SQL_FALSE — denied at Layer 1 before this runs     |
 *
 * Layer 3 — validateAccess():
 *   Parent: allowed only if the student is in scope.childStudentIds.
 *   All other roles: denied (parent endpoints are parent-only at Layer 1).
 *
 * Read-only: parents never mutate student resources.
 * No DB calls inside the policy — all decisions use pre-computed session scope.
 */
export class ParentScopePolicy implements ResourceScopePolicy<ParentStudentLike> {
  getScopeCondition(scope: ScopeContext): SQL | undefined {
    if (scope.role !== "parent") return SQL_FALSE;
    if (scope.childStudentIds.length === 0) return SQL_FALSE;
    return inArray(studentsTable.id, scope.childStudentIds);
  }

  /**
   * Layer 3 ownership guard.
   *
   * Throws PolicyAuthorizationError when the student is not in the parent's
   * childStudentIds list. IDOR-safe — callers map all denials to 404.
   */
  validateAccess(scope: ScopeContext, resource: ParentStudentLike): void {
    if (scope.role !== "parent") {
      throw new PolicyAuthorizationError("Only parents may access parent endpoints");
    }
    if (!scope.childStudentIds.includes(resource.id)) {
      throw new PolicyAuthorizationError(
        `Parent (userId=${scope.userId}) is not a guardian of student (id=${resource.id})`,
      );
    }
  }
}

export const parentScopePolicy = new ParentScopePolicy();
