import { announcementsTable } from "@workspace/db";
import type { ScopeContext } from "../scope-context";
import { applyTeacherScopeFilter, validateCourseAccess } from "../../shared/auth/teacher-scope-validator";
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
 * Authorization is always course-membership-based.
 *
 * AB-003 — Teacher ownership unification:
 *   Announcements now use the same ownership-scoped behaviour as Courses.
 *   Teachers only see announcements from courses they own (ownedCourseIds),
 *   not all announcements globally. This makes teacher behaviour consistent
 *   across all course-scoped resources.
 *
 * Layer 2 — getScopeCondition():
 *   Delegates to applyTeacherScopeFilter on the announcements.course_id column.
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
 *   Teachers must own the course to access an announcement inside it.
 *   Throws CourseAuthorizationError (a PolicyAuthorizationError subclass)
 *   when access is denied.
 */
export class AnnouncementScopePolicy implements ResourceScopePolicy<AnnouncementLike> {
  getScopeCondition(scope: ScopeContext): SQL | undefined {
    return applyTeacherScopeFilter(announcementsTable.courseId, scope);
  }

  validateAccess(scope: ScopeContext, resource: AnnouncementLike): void {
    validateCourseAccess(scope, resource.courseId);
  }
}

export const announcementPolicy = new AnnouncementScopePolicy();
