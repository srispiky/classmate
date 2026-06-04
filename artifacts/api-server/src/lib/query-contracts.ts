import type { ScopeContext } from "./scope-context";

/**
 * Pagination options for list queries.
 * All list endpoints accept these — they are applied after scope filters.
 * See Sprint 3 §9c: pagination operates on the already-filtered result set.
 */
export interface PageOptions {
  limit: number;
  offset: number;
}

export const DEFAULT_PAGE: Readonly<PageOptions> = {
  limit: 20,
  offset: 0,
};

/**
 * Contract for all scoped list query functions.
 *
 * @typeParam TRow     - The row type returned (mapped from Drizzle select).
 * @typeParam TFilters - Resource-specific filter fields (status, courseId, etc.).
 *
 * Implementors MUST:
 * - Apply studentIdScopeFilter or courseIdScopeFilter before executing the query
 * - Never pass req.session into this function — use ScopeContext only
 * - Apply pagination AFTER scope filters (never before)
 */
export type ScopedListFn<TRow, TFilters = Record<string, unknown>> = (
  scope: ScopeContext,
  filters?: Partial<TFilters>,
  page?: Partial<PageOptions>,
) => Promise<TRow[]>;

/**
 * Contract for all scoped detail query functions.
 *
 * Returns null when the row is not found OR when the scope filter excludes it.
 * Route handlers respond 404 for null. They then call canAccess* for Layer 3 check.
 *
 * @typeParam TRow - The row type returned.
 */
export type ScopedDetailFn<TRow> = (id: number, scope: ScopeContext) => Promise<TRow | null>;

/**
 * 403 payload shape returned by route handlers when Layer 3 ownership check fails.
 * See Sprint 3 §8b: 403 rather than 404 for IDOR attempts.
 */
export interface OwnershipDeniedPayload {
  code: "OWNERSHIP_DENIED";
  resourceType: string;
  resourceId: number;
}

/**
 * Builds the 403 payload for a failed ownership check.
 * Route handler example:
 *
 *   const check = canAccessStudentResource(row.studentId, scope);
 *   if (check === 'denied') {
 *     res.status(403).json(ownershipDenied('assignment', id));
 *     return;
 *   }
 */
export function ownershipDenied(resourceType: string, resourceId: number): OwnershipDeniedPayload {
  return { code: "OWNERSHIP_DENIED", resourceType, resourceId };
}
