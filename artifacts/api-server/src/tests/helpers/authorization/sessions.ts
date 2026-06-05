/**
 * Authorization test session factories.
 *
 * Each factory returns a fully-typed ScopeContext ready for use in
 * policy and query-condition tests. They replace ad-hoc session
 * literal objects scattered across individual test files.
 *
 * Defaults are chosen to represent a "typical" member of each role:
 *   - admin/teacher  → no student/parent associations
 *   - student        → studentId=42, enrolled in courses [1, 2, 3]
 *   - parent         → two children (ids 10, 11) enrolled in courses [1, 2, 3]
 *   - guest          → no associations
 *
 * All options are overridable via the options argument.
 */
import { buildScopeContext, type ClassmateSession, type ScopeContext } from "../../../lib/scope-context";

export interface StudentScopeOptions {
  studentId?: number;
  enrolledCourseIds?: number[];
}

export interface ParentScopeOptions {
  childStudentIds?: number[];
  childCourseIds?: number[];
}

/**
 * Builds a raw ClassmateSession-shaped object for direct use
 * in buildScopeContext(). Prefer the typed role factories below.
 */
export function makeRawSession(overrides: Partial<ClassmateSession> = {}): ClassmateSession {
  return {
    userId: 1,
    role: "admin",
    ...overrides,
  } as ClassmateSession;
}

/** Admin scope — isGlobal=true, no student/parent associations. */
export function createAdminScope(): ScopeContext {
  return buildScopeContext(makeRawSession({ role: "admin" }));
}

/** Teacher scope — isGlobal=true, no student/parent associations. */
export function createTeacherScope(): ScopeContext {
  return buildScopeContext(makeRawSession({ role: "teacher" }));
}

/**
 * Student scope — isGlobal=false.
 * Defaults: studentId=42, enrolledCourseIds=[1, 2, 3].
 * Override via options to test edge cases (empty enrollment, specific id, etc.).
 */
export function createStudentScope(options: StudentScopeOptions = {}): ScopeContext {
  return buildScopeContext(
    makeRawSession({
      role: "student",
      studentId: options.studentId ?? 42,
      enrolledCourseIds: options.enrolledCourseIds ?? [1, 2, 3],
    }),
  );
}

/**
 * Parent scope — isGlobal=false.
 * Defaults: childStudentIds=[10, 11], childCourseIds=[1, 2, 3].
 * Override via options to test edge cases (no children, no enrollments, etc.).
 */
export function createParentScope(options: ParentScopeOptions = {}): ScopeContext {
  return buildScopeContext(
    makeRawSession({
      role: "parent",
      childStudentIds: options.childStudentIds ?? [10, 11],
      childCourseIds: options.childCourseIds ?? [1, 2, 3],
    }),
  );
}

/** Guest scope — isGlobal=false, no associations. Always denied. */
export function createGuestScope(): ScopeContext {
  return buildScopeContext(makeRawSession({ role: "guest" }));
}

/**
 * All five scopes as a named map — useful for parameterized test.each() calls.
 *
 * @example
 *   it.each(Object.entries(ALL_SCOPES))("role %s", ([role, scope]) => { ... });
 */
export const ALL_SCOPES = {
  admin: createAdminScope(),
  teacher: createTeacherScope(),
  student: createStudentScope(),
  parent: createParentScope(),
  guest: createGuestScope(),
} as const;

/** Roles that have global (unrestricted) access to all resources. */
export const GLOBAL_ROLES = ["admin", "teacher"] as const;

/** Roles that have scoped (restricted) access to resources. */
export const SCOPED_ROLES = ["student", "parent", "guest"] as const;
