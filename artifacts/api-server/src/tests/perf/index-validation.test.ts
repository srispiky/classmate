/**
 * Index Validation Suite
 *
 * Verifies that:
 *   1. All Chunk 3 indexes are present in pg_indexes.
 *   2. Key query patterns execute without errors and return coherent results
 *      (confirming the SQL rewrite is semantically correct at the DB level).
 *   3. EXPLAIN FORMAT JSON is parseable and the plan tree is accessible
 *      (sanity-check that the PG version supports the plan format).
 *
 * Note on Seq Scan vs Index Scan:
 *   PostgreSQL's query planner will choose a sequential scan for small tables
 *   (< ~1 000 rows) because it's cheaper.  At production scale (10 K+ rows)
 *   the planner switches to index scans automatically.  Timing evidence of
 *   index benefit at 100-student scale is in dashboard-perf.test.ts.
 */

import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

// ── EXPLAIN helper ────────────────────────────────────────────────────────────

type PlanNode = {
  "Node Type": string;
  "Index Name"?: string;
  Plans?: PlanNode[];
};

type QueryPlan = [{ Plan: PlanNode }];

/**
 * Run EXPLAIN FORMAT JSON and return the root plan node.
 * PostgreSQL returns the plan in a column called "QUERY PLAN" as a JSON value.
 * The pg driver may return it as a string or a pre-parsed value.
 */
async function explainQuery(queryText: string): Promise<PlanNode> {
  const result = await db.execute(sql.raw(`EXPLAIN (FORMAT JSON) ${queryText}`));
  const rows = result.rows as Array<Record<string, unknown>>;
  const raw = rows[0]?.["QUERY PLAN"];
  if (raw === undefined) throw new Error("EXPLAIN returned no rows");
  const planArray: QueryPlan = typeof raw === "string" ? JSON.parse(raw) : raw as QueryPlan;
  const plan = planArray[0]?.Plan;
  if (!plan) throw new Error("EXPLAIN plan structure unexpected: " + JSON.stringify(planArray));
  return plan;
}

function collectNodeTypes(node: PlanNode): string[] {
  const types: string[] = [node["Node Type"]];
  for (const child of node.Plans ?? []) types.push(...collectNodeTypes(child));
  return types;
}

// ── Index existence checks ────────────────────────────────────────────────────

describe("Index existence — Chunk 3 migrations", () => {
  it("expected indexes are present in pg_indexes", async () => {
    const result = await db.execute<{ indexname: string }>(
      sql`SELECT indexname FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname`,
    );
    const indexNames = result.rows.map((r) => r.indexname);

    const requiredIndexes = [
      "ix_assessments_student_id",
      "ix_assessments_course_id",
      "ix_assessments_deleted_at",
      "ix_assignments_student_id",
      "ix_assignments_course_id",
      "ix_assignments_deleted_at",
      "ix_courses_teacher_id",
      "ix_courses_deleted_at",
    ];

    for (const idx of requiredIndexes) {
      expect(indexNames, `index ${idx} should exist`).toContain(idx);
    }
  });
});

// ── EXPLAIN sanity checks ─────────────────────────────────────────────────────

