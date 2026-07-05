import { type Request, type Response, type NextFunction } from "express";
import { metrics } from "../lib/metrics";

export interface ApiError extends Error {
  statusCode?: number;
  code?: string;
}

// Global Express error handler — must be registered last (after all routes).
// Catches any error passed to next(err) and produces a consistent JSON response.
//
// Security invariant: the response body never echoes raw stack traces or internal
// details for 5xx errors. Operational detail lives only in the structured log.
export function globalErrorHandler(
  err: ApiError,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const statusCode = err.statusCode ?? 500;
  const requestId = String(req.id ?? "");

  if (statusCode >= 500) {
    metrics.recordRequest(statusCode, 0);
    req.log.error(
      {
        err,
        requestId,
        component: "error-handler",
        statusCode,
        path: req.path,
        method: req.method,
      },
      err.message,
    );
  } else {
    req.log.warn(
      {
        err,
        requestId,
        component: "error-handler",
        statusCode,
        path: req.path,
        method: req.method,
      },
      err.message,
    );
  }

  if (res.headersSent) return;

  res.status(statusCode).json({
    error: statusCode >= 500 ? "Internal server error" : err.message,
    ...(err.code ? { code: err.code } : {}),
    requestId,
  });
}
