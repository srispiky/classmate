# Sprint 8 Architecture Audit — Reporting Foundation

**Date:** June 10, 2026  
**Scope:** Analytics, Reporting, and Authorization — Post Reporting Foundation  
**Verdict:** Architecture is robust. Identified issues are maintainability risks, not security flaws.

---

## 1. Progress Analytics Service

**File:** `artifacts/api-server/src/services/progress-analytics.service.ts`

### Confirmed Safe

- **Stateless / pure functions** — all four exports (`computeRiskLevel`, `computeTrend`, `buildTimeline`, `classifyStudentCohorts`) are DB-free and operate on pre-fetched data, making them straightforward to unit test.
- **Threshold consistency** — risk level thresholds (< 60 = HIGH, 60–80 = MEDIUM, ≥ 80 = LOW) are applied uniformly across the service and tests.
- **Deterministic tie-breaking** — `buildTimeline` sorts by timestamp, then event type, then title, eliminating non-determinism in equal-timestamp scenarios.

### Gaps / Fragility

| Severity | Issue | Detail |
|----------|-------|--------|
| **Medium** | `maxScore: 0` produces `NaN` in `buildTimeline` | Line 195: `Math.round((e.score / e.maxScore) * 100 * 10) / 10` divides by zero if `maxScore` is 0. The schema should prevent this, but a defensive guard is missing. |
| **Low** | Fixed 5-event trend window | `computeTrend` uses a hardcoded window split (2 previous / 3 recent for exactly 5 events). Documented by design but volatile on sparse datasets. |
| **Low** | Cohort priority hides improving high-risk students | `classifyStudentCohorts` uses a priority `if/else if` chain — a HIGH-risk but IMPROVING student appears only in `atRisk`, not `needsAttention`. Intentional but worth noting for dashboard consumers. |

---

## 2. Reporting Routes

**File:** `artifacts/api-server/src/routes/reports.ts`

### Confirmed Safe

- **Layer 1 enforced** — both `GET /reports/student-summary` and `GET /reports/course-summary` apply `requireRole("admin", "teacher")` as Express middleware before any handler logic runs.
- **Layer 3 enforced** — `applyStudentLayer3Guard` calls `studentPolicy.validateAccess` (throws `PolicyAuthorizationError` → 403) and `applyCourseLayer3Guard` calls `coursePolicy.validateAccess`. Both return early on denial.
- **Soft-delete guards** — all four tables queried (students, courses, assignments, assessments) filter `isNull(table.deletedAt)`.
- **Zod input validation** — query params validated via `GetStudentReportSummaryQueryParams.safeParse` and `GetCourseReportSummaryQueryParams.safeParse`; invalid inputs return 400.

### Gaps / Risks

| Severity | Issue | Detail |
|----------|-------|--------|
| **Low** | In-memory aggregation at scale | `course-summary` fetches all assignments and assessments for a course then aggregates via `.filter()` / `.map()`. Safe at current scale; a course with 500+ students and thousands of records could stress memory. |
| **Low** | Layer 2 not used in course-summary student fetch | Students are fetched by `inArray(studentsTable.id, studentIds)` instead of `studentPolicy.getScopeCondition`. Layer 3 still secures the response, but the pattern diverges from the dashboard handler style. |

---

## 3. Dashboard Routes

**File:** `artifacts/api-server/src/routes/dashboard.ts`

### Confirmed Safe

- **Role gating** — all four aggregation endpoints (`/summary`, `/recent-activity`, `/grade-breakdown`, `/student-health`) apply `requireRole("admin", "teacher")`.
- **Layer 2 scoping** — all endpoints use `buildDashboard*Filter` helpers for consistent teacher/admin scoping.
- **Soft-delete** — all queries include `isNull(table.deletedAt)`.

### Gaps

