export type RoleKey = "admin" | "teacher" | "student" | "parent" | "guest";

/**
 * Typed view of a fully-enriched Classmate session.
 * This is the input contract for buildScopeContext().
 * It mirrors the express-session SessionData fields written by SessionEnricherService.
 */
export interface ClassmateSession {
  userId: number;
  role: string;
  permissions: string[];
  permissionsVersion: number;
  studentId?: number;
  enrolledCourseIds?: number[];
  childStudentIds?: number[];
  /**
   * Pre-computed set of course IDs accessible through any linked child's active enrollments.
   * Populated by SessionEnricherService.enrichParent(). Empty array when parent has no children
   * or no children are enrolled. Used by course-scoped resources (notes, etc.) to avoid
   * per-request JOIN chains: parent → child → enrollment → course.
   */
  childCourseIds?: number[];
}

/**
 * Authorisation context for a single request.
 * Extracted from session once at route handler entry.
 * Passed to all query-builder functions — never pass req.session directly into query logic.
 *
 * Pure value: no DB access, no side effects.
 */
export interface ScopeContext {
  role: RoleKey;
  /** true for admin and teacher — skip all row-level filters */
  isGlobal: boolean;
  /** set for student role only; null if account is not yet linked to a student record */
  studentId: number | null;
  /** set for student role only; empty array if not enrolled in any course */
  enrolledCourseIds: number[];
  /** set for parent role only; empty array if no children are linked */
  childStudentIds: number[];
  /**
   * Pre-computed course IDs reachable through child enrollments (parent role only).
   * Empty array for all other roles. Used by course-scoped RLS filters instead of
   * a runtime subquery on course_enrollments, aligning with Sprint 3 §9e.
   */
  childCourseIds: number[];
  userId: number;
}

/**
 * Builds a ScopeContext from an enriched session.
 *
 * Pure function — no DB access, no side effects.
 * Call once per request at route handler entry.
 *
 * @example
 *   const scope = buildScopeContext(req.session as ClassmateSession);
 */
export function buildScopeContext(session: ClassmateSession): ScopeContext {
  const role = session.role as RoleKey;
  const isGlobal = role === "admin" || role === "teacher";

  return {
    role,
    isGlobal,
    studentId: role === "student" ? (session.studentId ?? null) : null,
    enrolledCourseIds: role === "student" ? (session.enrolledCourseIds ?? []) : [],
    childStudentIds: role === "parent" ? (session.childStudentIds ?? []) : [],
    childCourseIds: role === "parent" ? (session.childCourseIds ?? []) : [],
    userId: session.userId,
  };
}
