# Sprint 8 Chunk 1 — Advanced Progress Analytics: Architecture Review

**Date:** 2026-06-10
**Status:** Design review only — no implementation.

---

## 1. Existing Architecture Summary

### Progress endpoint

```
GET /api/students/:id/progress
operationId: getStudentProgress
Auth: requireRole("admin", "teacher") + Layer 3 applyLayer3Guard
```

**Handler location:** `artifacts/api-server/src/routes/students.ts` lines 197–266

**Current `StudentProgress` schema (7 required fields):**

```yaml
studentId:            integer
totalAssignments:     integer
completedAssignments: integer
averageScore:         number   # lifetime average across graded assignments
completionRate:       number   # 0–1
topicsMastered:       string[] # deduped strengths from assessments, max 5
topicsNeedingWork:    string[] # deduped weaknesses from assessments, max 5
```

**What the handler does today:**
1. Fetches all non-soft-deleted assignments for the student (unordered)
2. Fetches all non-soft-deleted assessments for the student (unordered)
3. Computes scalar aggregates (averageScore, completionRate)
4. Collects unique topic strings from assessments
5. Returns a flat response — no time dimension, no trend, no risk signal

**Raw data available in the DB (not yet used):**

| Table | Useful columns | Notes |
|---|---|---|
| `assignments` | `createdAt`, `updatedAt`, `dueDate` (text), `status`, `score`, `maxScore` | `dueDate` is a text field, not a timestamp |
| `assessments` | `createdAt`, `updatedAt`, `score`, `maxScore` | Ordered by createdAt = chronological |
| `course_enrollments` | `enrolledAt`, `droppedAt`, `isActive` | Enrollment lifecycle events |

**Authorization layers already in place (all three):**

| Layer | Implementation |
|---|---|
| Layer 1 | `requireRole("admin", "teacher")` |
| Layer 2 | `studentPolicy.getScopeCondition()` — teacher sees only enrolled-course students |
| Layer 3 | `applyLayer3Guard()` → `studentPolicy.validateAccess()` — per-record teacher ownership |

**Frontend consumption:**
`students/detail.tsx` calls three hooks concurrently:
- `useGetStudentProgress(id)` — progress summary
- `useListAssignments({ studentId: id })` — raw assignment list for the Assignments tab
- `useListAssessments({ studentId: id })` — raw assessment list for the Assessments tab

