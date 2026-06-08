import { listCourses, getCourseById, type CourseRow } from "./courses.queries";
import type { ScopeContext } from "./scope-context";

export type { CourseRow };

/**
 * Repository: student-scoped course list.
 *
 * Delegates to the shared listCourses() which applies CourseScopePolicy
 * at the DB level. For student role, CourseScopePolicy.getScopeCondition()
 * emits inArray(id, enrolledCourseIds) — the scope is enforced in SQL,
 * not in application memory.
 *
 * No additional in-memory filtering: if CourseScopePolicy emits SQL_FALSE
 * (empty enrolledCourseIds), the DB returns zero rows.
 */
export async function listStudentCourses(scope: ScopeContext): Promise<CourseRow[]> {
  return listCourses(scope);
}

/**
 * Repository: fetch a single course by ID with soft-delete awareness.
 *
 * Does NOT apply a scope filter — enrollment ownership is enforced by the
 * service layer before this function is called (scope.enrolledCourseIds check).
 * Returns null for deleted or non-existent courses.
 */
export async function getStudentCourseById(courseId: number): Promise<CourseRow | null> {
  return getCourseById(courseId);
}
