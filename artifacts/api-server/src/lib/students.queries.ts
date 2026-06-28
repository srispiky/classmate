/**
 * Student list query with cursor-based pagination.
 *
 * Layer 2 scope filtering is applied by the caller-supplied scopeCondition
 * (built from studentPolicy.getScopeCondition(scope)) before the cursor
 * condition is appended — the cursor never widens or bypasses the scope.
 *
 * Sort order: (name ASC, id ASC) — id is the primary-key tiebreaker for
 * duplicate names, guaranteeing a stable and deterministic page boundary.
 */

import { eq, and, or, gt, isNull } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { db, studentsTable } from "@workspace/db";
import {
  encodeCursor,
  decodeStudentCursor,
  type StudentCursorPayload,
  type PaginatedResult,
  DEFAULT_LIMIT,
} from "./pagination";

export interface StudentRow {
  id: number;
  name: string;
  email: string;
  grade: string;
  avatarUrl: string | null;
  enrolledCourseIds: number[];
  createdAt: Date;
  updatedAt: Date;
  createdBy: number | null;
  updatedBy: number | null;
}

function toStudentRow(r: typeof studentsTable.$inferSelect): StudentRow {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    grade: r.grade,
    avatarUrl: r.avatarUrl,
    enrolledCourseIds: Array.isArray(r.enrolledCourseIds) ? (r.enrolledCourseIds as number[]) : [],
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    createdBy: r.createdBy,
    updatedBy: r.updatedBy,
  };
}

export interface ListStudentsOptions {
  limit?: number;
  cursor?: string;
  scopeCondition: SQL | undefined;
}

/**
 * Fetches a cursor-paginated, scope-filtered list of active students.
 *
 * The scopeCondition is the Layer 2 WHERE fragment produced by
 * studentPolicy.getScopeCondition(scope) — it is always applied before the
 * cursor condition so pagination can never bypass the scope boundary.
 */
export async function listStudents(
  options: ListStudentsOptions,
): Promise<PaginatedResult<StudentRow>> {
  const limit = Math.min(options.limit ?? DEFAULT_LIMIT, 100);

  const conditions: (SQL | undefined)[] = [
    isNull(studentsTable.deletedAt),
    options.scopeCondition,
  ];

  if (options.cursor) {
    const decoded: StudentCursorPayload | null = decodeStudentCursor(options.cursor);
    if (!decoded) {
      return { items: [], pagination: { nextCursor: null, hasMore: false, limit } };
    }
    const cursorCond = or(
      gt(studentsTable.name, decoded.name),
      and(eq(studentsTable.name, decoded.name), gt(studentsTable.id, decoded.id)),
    );
    conditions.push(cursorCond);
  }

  const validConditions = conditions.filter((c): c is SQL => c !== undefined);

  const rawRows = await db
    .select()
    .from(studentsTable)
    .where(validConditions.length > 0 ? and(...validConditions) : undefined)
    .orderBy(studentsTable.name, studentsTable.id)
    .limit(limit + 1);

  const hasMore = rawRows.length > limit;
  const pageRows = hasMore ? rawRows.slice(0, limit) : rawRows;
  const lastRow = pageRows.at(-1);

  const nextCursor =
    hasMore && lastRow
      ? encodeCursor({ name: lastRow.name, id: lastRow.id })
      : null;

  return {
    items: pageRows.map(toStudentRow),
    pagination: { nextCursor, hasMore, limit },
  };
}
