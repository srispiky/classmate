import { notesTable } from "@workspace/db";
import type { ScopeContext } from "../scope-context";
import { applyTeacherScopeFilter, validateCourseAccess } from "../../shared/auth/teacher-scope-validator";
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
 * based on course membership / ownership.
 *
 * AB-003 — Teacher ownership unification:
 *   Notes now use the same ownership-scoped behaviour as Courses. Teachers
 *   only see notes from courses they own (ownedCourseIds), not all notes
 *   globally. This makes teacher behaviour consistent across all
 *   course-scoped resources.
 *
 * Layer 2 — getScopeCondition():
 *   Delegates to applyTeacherScopeFilter on the notes.course_id column.
 *
 *   | Role    | Condition                                                |
 *   |---------|----------------------------------------------------------|
 *   | admin   | undefined (no filter — full table access)                |
 *   | teacher | inArray(course_id, ownedCourseIds) or SQL_FALSE           |
 *   | student | inArray(course_id, enrolledCourseIds) or SQL_FALSE        |
 *   | parent  | inArray(course_id, childCourseIds) or SQL_FALSE           |
 *   | other   | SQL_FALSE                                                 |
 *
 * Layer 3 — validateAccess():
 *   Delegates to validateCourseAccess() from teacher-scope-validator.
 *   Teachers must own the course to access a note inside it.
 *   Throws CourseAuthorizationError (a PolicyAuthorizationError subclass)
 *   when access is denied — route handlers catching PolicyAuthorizationError
 *   also catch CourseAuthorizationError.
 */
export class NotesScopePolicy implements ResourceScopePolicy<NoteLike> {
  getScopeCondition(scope: ScopeContext): SQL | undefined {
    return applyTeacherScopeFilter(notesTable.courseId, scope);
  }

  validateAccess(scope: ScopeContext, resource: NoteLike): void {
    validateCourseAccess(scope, resource.courseId);
  }
}

export const notesPolicy = new NotesScopePolicy();
