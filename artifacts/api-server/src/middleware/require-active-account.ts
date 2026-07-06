import type { RequestHandler } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { buildScopeContext, type ClassmateSession } from "../lib/scope-context";
import { ownershipDenied } from "../lib/query-contracts";
import { SessionEnricherService } from "../lib/session-enricher";

/**
 * Account liveness + role-freshness middleware.
 *
 * Re-queries isActive AND role from the users table on every request so that:
 *
 *  1. A session issued before an account was deactivated is rejected immediately,
 *     even if the session cookie is still valid.
 *
 *  2. A session whose role was changed mid-session (e.g. admin → parent) is
 *     re-enriched before the per-route requireRole check fires, preventing a
 *     cached admin session from reading stale permissions after a role change.
 *
 * Must be composed AFTER requireRole so that role denial (403) fires before
 * the DB round-trip is incurred.
 *
 * Usage:
 *   router.get("/parent/dashboard",
 *     requireRole("parent"),
 *     requireActiveAccount,
 *     async (req, res) => { ... }
 *   );
 *
 * Response on denial:
 *   HTTP 403 with an OWNERSHIP_DENIED payload.
 */
export const requireActiveAccount: RequestHandler = async (req, res, next) => {
  const scope = buildScopeContext(req.session as ClassmateSession);

  const rows = await db
    .select({ isActive: usersTable.isActive, role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, scope.userId))
    .limit(1);

  if (rows.length === 0 || !rows[0]!.isActive) {
    res.status(403).json({ ...ownershipDenied("account", 0), requestId: String(req.id ?? "") });
    return;
  }

  const freshRole = rows[0]!.role;
  if (freshRole !== req.session.role) {
    req.session.role = freshRole;
    await SessionEnricherService.enrich(req.session, scope.userId, freshRole);
  }

  next();
};
