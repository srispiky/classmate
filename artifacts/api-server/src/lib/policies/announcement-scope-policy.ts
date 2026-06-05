import { announcementsTable } from "@workspace/db";
import type { ScopeContext } from "../scope-context";
import { applyCourseScopeFilter, validateCourseAccess } from "../course-scope-validator";
import type { ResourceScopePolicy } from "./resource-scope-policy";
import type { SQL } from "drizzle-orm";

/**
 * Minimum shape required to validate announcement access.
 * Structural: any object with a numeric courseId field qualifies.
 */
export interface AnnouncementLike {
  courseId: number;
}

/**
 * Authorization policy for Announcements (course-scoped resource).
 *
 * Announcements belong to a course, not an individual student.
 * Authorization is always course-enrollment-based — never student-ownership-based.
 *
 * Layer 2 — getScopeCondition():
 *   Delegates to applyCourseScopeFilter on the announcements.course_id column.
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
 *
 * Implementation is intentionally identical to NotesScopePolicy — both are
 * course-scoped resources using the same enrollment-based authorization rules.
 */
export class AnnouncementScopePolicy implements ResourceScopePolicy<AnnouncementLike> {
  getScopeCondition(scope: ScopeContext): SQL | undefined {
    return applyCourseScopeFilter(announcementsTable.courseId, scope);
  }

  validateAccess(scope: ScopeContext, resource: AnnouncementLike): void {
    // validateCourseAccess throws CourseAuthorizationError extends PolicyAuthorizationError
    validateCourseAccess(scope, resource.courseId);
  }
}

export const announcementPolicy = new AnnouncementScopePolicy();
