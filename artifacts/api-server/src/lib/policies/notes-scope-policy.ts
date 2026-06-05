import { notesTable } from "@workspace/db";
import type { ScopeContext } from "../scope-context";
import { applyCourseScopeFilter } from "../course-scope-validator";
import { validateCourseAccess } from "../course-scope-validator";
import type { ResourceScopePolicy } from "./resource-scope-policy";
import type { SQL } from "drizzle-orm";

/**
 * Minimum shape required to validate note access.
 * Structural: any object with a numeric courseId field qualifies.
 */
export interface NoteLike {
  courseId: number;
}

/**
 * Authorization policy for Notes (course-scoped resource).
 *
 * Notes are NOT student-owned — they belong to a course. Authorization is
 * therefore based on course enrollment / parent-child course membership.
 *
 * Layer 2 — getScopeCondition():
 *   Delegates to applyCourseScopeFilter on the notes.course_id column.
 *   | Role    | Condition                                           |
 *   |---------|-----------------------------------------------------|
 *   | admin   | undefined (no filter)                               |
 *   | teacher | undefined (no filter)                               |
 *   | student | inArray(course_id, scope.enrolledCourseIds)         |
 *   | parent  | inArray(course_id, scope.childCourseIds)            |
 *   | other   | SQL_FALSE                                           |
 *
 * Layer 3 — validateAccess():
 *   Delegates to validateCourseAccess() from course-scope-validator.
 *   Throws CourseAuthorizationError (a PolicyAuthorizationError subclass)
 *   when access is denied — route handlers catching PolicyAuthorizationError
 *   will also catch CourseAuthorizationError.
 */
export class NotesScopePolicy implements ResourceScopePolicy<NoteLike> {
  getScopeCondition(scope: ScopeContext): SQL | undefined {
    return applyCourseScopeFilter(notesTable.courseId, scope);
  }

  validateAccess(scope: ScopeContext, resource: NoteLike): void {
    // validateCourseAccess throws CourseAuthorizationError extends PolicyAuthorizationError
    validateCourseAccess(scope, resource.courseId);
  }
}

export const notesPolicy = new NotesScopePolicy();
