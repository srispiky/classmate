import type { RequestHandler } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { buildScopeContext, type ClassmateSession } from "../lib/scope-context";
import { SessionEnricherService } from "../lib/session-enricher";

/**
 * Account liveness + role-freshness middleware.
 *
 * Re-queries isActive AND role from the users table on every request so that:
 *
 *  1. A session issued before an account was deactivated is killed immediately —
 *     the session is destroyed server-side and the caller receives 401, exactly
 *     as if they were unauthenticated.  This closes the window where a
 *     deactivated account can continue making API requests until its session
 *     cookie expires naturally.
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
 *   HTTP 401 — session is destroyed and the cookie is cleared.
 */
export const requireActiveAccount: RequestHandler = async (req, res, next) => {
  const scope = buildScopeContext(req.session as ClassmateSession);

  const rows = await db
    .select({ isActive: usersTable.isActive, role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, scope.userId))
    .limit(1);

  if (rows.length === 0 || !rows[0]!.isActive) {
    // Destroy the server-side session immediately so the cookie becomes
    // invalid for all subsequent requests, even if the caller retains it.
    req.session.destroy(() => {
      res.clearCookie("connect.sid");
      res.status(401).json({ error: "Account is no longer active", requestId: String(req.id ?? "") });
    });
    return;
  }

  const freshRole = rows[0]!.role;
  if (freshRole !== req.session.role) {
    req.session.role = freshRole;
    await SessionEnricherService.enrich(req.session, scope.userId, freshRole);
  }

  next();
};
