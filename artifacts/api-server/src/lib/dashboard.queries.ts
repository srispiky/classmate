import { inArray, isNull } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import {
  coursesTable,
  studentsTable,
  assignmentsTable,
  assessmentsTable,
  activityTable,
} from "@workspace/db";
import type { ScopeContext } from "./scope-context";
import { SQL_FALSE, teacherStudentEnrollmentFilter } from "./scope-filter";

/**
 * WHERE clause scoping the courses table to the caller's access in the dashboard.
 *
 * | Role    | Condition                                           |
 * |---------|-----------------------------------------------------|
 * | admin   | undefined — no filter, full table visible           |
 * | teacher | inArray(id, ownedCourseIds) — or SQL_FALSE if empty |
 * | other   | SQL_FALSE                                           |
 *
 * Exported for unit testing.
 */
export function buildDashboardCourseFilter(scope: ScopeContext): SQL | undefined {
  if (scope.role === "admin") return undefined;
  if (scope.role === "teacher") {
    if (scope.ownedCourseIds.length === 0) return SQL_FALSE;
    return inArray(coursesTable.id, scope.ownedCourseIds);
  }
  return SQL_FALSE;
}

/**
 * WHERE clause scoping the students table in the dashboard.
 * Teachers see only students enrolled in at least one of their owned courses.
 *
 * | Role    | Condition                                                    |
 * |---------|--------------------------------------------------------------|
 * | admin   | undefined — no filter                                        |
 * | teacher | subquery via course_enrollments — or SQL_FALSE if no courses |
 * | other   | SQL_FALSE                                                    |
 *
 * Exported for unit testing.
 */
export function buildDashboardStudentFilter(scope: ScopeContext): SQL | undefined {
  if (scope.role === "admin") return undefined;
  if (scope.role === "teacher") {
    return teacherStudentEnrollmentFilter(studentsTable.id, scope.ownedCourseIds);
  }
  return SQL_FALSE;
}

/**
 * WHERE clause scoping assignments (by courseId) in the dashboard.
 *
 * | Role    | Condition                                                   |
 * |---------|-------------------------------------------------------------|
 * | admin   | undefined — no filter                                       |
 * | teacher | inArray(courseId, ownedCourseIds) — or SQL_FALSE if empty   |
 * | other   | SQL_FALSE                                                   |
 *
 * Exported for unit testing.
 */
export function buildDashboardAssignmentFilter(scope: ScopeContext): SQL | undefined {
  if (scope.role === "admin") return undefined;
  if (scope.role === "teacher") {
    if (scope.ownedCourseIds.length === 0) return SQL_FALSE;
    return inArray(assignmentsTable.courseId, scope.ownedCourseIds);
  }
  return SQL_FALSE;
}

/**
 * WHERE clause scoping assessments (by courseId) in the dashboard.
 *
 * | Role    | Condition                                                   |
 * |---------|-------------------------------------------------------------|
 * | admin   | undefined — no filter                                       |
 * | teacher | inArray(courseId, ownedCourseIds) — or SQL_FALSE if empty   |
 * | other   | SQL_FALSE                                                   *
 *
 * Exported for unit testing.
 */
export function buildDashboardAssessmentFilter(scope: ScopeContext): SQL | undefined {
  if (scope.role === "admin") return undefined;
  if (scope.role === "teacher") {
    if (scope.ownedCourseIds.length === 0) return SQL_FALSE;
    return inArray(assessmentsTable.courseId, scope.ownedCourseIds);
  }
  return SQL_FALSE;
}

/**
 * WHERE clause scoping activity records to the caller's courses in the dashboard.
 * Filters on the courseId FK added in Sprint 7 Chunk 6.
 * Legacy activity rows (courseId = NULL) are excluded from teacher views by design —
 * NULL is never IN any array in SQL.
 *
 * | Role    | Condition                                                   |
 * |---------|-------------------------------------------------------------|
 * | admin   | undefined — no filter                                       |
 * | teacher | inArray(courseId, ownedCourseIds) — or SQL_FALSE if empty   |
 * | other   | SQL_FALSE                                                   |
 *
 * Exported for unit testing.
 */
export function buildDashboardActivityFilter(scope: ScopeContext): SQL | undefined {
  if (scope.role === "admin") return undefined;
  if (scope.role === "teacher") {
    if (scope.ownedCourseIds.length === 0) return SQL_FALSE;
    return inArray(activityTable.courseId, scope.ownedCourseIds);
  }
  return SQL_FALSE;
}
