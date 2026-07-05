import type { RequestHandler } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { buildScopeContext, type ClassmateSession } from "../lib/scope-context";
import { ownershipDenied } from "../lib/query-contracts";

/**
 * Account liveness middleware.
 *
 * Re-queries isActive from the users table on every request so that a session
 * issued before an account was deactivated is rejected immediately, even if
 * the session cookie is still valid.
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
    .select({ isActive: usersTable.isActive })
    .from(usersTable)
    .where(eq(usersTable.id, scope.userId))
    .limit(1);

  if (rows.length === 0 || !rows[0]!.isActive) {
    res.status(403).json({ ...ownershipDenied("account", 0), requestId: String(req.id ?? "") });
    return;
  }

  next();
};
