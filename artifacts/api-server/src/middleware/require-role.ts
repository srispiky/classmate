import type { RequestHandler } from "express";
import { buildScopeContext, type ClassmateSession, type RoleKey } from "../lib/scope-context";
import { ownershipDenied } from "../lib/query-contracts";

/**
 * Layer 1 — Role-based authorization middleware factory.
 *
 * Enforces that the authenticated caller holds one of the permitted roles before
 * the route handler executes. Eliminates inline role checks from route handlers
 * (which violates the "no authorization logic in controllers" standard).
 *
 * Usage:
 *   router.post("/courses", requireRole("admin", "teacher"), async (req, res) => {
 *     // scope.role is guaranteed to be "admin" or "teacher" here
 *   });
 *
 * Response on denial:
 *   HTTP 403 with an OWNERSHIP_DENIED payload (consistent with Layer 3 responses).
 *
 * @param allowed - One or more roles that are permitted to call this endpoint.
 */
export function requireRole(...allowed: RoleKey[]): RequestHandler {
  return (req, res, next) => {
    const scope = buildScopeContext(req.session as ClassmateSession);
    if (!allowed.includes(scope.role)) {
      res.status(403).json({ ...ownershipDenied("endpoint", 0), requestId: String(req.id ?? "") });
      return;
    }
    next();
  };
}
