import { coursesTable } from "@workspace/db";
import type { SQL } from "drizzle-orm";
import type { ScopeContext } from "../../../lib/scope-context";
import type { ResourceScopePolicy } from "../../../lib/policies/resource-scope-policy";
import {
  applyTeacherScopeFilter,
  validateCourseAccess,
} from "../teacher-scope-validator";

/**
 * Minimum shape required to validate course access.
 * Structural: any object with a numeric id field qualifies.
 */
export interface CourseLike {
  id: number;
}

/**
 * Authorization policy for Course resources.
 *
 * The first policy to enforce teacher ownership boundaries — teachers see
 * only the courses they own, not all courses.
 *
 * Layer 2 — getScopeCondition():
 *   Delegates to applyTeacherScopeFilter on the courses.id column.
 *
 *   | Role    | Condition                                           |
 *   |---------|-----------------------------------------------------|
 *   | admin   | undefined (no filter — full table access)           |
 *   | teacher | inArray(id, scope.ownedCourseIds) — or SQL_FALSE    |
 *   | student | inArray(id, scope.enrolledCourseIds) — or SQL_FALSE |
 *   | parent  | inArray(id, scope.childCourseIds) — or SQL_FALSE    |
 *   | other   | SQL_FALSE                                           |
 *
 * Layer 3 — validateAccess():
 *   Delegates to validateCourseAccess() from TeacherScopeValidator.
 *   Throws CourseAuthorizationError (a PolicyAuthorizationError subclass)
 *   when access is denied.
 *
 * No authorization logic lives in this class — all decisions are delegated
 * to TeacherScopeValidator, keeping the policy thin and consistent.
 */
export class CourseScopePolicy implements ResourceScopePolicy<CourseLike> {
  getScopeCondition(scope: ScopeContext): SQL | undefined {
    return applyTeacherScopeFilter(coursesTable.id, scope);
  }

  validateAccess(scope: ScopeContext, resource: CourseLike): void {
    validateCourseAccess(scope, resource.id);
  }
}

export const coursePolicy = new CourseScopePolicy();
