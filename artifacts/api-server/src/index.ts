import app from "./app";
import { logger } from "./lib/logger";
import { pool } from "@workspace/db";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// ── Startup environment summary ───────────────────────────────────────────────
// Log the presence (never the value) of security-critical env vars so operators
// can verify configuration without exposing secrets in log aggregators.
logger.info(
  {
    env: process.env.NODE_ENV ?? "development",
    port,
    allowedOrigins: process.env["ALLOWED_ORIGINS"]
      ? "set"
      : "unset (localhost-only in dev)",
    logLevel: process.env["LOG_LEVEL"] ?? "info (default)",
    sessionSecret: process.env["SESSION_SECRET"] ? "set" : "MISSING",
    passwordEncryptionKey: process.env["PASSWORD_ENCRYPTION_KEY"]
      ? "set"
      : "MISSING",
    databaseUrl: process.env["DATABASE_URL"] ? "set" : "MISSING",
  },
  "Classmate Connect API — startup configuration",
);

// ── Database connectivity check ───────────────────────────────────────────────
// Fail fast if the database is unreachable at boot.  A process supervisor
// (PM2, container orchestration, Replit deployment) will restart the process,
// which is preferable to serving requests that will all fail with DB errors.
try {
  const client = await pool.connect();
  try {
    await client.query("SELECT 1");
  } finally {
    client.release();
  }
  logger.info("Database connectivity verified");
} catch (err) {
  logger.fatal({ err }, "Database connectivity check failed at startup — aborting");
  process.exit(1);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening — ready to accept requests");
});
