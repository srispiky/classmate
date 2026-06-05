import type { SQL } from "drizzle-orm";
import type { ScopeContext } from "../scope-context";

/**
 * Base authorization error thrown by all ResourceScopePolicy implementations.
 *
 * Route handlers catch this type to produce a uniform 403 response.
 * CourseAuthorizationError (course-scope-validator.ts) extends this class,
 * so catching PolicyAuthorizationError also catches course-level denials.
 */
export class PolicyAuthorizationError extends Error {
  constructor(message = "Access denied") {
    super(message);
    this.name = "PolicyAuthorizationError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Contract for resource-scoped authorization.
 *
 * Each resource type (Assignments, Assessments, Notes, …) implements this
 * interface so route handlers never contain authorization rules — they delegate
 * to the policy.
 *
 * Layer 2 — query-level filtering:
 *   getScopeCondition(scope) → SQL | undefined
 *   The query builder appends this to its WHERE clause. undefined = no filter
 *   (admin / teacher full access). SQL_FALSE = caller has no authorized rows.
 *
 * Layer 3 — post-fetch validation (defense in depth):
 *   validateAccess(scope, resource) → void | throws PolicyAuthorizationError
 *   Called after fetching a single resource by ID. Throws when access is denied.
 *   This prevents IDOR even if the Layer 2 filter is bypassed.
 */
export interface ResourceScopePolicy<TRow> {
  /**
   * Returns the Layer 2 WHERE condition for this resource type.
   *
   * - undefined   admin / teacher — no extra condition needed
   * - SQL clause  student / parent — scoped to their enrolled / child resources
   * - SQL_FALSE   unauthenticated or role with zero access
   */
  getScopeCondition(scope: ScopeContext): SQL | undefined;

  /**
   * Layer 3 post-fetch guard.
   * Throws PolicyAuthorizationError when scope does not permit access.
   * Must not make additional database calls.
   */
  validateAccess(scope: ScopeContext, resource: TRow): void;
}
