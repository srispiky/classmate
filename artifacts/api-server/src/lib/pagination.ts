/**
 * Cursor-based pagination utilities.
 *
 * Cursors are opaque Base64URL-encoded JSON blobs containing the sort key
 * and id of the last row returned on the previous page. Callers never
 * construct or inspect cursor values — they only store and forward them.
 *
 * Two cursor shapes are used:
 *   StudentCursorPayload  — { name: string; id: number }   (sort: name, id)
 *   DateIdCursorPayload   — { ts: string;  id: number }    (sort: timestamp/text, id)
 *
 * A tampered cursor will either:
 *   - fail to parse    → decodeCursor returns null → route returns 400
 *   - produce 0 rows   → no data leakage (scope WHERE is always AND'd in)
 */

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 100;

// ── Cursor payload shapes ────────────────────────────────────────────────────

export interface StudentCursorPayload {
  name: string;
  id: number;
}

export interface DateIdCursorPayload {
  ts: string;
  id: number;
}

// ── Encode ───────────────────────────────────────────────────────────────────

export function encodeCursor(payload: StudentCursorPayload | DateIdCursorPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
}

// ── Decode helpers ───────────────────────────────────────────────────────────

function tryParseJson(cursor: string): unknown {
  try {
    return JSON.parse(Buffer.from(cursor, "base64url").toString("utf-8"));
  } catch {
    return null;
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function decodeStudentCursor(cursor: string): StudentCursorPayload | null {
  const v = tryParseJson(cursor);
  if (!isObject(v)) return null;
  if (typeof v["name"] !== "string") return null;
  if (typeof v["id"] !== "number" || !Number.isInteger(v["id"])) return null;
  return { name: v["name"], id: v["id"] };
}

export function decodeDateIdCursor(cursor: string): DateIdCursorPayload | null {
  const v = tryParseJson(cursor);
  if (!isObject(v)) return null;
  if (typeof v["ts"] !== "string") return null;
  if (typeof v["id"] !== "number" || !Number.isInteger(v["id"])) return null;
  return { ts: v["ts"], id: v["id"] };
}

// ── Paginated result shape ───────────────────────────────────────────────────

export interface PaginatedResult<T> {
  items: T[];
  pagination: {
    nextCursor: string | null;
    hasMore: boolean;
    limit: number;
  };
}
