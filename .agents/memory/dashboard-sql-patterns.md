---
name: Dashboard SQL aggregation patterns
description: Drizzle sql<> template for COUNT/AVG FILTER, GROUP BY with JOIN, EXPLAIN FORMAT JSON column name, perf test course-creation required fields
---

## COUNT/AVG FILTER pattern (Drizzle)

```typescript
db.select({
  total: sql<number>`COUNT(*)::int`,
  pending: sql<number>`COUNT(*) FILTER (WHERE ${table.status} IN ('pending', 'late'))::int`,
  avgScore: sql<number | null>`AVG(${table.score}::float / ${table.maxScore} * 100) FILTER (WHERE ${table.status} = 'graded' AND ${table.score} IS NOT NULL)`,
}).from(table).where(...)
```

The `::int` cast is needed because PostgreSQL returns COUNT as `bigint` which pg driver returns as a string. Without `::int`, TypeScript sees `unknown`.

**Why:** Established pattern from `student-dashboard.queries.ts`. Apply consistently across all aggregate queries.

## GROUP BY with INNER JOIN for per-student averages

```typescript
db.select({
  studentId: assessmentsTable.studentId,
  studentName: studentsTable.name,
  avgPct: sql<number>`AVG(${assessmentsTable.score}::float / ${assessmentsTable.maxScore} * 100)`,
  scoreCount: sql<number>`COUNT(*)::int`,
})
.from(assessmentsTable)
.innerJoin(studentsTable, and(eq(studentsTable.id, assessmentsTable.studentId), isNull(studentsTable.deletedAt)))
.where(and(isNull(assessmentsTable.deletedAt), assessmentFilter, studentFilter))
.groupBy(assessmentsTable.studentId, studentsTable.name)
```

Both `assessmentFilter` and `studentFilter` must be applied when joining assessment + students tables to avoid returning unenrolled students' data to teachers.

## EXPLAIN FORMAT JSON result structure

`db.execute(sql.raw("EXPLAIN (FORMAT JSON) ..."))` returns rows where the column is named `"QUERY PLAN"` (with a space), NOT `"Plan"`. Access via:

```typescript
const raw = result.rows[0]?.["QUERY PLAN"];
const planArray = typeof raw === "string" ? JSON.parse(raw) : raw;
const rootNode = planArray[0]?.Plan;  // <- "Plan" is inside the array element
```

**Why:** Easy to get wrong — `result.rows[0].Plan` is undefined. Cast via `as unknown as {...}` is needed for the type assertion.

## Course creation in tests requires teacherId

`createCourseInputSchema` requires `teacherId` (positive integer, not optional). The test must create a teacher user first and pass that user's ID. `teacherName` is NOT in the schema.

**How to apply:** Any test that POST /api/courses must create a teacher user via `createHttpUser(prefix, "teacher")` and pass `teacherId: teacher.id` in the body.
