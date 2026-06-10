import { Router, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { hashPassword, verifyPassword } from "../lib/password";
import { SessionEnricherService } from "../lib/session-enricher";

const router: IRouter = Router();

// ── Login rate limiter ────────────────────────────────────────────────────────
// Limits login attempts to 10 per 15-minute window per IP address.
// Prevents credential-stuffing and brute-force attacks on the auth endpoint.
// Only applied to POST /auth/login — other auth routes are unaffected.
const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: "Too many login attempts, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  // In the test environment (NODE_ENV=test) the rate limiter is bypassed so that
  // HTTP integration test suites can exercise the auth endpoint freely without
  // hitting the per-IP window.  Production behaviour is unchanged.
  skip: () => process.env.NODE_ENV === "test",
});

router.post("/auth/login", loginRateLimiter, async (req, res): Promise<void> => {
  const { username, password } = req.body as { username?: string; password?: string };

  if (!username || !password) {
    res.status(400).json({ error: "Username and password are required" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.username, username)).limit(1);

  if (!user || !user.isActive) {
    res.status(401).json({ error: "Invalid username or password" });
    return;
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Invalid username or password" });
    return;
  }

  req.session.userId = user.id;
  req.session.username = user.username;
  req.session.displayName = user.displayName;
  req.session.role = user.role;

  await SessionEnricherService.enrich(req.session, user.id, user.role);

  res.json({
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
  });
});

router.post("/auth/logout", (req, res): void => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.json({ ok: true });
  });
});

router.get("/auth/me", (req, res): void => {
  if (!req.session?.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  res.json({
    id: req.session.userId,
    username: req.session.username,
    displayName: req.session.displayName,
    role: req.session.role,
  });
});

export { hashPassword };
export default router;