The frontend therefore already has all raw data needed to compute trends client-side — but doing so server-side is preferable for security (no raw score leakage beyond what's needed), caching, and dashboard reuse.

**Dashboard overlap:**
`GET /dashboard/summary` computes `atRiskStudents` as a raw count using threshold `avg < 60`. This computation is currently duplicated between the dashboard and any future per-student risk logic. It belongs in a shared service.

---

## 2. Recommended Architecture

### Core principle

**Do not extend `StudentProgress` for array payloads.** Add two scalar fields to it (`riskLevel`, `trend`), and introduce one new supplemental endpoint for the time-series payload. Keep the dashboard's `DashboardSummary` contract frozen; add a separate endpoint for student health aggregates.

### Recommended shape

```
GET /students/:id/progress          — existing, extend with 2 scalar fields
GET /students/:id/progress/timeline — new, lazy-loadable time series
GET /dashboard/student-health       — new, teacher/admin dashboard aggregates
```

### New service: `ProgressAnalyticsService`

A single shared service that encapsulates all analytics computation. Both the progress route and the dashboard route call into it. No logic lives in route handlers.

```
artifacts/api-server/src/services/progress-analytics.service.ts
```

Exports:

```ts
computeRiskLevel(scores: number[]): RiskLevel
computeTrend(chronologicalScores: number[]): Trend
buildTimeline(assignments: Assignment[], assessments: Assessment[]): TimelineEvent[]
classifyStudentCohorts(students: StudentScoreMap): StudentCohorts
```

---

## 3. OpenAPI Changes

### Strategy: Hybrid (A + B)

**Part A — Extend `StudentProgress` with two optional scalar fields**

Both fields are additive. Clients that do not know about them ignore them in JSON. The `required` array is not modified — the fields are optional to maintain backward compatibility with any client on an older generated version.

```yaml
StudentProgress:
  properties:
    # ... existing 7 fields unchanged ...
    riskLevel:
      type: string
      enum: [LOW, MEDIUM, HIGH]
      description: >
        Computed risk classification based on recent assessment and assignment
        average score. LOW ≥ 80%, MEDIUM 60–79%, HIGH < 60%. Returns HIGH
        when fewer than 3 scored events exist (insufficient data).
    trend:
      type: string
      enum: [IMPROVING, STABLE, DECLINING, INSUFFICIENT_DATA]
      description: >
        Direction of score change over time. Computed by comparing the
        average of the most recent half of scored events against the older
        half. INSUFFICIENT_DATA when fewer than 4 events are available.
  required: [studentId, totalAssignments, completedAssignments,
             averageScore, completionRate, topicsMastered, topicsNeedingWork]
  # riskLevel and trend are intentionally NOT in required — backward compatible
```

**Part B — New `GET /students/:id/progress/timeline` endpoint**

```yaml
/students/{id}/progress/timeline:
  get:
    operationId: getStudentProgressTimeline
    tags: [students]
    summary: Get scored-event timeline for a student
    parameters:
      - name: id
        in: path
        required: true
        schema:
          type: integer
    responses:
      "200":
        description: Timeline of scored events in chronological order
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/StudentProgressTimeline"

StudentProgressTimeline:
  type: object
  properties:
    studentId:
      type: integer
    events:
      type: array
      items:
        $ref: "#/components/schemas/TimelineEvent"
  required: [studentId, events]

TimelineEvent:
  type: object
  properties:
    date:       { type: string }    # ISO 8601 date of the event
    type:       { type: string, enum: [assignment, assessment] }
    title:      { type: string }
    scorePercent: { type: number }  # 0–100
    courseId:   { type: integer }
    courseName: { type: string }
  required: [date, type, title, scorePercent, courseId, courseName]
```

**Part C — New `GET /dashboard/student-health` endpoint**

```yaml
/dashboard/student-health:
  get:
    operationId: getDashboardStudentHealth
    tags: [dashboard]
    summary: >
      Aggregated risk/trend cohort breakdown for the teacher's students.
      Teacher-scoped (own courses only); admin sees global data.
    responses:
      "200":
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/StudentHealthSummary"

StudentHealthSummary:
  type: object
  properties:
    atRisk:      { type: array, items: { $ref: "#/components/schemas/StudentSummary" } }
    improving:   { type: array, items: { $ref: "#/components/schemas/StudentSummary" } }
    declining:   { type: array, items: { $ref: "#/components/schemas/StudentSummary" } }
    noData:      { type: array, items: { $ref: "#/components/schemas/StudentSummary" } }
  required: [atRisk, improving, declining, noData]
```

`StudentSummary` already exists in the spec (used by `topPerformers` in `DashboardSummary`). Reuse it here — no new schema needed for the list items.

**What does NOT change:**
- `StudentProgress.required` array — no breaking change
- `DashboardSummary` — frozen; `atRiskStudents: integer` stays as-is
- `getStudentProgress` operationId — unchanged
- All existing generated hooks remain valid

---

## 4. Service Layer Changes

### `ProgressAnalyticsService` (new)

**`computeRiskLevel(scores: number[]): RiskLevel`**

```
Input:  percentage scores (0–100), any order
Output: 'HIGH' | 'MEDIUM' | 'LOW'

Rules:
  count < 3          → 'HIGH'  (treat unknown as high-risk)
  avg < 60           → 'HIGH'
  60 ≤ avg < 80      → 'MEDIUM'
  avg ≥ 80           → 'LOW'
```

Consistent with dashboard's existing `atRisk` threshold of 60. The new enum simply adds finer granularity below that threshold.

**`computeTrend(chronologicalScores: number[]): Trend`**

```
Input:  scores ordered oldest → newest
Output: 'IMPROVING' | 'STABLE' | 'DECLINING' | 'INSUFFICIENT_DATA'

Algorithm:
  count < 4  → 'INSUFFICIENT_DATA'
  Split at midpoint: older = first half, recent = second half
  delta = avg(recent) - avg(older)
  delta > +5  → 'IMPROVING'
  delta < -5  → 'DECLINING'
  otherwise   → 'STABLE'

Threshold (+/-5 percentage points) is configurable via a constant.
```

Using a simple two-half split rather than linear regression keeps the algorithm:
- Explainable to teachers ("recent scores vs earlier scores")
- O(n) with no external dependencies
- Easy to unit-test with deterministic fixtures

**`buildTimeline(assignments, assessments): TimelineEvent[]`**

Merges graded assignments (where `status === 'graded' && score != null`) and assessments into a single array, each mapped to a `TimelineEvent`. Sorted by `updatedAt` for assignments (grading date is more meaningful than creation date) and `createdAt` for assessments. Returns chronological order.

Note: `assignments.dueDate` is a text field, not a timestamp. Use `updatedAt` (set when graded) as the timeline anchor for assignments — not `dueDate` and not `createdAt`.

**`classifyStudentCohorts(students, scoreMap): StudentCohorts`**

Used by `GET /dashboard/student-health`. Takes the list of scoped students (already fetched by the route under teacher or admin scope) and their pre-computed assessment scores. Returns four cohort arrays: `atRisk`, `improving`, `declining`, `noData`. Calls `computeRiskLevel` and `computeTrend` internally for each student.

### Updated `GET /students/:id/progress` handler

After calling the service, the handler appends two new fields to the existing response object before passing to `GetStudentProgressResponse.parse()`. The Zod schema is updated to accept (but not require) the new fields with `.optional()`.

### No changes to existing services

`student-dashboard.service.ts` (student-facing) is untouched. Dashboard teacher-facing routes in `routes/dashboard.ts` remain unchanged until `GET /dashboard/student-health` is added as a separate route.

---

## 5. Security Impact

**All three authorization layers remain unchanged.**

| Layer | Change |
|---|---|
| Layer 1 | None — new routes inherit `requireRole("admin", "teacher")` |
| Layer 2 | None — teacher scope filtering via existing `buildDashboardStudentFilter` / `studentPolicy.getScopeCondition()` |
| Layer 3 | None — `applyLayer3Guard` called identically on new endpoints |

**Data exposure analysis:**

| New field | Risk | Mitigation |
|---|---|---|
| `riskLevel` | Derived — no raw scores exposed | Computed enum only |
| `trend` | Derived — no raw scores exposed | Computed enum only |
| `TimelineEvent.scorePercent` | Raw percentage, but already available via `useListAssignments` / `useListAssessments` | Same auth guard as progress endpoint |
| `StudentHealthSummary` | Aggregated list — teacher-scoped, admin-global | Inherits same `buildDashboardStudentFilter` used by Chunk 6 dashboard scoping |

No new information is exposed beyond what is already reachable via existing endpoints. The new endpoints add derived views of existing data, not raw data.

---

## 6. Migration Strategy

### Schema (DB)

No database schema changes are required. All new fields are computed from `assignments` and `assessments` data that already exists. No migrations needed.

### OpenAPI / codegen

After each chunk that adds to `openapi.yaml`:
```
pnpm --filter @workspace/api-spec run codegen
```

The generated `useGetStudentProgress` hook response type gains the optional fields automatically. Frontend components that don't use the new fields are unaffected. The `GetStudentProgressResponse` Zod schema in `lib/api-zod` uses `.optional()` for the new fields — existing callers that don't send them will still validate correctly.

### Frontend

No changes required to the existing student detail page for Chunks 1–3. The new fields (`riskLevel`, `trend`) appear in the `progress` response object automatically and can be consumed with a conditional check:

```ts
{progress.riskLevel && <RiskBadge level={progress.riskLevel} />}
{progress.trend && <TrendIndicator trend={progress.trend} />}
```

Timeline UI requires a new tab in `students/detail.tsx` and a new hook call (`useGetStudentProgressTimeline`).

---

## 7. Estimated Implementation Chunks

### Chunk 1 — Risk + Trend scalars

**Scope:** Backend only.

1. Create `ProgressAnalyticsService` with `computeRiskLevel` and `computeTrend`
2. Add unit tests for both functions (deterministic, no DB)
3. Add `riskLevel` and `trend` (optional) to `StudentProgress` OpenAPI schema
4. Run codegen — update `GetStudentProgressResponse` Zod schema
5. Update progress handler to call the service and append fields
6. Update existing progress tests to cover new fields

**Risk:** Low. Additive only. No contract break. No DB change.

---

### Chunk 2 — Progress Timeline endpoint

**Scope:** Backend + frontend.

1. Add `StudentProgressTimeline` and `TimelineEvent` schemas to OpenAPI spec
2. Add `buildTimeline` to `ProgressAnalyticsService`
3. Add `GET /students/:id/progress/timeline` route (same auth pattern)
4. Run codegen — `useGetStudentProgressTimeline` generated
5. Add Timeline tab to `students/detail.tsx`
6. Unit tests for `buildTimeline` + authorization tests for the new route

**Risk:** Low. New endpoint, no changes to existing routes.

---

### Chunk 3 — Dashboard Student Health

**Scope:** Backend + frontend.

1. Add `StudentHealthSummary` schema to OpenAPI spec
2. Add `classifyStudentCohorts` to `ProgressAnalyticsService`
3. Add `GET /dashboard/student-health` route (reuses `buildDashboardStudentFilter` from Chunk 6)
4. Run codegen
5. Add student health widgets to the teacher dashboard page
6. Authorization tests proving Teacher A cohort ≠ Teacher B cohort

**Risk:** Medium. New endpoint with teacher-scoping requirement. Must verify scope consistency with existing Chunk 6 dashboard filters. No changes to `DashboardSummary`.

---

### Chunk 4 — Frontend polish

**Scope:** Frontend only.

1. Risk badges on student list and detail pages
2. Trend indicators (arrow icons + colour)
3. Timeline chart component (line/scatter using existing Recharts dependency)
4. Dashboard widgets for at-risk and improving cohorts
5. E2E tests for new UI elements

**Risk:** Low. UI-only. No backend changes.

---

### Summary table

| Chunk | Backend | Frontend | DB change | Contract break | Estimated complexity |
|---|---|---|---|---|---|
| 1 — Risk + Trend | ✅ | ❌ | ❌ | ❌ | Small |
| 2 — Timeline endpoint | ✅ | ✅ | ❌ | ❌ | Medium |
| 3 — Dashboard health | ✅ | ✅ | ❌ | ❌ | Medium |
| 4 — UI polish | ❌ | ✅ | ❌ | ❌ | Medium |

All chunks are sequentially ordered (each unblocked after the previous). Chunks 2 and 3 could be parallelised if frontend work is separated.
