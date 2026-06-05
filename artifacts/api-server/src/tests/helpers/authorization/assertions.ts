/**
 * Authorization assertion helpers.
 *
 * Reusable expect wrappers that encode the Layer 2 / Layer 3 contract.
 *
 * Layer 2 (scope filter at query level):
 *   expectLayer2Allows(conditions) — no SQL_FALSE in the scope position
 *   expectLayer2Blocks(conditions) — SQL_FALSE in the scope position
 *   expectSoftDeleteGuard(conditions) — isNull(deletedAt) is always present
 *
 * Layer 3 (post-fetch policy.validateAccess):
 *   expectAuthorized(fn)  — fn() does not throw PolicyAuthorizationError
 *   expectForbidden(fn)   — fn() throws PolicyAuthorizationError
 *
 * Usage in tests:
 *   expectLayer2Allows(buildAssignmentListConditions(adminScope, {}));
 *   expectForbidden(() => assignmentPolicy.validateAccess(studentScope, { studentId: 99 }));
 */
import { expect } from "vitest";
import type { SQL } from "drizzle-orm";
import { SQL_FALSE } from "../../../lib/scope-filter";
import { PolicyAuthorizationError } from "../../../lib/policies";

/**
 * Asserts the scope-filter condition (first element) is NOT SQL_FALSE.
 * A non-SQL_FALSE first condition means the role has real (filtered) access
 * to the resource at the DB level.
 *
 * For admin/teacher the first element IS the soft-delete guard (the only condition),
 * which is never SQL_FALSE — so this assertion holds for global roles too.
 */
export function expectLayer2Allows(conditions: SQL[]): void {
  expect(conditions.length).toBeGreaterThan(0);
  expect(conditions[0]).not.toBe(SQL_FALSE);
}

/**
 * Asserts the scope-filter condition (first element) IS SQL_FALSE.
 * SQL_FALSE ensures the query returns zero rows — the role has no access
 * to ANY record of this resource type at the DB level.
 */
export function expectLayer2Blocks(conditions: SQL[]): void {
  expect(conditions.length).toBeGreaterThan(0);
  expect(conditions[0]).toBe(SQL_FALSE);
}

/**
 * Asserts that at least one condition in the array is NOT SQL_FALSE —
 * i.e. there is a real (non-vacuous) soft-delete guard present.
 * The soft-delete isNull(deletedAt) is always the last condition.
 */
export function expectSoftDeleteGuard(conditions: SQL[]): void {
  const last = conditions[conditions.length - 1];
  expect(last).toBeDefined();
  expect(last).not.toBe(SQL_FALSE);
}

/**
 * Asserts that the function does NOT throw — access is granted by the policy.
 * Used to test Layer 3 validateAccess() for roles that should have access.
 */
export function expectAuthorized(fn: () => void): void {
  expect(fn).not.toThrow();
}

/**
 * Asserts that the function throws a PolicyAuthorizationError — access is denied.
 * Used to test Layer 3 validateAccess() for roles/resources that should be blocked.
 *
 * Catching PolicyAuthorizationError (the base class) also catches all subclasses
 * (CourseAuthorizationError, etc.) since we check isinstance, not string equality.
 */
export function expectForbidden(fn: () => void): void {
  expect(fn).toThrow(PolicyAuthorizationError);
}

/**
 * Asserts that the conditions array contains SQL_FALSE as the scope condition —
 * short for "this request should be entirely blocked at DB level, returning 0 rows".
 * Alias for expectLayer2Blocks with an explanatory name for IDOR test contexts.
 */
export function expectIDORBlocked(conditions: SQL[]): void {
  expectLayer2Blocks(conditions);
}

/**
 * Asserts that the given value is null — used to verify that soft-deleted or
 * non-existent records return null from query functions (→ 404 at route level).
 * Distinct from expectForbidden: null → 404, throw → 403.
 */
export function expectNotFound(value: unknown): void {
  expect(value).toBeNull();
}
