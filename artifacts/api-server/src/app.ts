import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { pool } from "@workspace/db";

const PgSession = connectPgSimple(session);

const app: Express = express();

app.use(
  pinoHttp({
    logger,
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

export default app;
