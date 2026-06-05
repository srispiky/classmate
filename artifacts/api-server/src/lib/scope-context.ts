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
  // ── student fields ─────────────────────────────────────────────────────────
  studentId?: number;
  enrolledCourseIds?: number[];
  // ── parent fields ──────────────────────────────────────────────────────────
  childStudentIds?: number[];
  /**
   * Pre-computed set of course IDs accessible through any linked child's active enrollments.
   * Populated by SessionEnricherService.enrichParent(). Empty array when parent has no children
   * or no children are enrolled. Used by course-scoped resources (notes, etc.) to avoid
   * per-request JOIN chains: parent → child → enrollment → course.
   */
  childCourseIds?: number[];
  // ── teacher fields ─────────────────────────────────────────────────────────
  /**
   * The ID of the logged-in teacher (= users.id for teacher-role accounts).
   * Maps directly to courses.teacher_id. Populated by SessionEnricherService.enrichTeacher().
   */
  teacherId?: number;
  /**
   * Pre-computed list of course IDs owned by this teacher (active, non-deleted).
   * Populated by SessionEnricherService.enrichTeacher(). Empty array when the teacher
   * owns no courses. Never undefined after enrichment.
   */
  ownedCourseIds?: number[];
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
  /**
   * The teacher's identity (= users.id for teacher-role accounts).
   * Set for teacher role only; null for all other roles.
   * Maps directly to courses.teacher_id for ownership queries.
   */
  teacherId: number | null;
  /**
   * Pre-computed course IDs owned by this teacher (active, non-deleted).
   * Set for teacher role only; always an empty array for all other roles.
   * Never null, never undefined — always a valid array.
   */
  ownedCourseIds: number[];
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
    teacherId: role === "teacher" ? (session.teacherId ?? null) : null,
    ownedCourseIds: role === "teacher" ? (session.ownedCourseIds ?? []) : [],
    userId: session.userId,
  };
}