| Severity | Issue | Detail |
|----------|-------|--------|
| **Medium** | Logic duplication in `/summary` | Lines 90–96 implement an inline `avg < 60` threshold for `atRiskStudents` instead of calling `computeRiskLevel`. If the risk threshold changes in `ProgressAnalyticsService`, the dashboard count will silently drift. |

---

## 4. Policy Layer

**Files:** `lib/policies/student-scope-policy.ts`, `shared/auth/policies/course-scope-policy.ts`

### Confirmed Safe

- **SQL_FALSE fallback** — both policies return `SQL_FALSE` when a teacher has no courses, ensuring an empty result set rather than an unfiltered one.
- **`PolicyAuthorizationError` contract** — `validateAccess` throws `PolicyAuthorizationError` (not generic `Error`) for all denied cases; the route-layer guards catch this type specifically.
- **Delegation** — `CourseScopePolicy` delegates to `TeacherScopeValidator`, maintaining a single source of truth for course-level ownership checks.

### Gaps

| Severity | Issue | Detail |
|----------|-------|--------|
| **Low** | `StudentScopePolicy.validateAccess` requires pre-fetched `enrolledCourseIds` | The caller must join enrollment data before calling the policy. Missing this step produces false negatives. No interface-level documentation enforces this contract. |

---

## 5. Middleware & Global Auth Guard

**Files:** `middleware/require-role.ts`, `routes/index.ts`

### Confirmed Safe

- **Global `requireAuth`** is applied at line 31 of `routes/index.ts` before all protected routers.
- **`requireRole`** builds a `ScopeContext` from the session and returns `403` with a standardized `OWNERSHIP_DENIED` payload for unauthorized roles.
- **Public routes** (`/api/healthz`, `/api/auth/*`) are intentionally registered before `requireAuth`.

### Gaps

| Severity | Issue | Detail |
|----------|-------|--------|
| **Low** | `downloadsRouter` registered before `requireAuth` | Confirm it carries its own internal auth check and does not serve sensitive content without session validation. |

---

## 6. Test Coverage

**Location:** `artifacts/api-server/src/tests/authorization/`

| File | Tests | Focus |
|------|-------|-------|
| `reporting-security.test.ts` | 28 | L3 student/course policy, cross-teacher isolation, L2 scope condition, error type |
| `layer3-security.test.ts` | ~34 | Deep per-resource ownership validation |
| `dashboard-scoping.test.ts` | ~25 | Dashboard filter helpers |
| `student-health-security.test.ts` | ~20 | Student-health cohort scoping |
| `progress-analytics-security.test.ts` | ~19 | Pure analytics logic |

**Total: 1,588 tests passing across 47 files.**

### Coverage Gaps

| Severity | Issue |
|----------|-------|
| **Low** | No unit test for `maxScore: 0` edge case in `buildTimeline` |
| **Low** | No integration test covering the full Express request/response cycle for the Sprint 8 reporting endpoints |
| **Low** | No test verifying the `downloads` endpoint rejects unauthenticated requests |

---

## Prioritised Recommendations

| Priority | Action |
|----------|--------|
| 1 (Medium) | **Fix logic duplication:** Refactor `dashboard.ts` `/summary` to count at-risk students using `computeRiskLevel` instead of the inline `< 60` check. |
| 2 (Medium) | **Defensive math guard:** Add `if (e.maxScore === 0) return 0` (or `100`) inside `buildTimeline`'s `scorePercent` calculation to prevent `NaN` propagation. |
| 3 (Low) | **Document policy contract:** Add a JSDoc note to `StudentScopePolicy.validateAccess` stating that `enrolledCourseIds` must be pre-fetched before calling. |
| 4 (Low) | **Audit `downloadsRouter`:** Confirm it enforces its own session check before serving any file content. |
| 5 (Low) | **Add edge-case tests:** `buildTimeline` with `maxScore: 0`; integration test for `GET /reports/student-summary` as unauthenticated → 401 and as wrong-teacher → 403. |
