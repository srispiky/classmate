import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { pool } from "@workspace/db";
import { metrics } from "./lib/metrics";
import { globalErrorHandler } from "./middleware/error-handler";

const PgSession = connectPgSimple(session);

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    // Use a cryptographically random UUID for each request so IDs are
    // globally unique and safe to include in responses and external logs.
    genReqId: () => crypto.randomUUID(),
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// ── Request ID header ─────────────────────────────────────────────────────────
// Echo the request ID back to the caller so client-side error reports can be
// correlated with server logs without exposing any sensitive information.
app.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader("X-Request-Id", String(req.id));
  next();
});

// ── Request metrics ───────────────────────────────────────────────────────────
// Capture per-request timing and status-code bucketing after the response
// is finished. Using the `finish` event ensures the status code is final.
app.use((req: Request, res: Response, next: NextFunction) => {
  const startMs = Date.now();
  res.on("finish", () => {
    metrics.recordRequest(res.statusCode, Date.now() - startMs, req.path);
  });
  next();
});

// ── Security headers ─────────────────────────────────────────────────────────
// The API server serves only JSON; no HTML is rendered here, so the default
// Helmet CSP will not break any page. The SPA is served as a separate static
// artifact and is unaffected.
app.use(helmet());

// ── CORS ─────────────────────────────────────────────────────────────────────
// Production: restrict to the domain(s) listed in ALLOWED_ORIGINS (comma-separated).
// Development: when ALLOWED_ORIGINS is unset, allow any localhost origin so the
//              Vite dev server on a dynamic port can reach the API.
const rawAllowedOrigins = process.env["ALLOWED_ORIGINS"];
const allowedOrigins: string[] | null = rawAllowedOrigins
  ? rawAllowedOrigins.split(",").map((o) => o.trim()).filter(Boolean)
  : null;

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }
      if (!allowedOrigins) {
        const isLocalhost = /^https?:\/\/localhost(:\d+)?$/.test(origin);
        callback(null, isLocalhost);
        return;
      }
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`CORS: origin not allowed: ${origin}`), false);
    },
    credentials: true,
  }),
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Session ──────────────────────────────────────────────────────────────────
const sessionSecret = process.env["SESSION_SECRET"];
if (!sessionSecret) {
  throw new Error("SESSION_SECRET environment variable is required");
}

// ── Password encryption key ───────────────────────────────────────────────────
// Validated here (module load time) so the server refuses to start rather than
// failing silently on the first authentication request.
const encryptionKey = process.env["PASSWORD_ENCRYPTION_KEY"];
if (!encryptionKey) {
  throw new Error("PASSWORD_ENCRYPTION_KEY environment variable is required");
}
if (Buffer.from(encryptionKey, "hex").length !== 32) {
  throw new Error(
    "PASSWORD_ENCRYPTION_KEY must be a 64-character hex string (32 bytes for AES-256)",
  );
}

app.use(
  session({
    store: new PgSession({
      pool,
      tableName: "session",
    }),
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      // Transmit the cookie over HTTPS only in production.
      // In development (NODE_ENV !== "production") the cookie is sent over HTTP
      // so the local Vite dev server and curl-based tests continue to work.
      secure: process.env.NODE_ENV === "production",
      // "strict" prevents the cookie being sent on any cross-site request,
      // providing CSRF protection as a defence-in-depth measure.
      sameSite: "strict",
      maxAge: 8 * 60 * 60 * 1000,
    },
  }),
);

app.use("/api", router);

// ── Global error handler ──────────────────────────────────────────────────────
// Must be registered after all routes. Catches any error passed to next(err).
app.use(globalErrorHandler);

export default app;