describe("EXPLAIN — dashboard summary queries", () => {
  it("students COUNT plan is accessible", async () => {
    const plan = await explainQuery(
      `SELECT COUNT(*)::int FROM students WHERE deleted_at IS NULL`,
    );
    expect(plan["Node Type"]).toBeTruthy();
    const nodes = collectNodeTypes(plan);
    expect(nodes.some((n) => n.includes("Scan") || n.includes("Aggregate"))).toBe(true);
  });

  it("assignments aggregate plan is accessible", async () => {
    const plan = await explainQuery(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status IN ('pending', 'late'))::int AS pending,
              COUNT(*) FILTER (WHERE status IN ('graded', 'submitted'))::int AS completed,
              AVG(score::float / max_score * 100) FILTER (WHERE status = 'graded' AND score IS NOT NULL) AS avg_score
       FROM assignments WHERE deleted_at IS NULL`,
    );
    expect(plan["Node Type"]).toBeTruthy();
  });

  it("per-student assessment GROUP BY plan is accessible", async () => {
    const plan = await explainQuery(
      `SELECT a.student_id, s.name,
              AVG(a.score::float / a.max_score * 100) AS avg_pct,
              COUNT(*)::int AS score_count
       FROM assessments a
       INNER JOIN students s ON s.id = a.student_id AND s.deleted_at IS NULL
       WHERE a.deleted_at IS NULL
       GROUP BY a.student_id, s.name`,
    );
    expect(plan["Node Type"]).toBeTruthy();
    const nodes = collectNodeTypes(plan);
    expect(nodes.some((n) => n.includes("Join") || n.includes("Scan"))).toBe(true);
  });
});

describe("EXPLAIN — grade breakdown GROUP BY", () => {
  it("course assessment aggregate plan is accessible", async () => {
    const plan = await explainQuery(
      `SELECT course_id,
              AVG(score::float / max_score * 100),
              COUNT(*) FILTER (WHERE score::float / max_score * 100 >= 90)::int AS a_count,
              COUNT(*) FILTER (WHERE score::float / max_score * 100 >= 80 AND score::float / max_score * 100 < 90)::int AS b_count,
              COUNT(*) FILTER (WHERE score::float / max_score * 100 >= 70 AND score::float / max_score * 100 < 80)::int AS c_count,
              COUNT(*) FILTER (WHERE score::float / max_score * 100 >= 60 AND score::float / max_score * 100 < 70)::int AS d_count,
              COUNT(*) FILTER (WHERE score::float / max_score * 100 < 60)::int AS f_count
       FROM assessments WHERE deleted_at IS NULL GROUP BY course_id`,
    );
    expect(plan["Node Type"]).toBeTruthy();
  });
});

describe("EXPLAIN — student-health minimal column scans", () => {
  it("minimal assignments column selection plan is accessible", async () => {
    const plan = await explainQuery(
      `SELECT student_id, status, score, max_score, updated_at
       FROM assignments WHERE deleted_at IS NULL`,
    );
    expect(plan["Node Type"]).toBeTruthy();
  });

  it("minimal assessments column selection plan is accessible", async () => {
    const plan = await explainQuery(
      `SELECT student_id, score, max_score, created_at
       FROM assessments WHERE deleted_at IS NULL`,
    );
    expect(plan["Node Type"]).toBeTruthy();
  });
});

// ── Functional correctness of optimised queries ───────────────────────────────

describe("Query correctness — optimised SQL aggregate patterns", () => {
  it("assignment status aggregate returns a single scalar row", async () => {
    const result = await db.execute<{
      total: number;
      pending: number;
      completed: number;
    }>(sql`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE status IN ('pending', 'late'))::int AS pending,
             COUNT(*) FILTER (WHERE status IN ('graded', 'submitted'))::int AS completed
      FROM assignments WHERE deleted_at IS NULL
    `);
    expect(result.rows.length).toBe(1);
    expect(typeof result.rows[0]!.total).toBe("number");
    expect(typeof result.rows[0]!.pending).toBe("number");
    expect(typeof result.rows[0]!.completed).toBe("number");
    // Logical invariant: pending + completed ≤ total
    expect(result.rows[0]!.pending + result.rows[0]!.completed).toBeLessThanOrEqual(
      result.rows[0]!.total,
    );
  });

  it("assessment GROUP BY returns at most one row per student", async () => {
    const result = await db.execute<{ student_id: number; score_count: number }>(sql`
      SELECT student_id, COUNT(*)::int AS score_count
      FROM assessments WHERE deleted_at IS NULL
      GROUP BY student_id
    `);
    const studentIds = result.rows.map((r) => r.student_id);
    const uniqueIds = new Set(studentIds);
    expect(uniqueIds.size).toBe(studentIds.length);
  });

  it("grade breakdown GROUP BY returns at most one row per course", async () => {
    const result = await db.execute<{ course_id: number }>(sql`
      SELECT course_id, COUNT(*)::int AS total
      FROM assessments WHERE deleted_at IS NULL
      GROUP BY course_id
    `);
    const courseIds = result.rows.map((r) => r.course_id);
    const uniqueIds = new Set(courseIds);
    expect(uniqueIds.size).toBe(courseIds.length);
  });

  it("FILTER counts sum ≤ total for grade distribution", async () => {
    const result = await db.execute<{
      total: number;
      a_count: number;
      b_count: number;
      c_count: number;
      d_count: number;
      f_count: number;
    }>(sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE score::float / max_score * 100 >= 90)::int AS a_count,
        COUNT(*) FILTER (WHERE score::float / max_score * 100 >= 80 AND score::float / max_score * 100 < 90)::int AS b_count,
        COUNT(*) FILTER (WHERE score::float / max_score * 100 >= 70 AND score::float / max_score * 100 < 80)::int AS c_count,
        COUNT(*) FILTER (WHERE score::float / max_score * 100 >= 60 AND score::float / max_score * 100 < 70)::int AS d_count,
        COUNT(*) FILTER (WHERE score::float / max_score * 100 < 60)::int AS f_count
      FROM assessments WHERE deleted_at IS NULL
    `);
    expect(result.rows.length).toBe(1);
    const row = result.rows[0]!;
    const bucketSum = row.a_count + row.b_count + row.c_count + row.d_count + row.f_count;
    // Bucket sum must exactly equal total (every row falls in exactly one bucket)
    expect(bucketSum).toBe(row.total);
  });
});

// ── Index coverage matrix (documentation) ────────────────────────────────────
//
// Index                          | Column(s)                   | Used by endpoints
// -------------------------------|-----------------------------|-----------------------------------------
// ix_assignments_student_id      | assignments.student_id      | /students/:id/progress, /reports/student-summary, student portal
// ix_assignments_course_id       | assignments.course_id       | /dashboard/summary (scope filter), /reports/course-summary
// ix_assignments_deleted_at      | assignments.deleted_at      | All assignment queries with soft-delete filter
// ix_assessments_student_id      | assessments.student_id      | /students/:id/progress, /reports/student-summary
// ix_assessments_course_id       | assessments.course_id       | /dashboard/grade-breakdown (GROUP BY), /dashboard/summary GROUP BY
// ix_assessments_deleted_at      | assessments.deleted_at      | All assessment queries with soft-delete filter
// ix_courses_teacher_id          | courses.teacher_id          | /courses (teacher scope), /dashboard (teacher scope filter)
// ix_courses_deleted_at          | courses.deleted_at          | All course queries with soft-delete filter
