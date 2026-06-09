import { studentsTable } from "@workspace/db";
import type { SQL } from "drizzle-orm";
import type { ScopeContext } from "../scope-context";
import { teacherStudentEnrollmentFilter, SQL_FALSE } from "../scope-filter";
import { PolicyAuthorizationError, type ResourceScopePolicy } from "./resource-scope-policy";

/**
 * Minimum shape required to validate student access.
 *
 * enrolledCourseIds must be pre-fetched by the route handler from course_enrollments
 * before calling validateAccess. This keeps the policy free of DB calls while still
 * enabling teacher ownership validation at Layer 3.
 */
export interface StudentLike {
  id: number;
  /** Active course IDs the student is enrolled in — sourced from course_enrollments. */
  enrolledCourseIds: number[];
}

/**
 * Authorization policy for Student resources.
 *
 * Layer 2 — getScopeCondition():
 *   | Role    | Condition                                                          |
 *   |---------|--------------------------------------------------------------------|
 *   | admin   | undefined (no filter — full table access)                          |
 *   | teacher | students.id IN (SELECT student_id FROM course_enrollments           |
 *   |         |   WHERE course_id = ANY(ownedCourseIds) AND is_active = true)       |
 *   |         |   — or SQL_FALSE if teacher owns no courses                         |
 *   | other   | SQL_FALSE                                                          |
 *
 * Layer 3 — validateAccess():
 *   Admin: always allowed.
 *   Teacher: allowed only if the student is enrolled in at least one of the
 *     teacher's owned courses (scope.ownedCourseIds ∩ resource.enrolledCourseIds ≠ ∅).
 *   All other roles: denied (students endpoint is admin/teacher-only at Layer 1).
 *
 * No authorization logic lives in this class beyond delegating to scope-filter
 * helpers and comparing pre-computed ID sets.
 */
export class StudentScopePolicy implements ResourceScopePolicy<StudentLike> {
  getScopeCondition(scope: ScopeContext): SQL | undefined {
    if (scope.role === "admin") return undefined;
    if (scope.role === "teacher") {
      return teacherStudentEnrollmentFilter(studentsTable.id, scope.ownedCourseIds);
    }
    return SQL_FALSE;
  }

  validateAccess(scope: ScopeContext, resource: StudentLike): void {
    if (scope.role === "admin") return;

    if (scope.role === "teacher") {
      const hasAccess = resource.enrolledCourseIds.some((cid) =>
        scope.ownedCourseIds.includes(cid),
      );
      if (!hasAccess) {
        throw new PolicyAuthorizationError(
          `Teacher does not teach student (id=${resource.id})`,
        );
      }
      return;
    }

    throw new PolicyAuthorizationError("Access denied to student resource");
  }
}

export const studentPolicy = new StudentScopePolicy();
