# Sprint 5 Readiness Review
## Classmate Connect — Student Portal

**Date:** June 8 2026
**Reviewer:** Automated Architecture Review (Chunk 10)
**Suite baseline at review start:** 1259 / 1259 — 35 files

---

## Executive Summary

Sprint 5 delivered a complete, read-only Student Portal across 11 endpoints covering Dashboard, Courses, Workspace, Assignments, Assessments, Announcements, Notes, and Dashboard Aggregation (recent activity). The portal was built over 9 implementation chunks and hardened with a dedicated security and edge-case test pass in Chunk 9.

This review found **zero blocking defects, zero security vulnerabilities, and zero architecture violations**. Four non-blocking observations are carried forward as architecture backlog items.

**Sprint 5 Status: APPROVED WITH OBSERVATIONS**

---

## 1. Scope Delivered

| Endpoint | Method | Status |
|---|---|---|
| `/api/student/dashboard` | GET | ✅ Complete |
| `/api/student/courses` | GET | ✅ Complete |
| `/api/student/courses/{courseId}` | GET | ✅ Complete |
| `/api/student/courses/{courseId}/workspace` | GET | ✅ Complete |
| `/api/student/assignments` | GET | ✅ Complete |
| `/api/student/assignments/{assignmentId}` | GET | ✅ Complete |
| `/api/student/assessments` | GET | ✅ Complete |
| `/api/student/assessments/{assessmentId}` | GET | ✅ Complete |
| `/api/student/announcements` | GET | ✅ Complete |
| `/api/student/announcements/{announcementId}` | GET | ✅ Complete |
| `/api/student/notes` | GET | ✅ Complete |
| `/api/student/notes/{noteId}` | GET | ✅ Complete |

**Dashboard aggregation fields:**

| Field | Type | Status |
|---|---|---|
| `activeCourseCount` | scalar | ✅ |
| `totalAssignments` | scalar | ✅ |
| `pendingAssignments` | scalar | ✅ |
| `totalAssessments` | scalar | ✅ |
| `upcomingAssessments` | scalar | ✅ |
| `unreadAnnouncements` | scalar | ✅ |
| `availableNotes` | scalar | ✅ |
| `recentAssignments` | collection (LIMIT 5) | ✅ |
| `recentAssessments` | collection (LIMIT 5) | ✅ |
| `recentAnnouncements` | collection (LIMIT 5) | ✅ |
| `recentNotes` | collection (LIMIT 5) | ✅ |

---

## 2. Architecture Review

### 2.1 Layer Compliance

All 21 student portal source files (7 routes + 7 services + 7 repositories) were inspected.

#### Controllers (`artifacts/api-server/src/routes/student-*.ts`)

| Check | Result |
|---|---|
| No business logic | ✅ |
| No authorization logic | ✅ |
| No repository access | ✅ |
| No direct DB imports | ✅ |
| No `console.log` | ✅ |
| Input validated before service call | ✅ |
| Response validated with Zod schema | ✅ |

All 7 route files are validation + service call + response-parse only. Controllers extract `scopeContext` from session via `buildScopeContext(req.session)` and pass it through to services without mutation.

#### Services (`artifacts/api-server/src/services/student-*.ts`)

| Check | Result |
|---|---|
| No HTTP logic | ✅ |
| No `requireRole` / `requireAuth` calls | ✅ |
| No direct DB imports (`import db`) | ✅ |
| Business logic only (guard, aggregate, map) | ✅ |
| `studentId === null` guard on all ID-dependent services | ✅ |
| Empty-enrollment guard (`enrolledCourseIds.length === 0`) | ✅ |

*Note:* Services reference `requireRole` only in JSDoc comments documenting the middleware contract — not in executable code.

#### Repositories (`artifacts/api-server/src/lib/student-*.ts`)

| Check | Result |
|---|---|
| SQL / Drizzle access only | ✅ |
| No ownership decisions | ✅ |
| No auth logic | ✅ |
| No HTTP concerns | ✅ |
| Caller-validated empty-array guard documented | ✅ |

Repositories accept `studentId` and `enrolledCourseIds` as plain arguments derived from `ScopeContext` — they do not evaluate authorization themselves.

### 2.2 ScopeContext Propagation

`ScopeContext` carries: `studentId | null`, `enrolledCourseIds: number[]`, and teacher-role fields (`teacherId`, `ownedCourseIds`).

| Pattern | Usage |
|---|---|
| All controllers build scope via `buildScopeContext(req.session)` | ✅ |
| No manual override of scope fields in any student route | ✅ |
| No hard-coded studentId or courseId values in service code | ✅ |
| Scope passed as first argument to every service method | ✅ |

No bypasses or shortcuts found. Enrollment list is always read from the session-derived scope — never from a query parameter or request body.

### 2.3 Layered Authorization Model

```
HTTP Request
     │
     ▼
requireAuth        ← Express middleware: 401 if no session
     │
     ▼
requireRole("student")  ← Express middleware: 403 if role ≠ student
     │
     ▼
Service: studentId null guard  ← 404 if account not linked to student record
     │
     ▼
Repository: WHERE student_id = $s AND course_id IN (enrolledCourseIds)
     │
     ▼
Service: post-query enrollment check (detail endpoints)
```

All 12 endpoints implement all 4 layers. No layer was skipped.

---

## 3. Security Review

### 3.1 Authentication

- `requireAuth` is registered globally on the router before any student route. Unauthenticated requests receive **401** before reaching any controller.
- Confirmed: no student route has a bypass path.

### 3.2 Role Enforcement

`requireRole("student")` is registered on every handler in all 7 student route files:

```
student-announcements.ts   — lines 27, 47
student-assessments.ts     — lines 25, 45
student-assignments.ts     — lines 25, 45
student-courses.ts         — lines 24, 44
student-course-workspace.ts — present
student-dashboard.ts       — present
student-notes.ts           — present
```

Non-student roles (teacher, parent, admin) receive **403** before any service is reached.

### 3.3 Ownership Enforcement

#### Student-scoped resources (Assignments, Assessments)

Ownership is enforced at two independent layers:

| Layer | Mechanism |
|---|---|
| SQL query | `WHERE student_id = $studentId AND course_id IN ($enrolledCourseIds) AND deleted_at IS NULL` |
| Service post-query | After fetch-by-ID: `enrolledCourseIds.includes(row.courseId)` |

The double-check means that even if the SQL layer were misconfigured, the service layer would reject cross-student results.

#### Course-scoped resources (Announcements, Notes)

These tables have no `student_id` FK. Ownership is enforced by:

| Layer | Mechanism |
|---|---|
| SQL query | `WHERE course_id IN ($enrolledCourseIds) AND deleted_at IS NULL` |
| Service post-query | `enrolledCourseIds.includes(row.courseId)` |

#### Non-enrolled access behavior

All detail endpoints return `null` (mapped to HTTP 404 by the controller) when the requested resource belongs to a non-enrolled course or a different student. No 403 is returned — this prevents information disclosure about whether the resource ID exists.

### 3.4 IDOR Assessment

| Attack | Defense | Verified |
|---|---|---|
| Fetch another student's assignment by ID | `WHERE student_id = $me` + post-query check | ✅ Chunk 9, Section 6 |
| Fetch another student's assessment by ID | Same | ✅ Chunk 9, Section 6 |
| Fetch announcement from non-enrolled course by ID | `inArray` + post-query check | ✅ Chunk 9, Section 4 |
| Fetch note from non-enrolled course by ID | Same | ✅ Chunk 9, Section 4 |
| Enumerate another student's data via list | `WHERE student_id = $me` | ✅ Chunk 9, Section 6 |
| Dashboard showing another student's activity | `WHERE student_id = $me` in all sub-queries | ✅ Chunk 9, Section 6 |

No IDOR vulnerabilities found.

### 3.5 Soft-Delete Enforcement

`isNull(table.deletedAt)` was verified present on **every** query across all 7 repository files:

| Repository | List query | Detail query | Workspace aggregation | Dashboard counts |
|---|---|---|---|---|
| `student-assignments.queries.ts` | ✅ | ✅ | — | ✅ |
| `student-assessments.queries.ts` | ✅ | ✅ | — | ✅ |
| `student-announcements.queries.ts` | ✅ | ✅ | — | ✅ |
| `student-notes.queries.ts` | ✅ | ✅ | — | ✅ |
| `student-courses.queries.ts` | ✅ | ✅ | — | ✅ |
| `student-course-workspace.queries.ts` | — | — | ✅ (all 4 types) | — |
| `student-dashboard.queries.ts` | — | — | — | ✅ (all types) |

Soft-deleted resources are invisible across list, detail, workspace aggregation, and dashboard aggregation. No leakage path found.

---

## 4. Performance Review

### 4.1 Dashboard Query Strategy

```
Promise.all([
  getStudentDisplayName(studentId),          // 1 query: SELECT … WHERE id = $s LIMIT 1
  getStudentDashboardCounts(…),              // 2 batches of parallel COUNTs
  getStudentDashboardRecentActivity(…),      // 4 parallel SELECT … LIMIT 5
])
```

Wall-clock time ≈ `max(displayName, counts, recentActivity)` ≈ 2 DB round-trips. No sequential waterfall.

Each `recentActivity` sub-query independently uses `LIMIT 5` with `ORDER BY created_at DESC`. The limit is parameterised (`limit = 5` default) for future tunability.

### 4.2 List Endpoints

All list endpoints issue a single query with:
- `WHERE student_id = $s` (student-scoped) or `WHERE course_id IN (…)` (course-scoped)
- `AND deleted_at IS NULL`
- `ORDER BY created_at DESC`

No N+1 patterns exist. The `inArray(courseId, enrolledCourseIds)` call in course-scoped lists issues a single SQL `IN (…)` clause regardless of enrollment count. Validated at 12 enrolled courses in Chunk 9 Section 3.

### 4.3 Index Coverage

| Table | Queried column | Index defined |
|---|---|---|
| `assignments` | `student_id` | ❌ No explicit index |
| `assignments` | `course_id` | ❌ No explicit index |
| `assessments` | `student_id` | ❌ No explicit index |
| `assessments` | `course_id` | ❌ No explicit index |
| `notes` | `course_id` | ❌ No explicit index |
| `announcements` | `course_id` | ❌ No explicit index |
| `course_enrollments` | `student_id` | ✅ `ix_course_enrollments_student_id` |
| `course_enrollments` | `course_id` | ✅ `ix_course_enrollments_course_id` |
| `students` | `user_id` | ✅ `uq_students_user_id` |

**Observation (non-blocking):** `assignments`, `assessments`, `notes`, and `announcements` lack explicit secondary indexes on `student_id` / `course_id`. PostgreSQL will sequential-scan these tables at scale. At current test data volumes this is invisible, but will surface as table row counts grow. Raised as AB-005 (see Section 8).

### 4.4 Workspace Aggregation

The workspace query uses a single `LEFT JOIN` per resource type to count non-deleted rows, rather than issuing separate COUNT queries per resource. This is O(1) queries regardless of workspace content size.

---

## 5. OpenAPI Review

### 5.1 Path Coverage

All 12 student portal endpoints are documented in `lib/api-spec/openapi.yaml`:

```
/student/notes
/student/notes/{noteId}
/student/announcements
/student/announcements/{announcementId}
/student/assessments
/student/assessments/{assessmentId}
/student/assignments
/student/assignments/{assignmentId}
/student/courses
/student/courses/{courseId}
/student/courses/{courseId}/workspace
/student/dashboard
```

### 5.2 Codegen

Codegen completed successfully with no errors or drift. Barrel guard confirms no naming conflicts between generated and manual exports:

```
✅  All barrel checks passed.
✓ No naming conflicts between wildcard and named exports
✓ No duplicate names across wildcard sources
```

Generated React Query hooks and Zod validators compile clean across all 4 TypeScript packages.

### 5.3 Open Items

| Item | Severity | Backlog |
|---|---|---|
| Security scheme (`securitySchemes`) missing from OpenAPI spec | Low | AB-001 |
| Enrollment endpoints absent from OpenAPI spec | Low | AB-001 |

These are carry-forwards from Sprint 4. They do not affect the student portal — student endpoints are correctly tagged, typed, and codegen'd.

---

## 6. Test Coverage Review

### 6.1 Suite Summary

| Metric | Value |
|---|---|
| Total tests | **1259 / 1259** |
| Test files | **35** |
| Student portal test files | **9** |
| Student portal test lines | **4,713** |
| Sprint 5 tests added | **254** |
| Pre-Sprint-5 baseline | 1005 |
| Regressions | **0** |

### 6.2 Student Portal Test Coverage

| File | Tests | Coverage |
|---|---|---|
| `student-dashboard.test.ts` | 19 | Auth, DTO shape (all 9 scalars), scope boundary |
| `student-courses.test.ts` | 17 | Enrollment scope, IDOR, DTO fields |
| `student-course-workspace.test.ts` | 26 | Aggregation accuracy, soft-delete in workspace |
| `student-assignments.test.ts` | 26 | Auth, DTO shape, ordering, scope |
| `student-assessments.test.ts` | 26 | Auth, DTO shape, ordering, scope |
| `student-announcements.test.ts` | 25 | Auth, DTO shape, course scoping, IDOR |
| `student-notes.test.ts` | 26 | Auth, DTO shape, course scoping, IDOR |
| `student-dashboard-enhancements.test.ts` | 31 | Recent activity (4 types), LIMIT, ordering, cross-type accuracy |
| `student-portal-hardening.test.ts` | 58 | Null guard, empty state, large enrollment, mixed visibility, soft-delete, cross-student IDOR |

### 6.3 Hardening Coverage Matrix (Chunk 9)

| Scenario | Services covered | Tests |
|---|---|---|
| `studentId = null` guard | All 7 | 9 |
| Empty state (no data) | All 7 | 12 |
| Large enrollment (12 courses) | Courses, Announcements, Notes, Dashboard | 8 |
| Mixed visibility (enrolled vs. not) | Assignments, Assessments, Announcements, Notes | 10 |
| Soft-delete invisible | All 7 + Dashboard | 9 |
| Cross-student IDOR | Assignments, Assessments, Dashboard | 10 |

### 6.4 Gaps

| Area | Assessment |
|---|---|
| HTTP-layer authorization tests (401/403) | Covered by pre-existing `authorization/` suite (68 IDOR + 76 policy + 44 scope-integrity + others) |
| E2E / contract tests against live HTTP server | Not in scope for Sprint 5 — service-layer tests used throughout |
| Load / concurrency testing | Not in scope |

No functional test gaps found within the defined sprint scope.

---

## 7. Architecture Backlog Review

### AB-001 — OpenAPI Synchronization

**Status:** Open — carry from Sprint 4.
**Scope in Sprint 5:** Student portal endpoints are fully documented. The two open gaps (security scheme definition, enrollment endpoints) were not touched in Sprint 5.
**Risk:** Low. Clients and servers are synchronized for all implemented endpoints. The missing security scheme is cosmetic in generated clients.
**Sprint 6 Recommendation:** Address in Sprint 6 Week 1 alongside any new teacher-facing endpoints. Negligible implementation cost.

---

### AB-002 — Audit Field Remediation

**Status:** Open — carry from Sprint 4.
**Scope in Sprint 5:** No new entities were introduced. Existing audit field gaps (`created_by`, `updated_by` absent from all tables; `updated_at` absent from `announcements`) are unchanged.
**Risk:** Low-medium. No current feature depends on these fields. Risk increases if audit logging is required for compliance.
**Sprint 6 Recommendation:** Implement as additive nullable-column migrations. Safe to deploy without downtime. Target Sprint 6 Week 2.

---

### AB-003 — Teacher Ownership Unification

**Status:** No regression in Sprint 5. Student and teacher ownership use distinct but internally consistent patterns (`ScopeContext.enrolledCourseIds` for students, `ScopeContext.ownedCourseIds` for teachers). No cross-role confusion observed.
**Risk:** Low. Patterns are parallel, not conflated.
**Sprint 6 Recommendation:** Defer. Review when a new role (parent portal) is introduced. The patterns are well-documented; no production risk identified.

---

### AB-004 — UUID/Public ID Strategy Review

**Status:** All public API IDs are integer PKs. No change in Sprint 5.
**Risk:** Medium-term. Integer IDs are enumerable and leak row counts. At current single-tenant scale this is acceptable. A migration to UUIDs is a breaking API change.
**Sprint 6 Recommendation:** Schedule a dedicated ADR (Architecture Decision Record). Do not implement without a versioning strategy.

---

### AB-005 — Index Naming Standard Adoption and Coverage

**Status:** Partially addressed. `course_enrollments` has `ix_`-prefixed indexes. `students` has `uq_` prefix. However, `assignments`, `assessments`, `notes`, and `announcements` have **no secondary indexes** on `student_id` or `course_id`.
**Risk:** Medium. All Student Portal list queries filter by `student_id` or `course_id`. Sequential scans on these tables will become the dominant query cost as row counts grow.
**Sprint 6 Recommendation:** **Priority: High.** Add the following indexes in the first Sprint 6 migration:

```sql
CREATE INDEX ix_assignments_student_id  ON assignments (student_id)  WHERE deleted_at IS NULL;
CREATE INDEX ix_assignments_course_id   ON assignments (course_id)   WHERE deleted_at IS NULL;
CREATE INDEX ix_assessments_student_id  ON assessments (student_id)  WHERE deleted_at IS NULL;
CREATE INDEX ix_assessments_course_id   ON assessments (course_id)   WHERE deleted_at IS NULL;
CREATE INDEX ix_notes_course_id         ON notes (course_id)         WHERE deleted_at IS NULL;
CREATE INDEX ix_announcements_course_id ON announcements (course_id) WHERE deleted_at IS NULL;
```

Partial indexes (`WHERE deleted_at IS NULL`) keep the index small by excluding soft-deleted rows — matching the query predicate exactly.

---

### AB-006 — Route Handler Repository Cleanup

**Status:** Confirmed clean in Sprint 5. Zero student route files contain direct DB access. Teacher-side routes are outside this review's scope but were previously assessed in Sprint 4 (one inline query was found; status not re-verified in this review).
**Sprint 6 Recommendation:** Re-validate teacher routes at the start of Sprint 6 before adding new teacher endpoints.

---

### AB-007 — Architecture Definition of Done

**Status:** No formal DoD document exists. Sprint 5 implicitly applied a consistent Definition of Done (typecheck clean, test coverage, codegen verified, layer compliance). This was effective but relies on institutional knowledge.
**Sprint 6 Recommendation:** Formalize as `docs/architecture/definition-of-done.md` covering: layer compliance checklist, security checklist, OpenAPI sync, codegen verification, test thresholds.

---

### AB-008 — API Client Codegen Stability

**Status:** Stable. The Orval codegen pipeline (OpenAPI → React Query hooks + Zod validators) ran successfully after every Sprint 5 chunk. The barrel guard (`[3/3] Checking for wildcard/named export conflicts`) catches naming conflicts automatically. No manual barrel edits were required in Sprint 5.
**Sprint 6 Recommendation:** No action required. Monitor if new generator versions are introduced.

---

## 8. Production Readiness Assessment

### Architecture

**PASS**

All 21 student portal source files comply with the layered architecture. Controllers, services, and repositories have clean separation of concerns with no violations found on automated inspection. `ScopeContext` propagation is consistent. No `console.log` in server code.

---

### Security

**PASS**

Authentication (401) and role enforcement (403) are applied at the middleware layer on every endpoint. IDOR protection is implemented at two independent layers (SQL predicate + post-query service check). Soft-delete is enforced on 100% of queries. Cross-student data leakage has zero observed paths.

---

### Performance

**PASS WITH OBSERVATIONS**

Dashboard aggregation is O(2 round-trips) via `Promise.all`. List queries are O(1) queries regardless of enrollment size. No N+1 patterns. All `LIMIT 5` bounds are enforced and verified at scale.

*Observation:* Four core tables (`assignments`, `assessments`, `notes`, `announcements`) lack secondary indexes on `student_id` / `course_id`. These will sequential-scan at scale. Non-blocking at current volume; tracked as AB-005 with a Sprint 6 remediation plan.

---

### Maintainability

**PASS**

All repository functions are documented with `@param` annotations describing scope expectations. Layer contracts are documented in service-level JSDoc. Test files follow a consistent `describe → it → arrange/act/assert` structure. File sizes are appropriate (median service ~110 lines, median repository ~100 lines).

---

### Testability

**PASS**

254 student-portal-specific tests across 9 test files. All tests use the service layer directly (not HTTP) with real DB transactions rolled back after each test. The `makeScope`/`createStudentScope` helpers enable deterministic scope construction. Edge cases (null studentId, empty enrollment, soft-delete, IDOR) are all independently covered.

---

### API Stability

**PASS WITH OBSERVATIONS**

All 12 student portal endpoints have OpenAPI documentation, generated Zod validators, and generated React Query hooks. The generated client compiles clean.

*Observation:* Security scheme definition absent from OpenAPI spec (AB-001). This does not affect runtime behavior or generated client correctness.

---

### Operational Risk

**PASS WITH OBSERVATIONS**

No blocking operational risks. Soft-delete visibility is consistently enforced. Session-derived scope cannot be overridden by clients.

*Observation:* `created_by`/`updated_by` audit fields are absent from all entities (AB-002). If an incident requires attribution of data changes, these fields will be unavailable. Non-blocking at current scale.

---

### Scalability

**PASS WITH OBSERVATIONS**

Architecture supports horizontal scaling (stateless Express + session from DB). Query patterns are O(1) queries per request.

*Observation:* Index gap on `student_id`/`course_id` columns (AB-005). Mitigated by the partial-index remediation plan proposed above.

---

## 9. Production Readiness Matrix

| Category | Rating | Key Observation |
|---|---|---|
| Architecture | **PASS** | Zero layer violations across all 21 files |
| Security | **PASS** | 4-layer auth + IDOR double-check verified |
| Performance | **PASS WITH OBSERVATIONS** | Index gap on 4 tables (AB-005) |
| Maintainability | **PASS** | Documented, sized, structured consistently |
| Testability | **PASS** | 254 student portal tests, all passing |
| API Stability | **PASS WITH OBSERVATIONS** | Security scheme absent from OpenAPI (AB-001) |
| Operational Risk | **PASS WITH OBSERVATIONS** | Audit fields missing (AB-002) |
| Scalability | **PASS WITH OBSERVATIONS** | Same index gap as Performance |

---

## 10. Sprint 5 Sign-Off Recommendation

### Findings Summary

| Finding | Severity | Blocking | Action |
|---|---|---|---|
| `student_id`/`course_id` indexes missing on 4 tables | Medium | No | AB-005 → Sprint 6 |
| OpenAPI security scheme missing | Low | No | AB-001 → Sprint 6 |
| Audit fields (`created_by`/`updated_by`) absent | Low | No | AB-002 → Sprint 6 |
| No formal Architecture DoD document | Low | No | AB-007 → Sprint 6 |

**Zero blocking defects.** No security vulnerabilities. No architecture violations. No regressions.

### Final Status

## ✅ APPROVED WITH OBSERVATIONS

Sprint 5 — Student Portal — is approved for production deployment.

Four non-blocking observations are carried to the Sprint 6 architecture backlog. The highest-priority item entering Sprint 6 is **AB-005 (index coverage)**, which should be resolved in the first sprint migration.

---

## Appendix A — File Inventory

### Route files (7)
- `artifacts/api-server/src/routes/student-dashboard.ts` (35 lines)
- `artifacts/api-server/src/routes/student-courses.ts` (64 lines)
- `artifacts/api-server/src/routes/student-course-workspace.ts` (49 lines)
- `artifacts/api-server/src/routes/student-assignments.ts` (68 lines)
- `artifacts/api-server/src/routes/student-assessments.ts` (68 lines)
- `artifacts/api-server/src/routes/student-announcements.ts` (70 lines)
- `artifacts/api-server/src/routes/student-notes.ts` (67 lines)

### Service files (7)
- `artifacts/api-server/src/services/student-dashboard.service.ts` (143 lines)
- `artifacts/api-server/src/services/student-courses.service.ts` (87 lines)
- `artifacts/api-server/src/services/student-course-workspace.service.ts` (79 lines)
- `artifacts/api-server/src/services/student-assignments.service.ts` (109 lines)
- `artifacts/api-server/src/services/student-assessments.service.ts` (119 lines)
- `artifacts/api-server/src/services/student-announcements.service.ts` (105 lines)
- `artifacts/api-server/src/services/student-notes.service.ts` (94 lines)

### Repository files (7)
- `artifacts/api-server/src/lib/student-dashboard.queries.ts` (287 lines)
- `artifacts/api-server/src/lib/student-courses.queries.ts` (30 lines)
- `artifacts/api-server/src/lib/student-course-workspace.queries.ts` (140 lines)
- `artifacts/api-server/src/lib/student-assignments.queries.ts` (105 lines)
- `artifacts/api-server/src/lib/student-assessments.queries.ts` (102 lines)
- `artifacts/api-server/src/lib/student-announcements.queries.ts` (94 lines)
- `artifacts/api-server/src/lib/student-notes.queries.ts` (90 lines)

### Test files (9)
- `student-dashboard.test.ts` — 19 tests / 454 lines
- `student-courses.test.ts` — 17 tests / 331 lines
- `student-course-workspace.test.ts` — 26 tests / 526 lines
- `student-assignments.test.ts` — 26 tests / 474 lines
- `student-assessments.test.ts` — 26 tests / 479 lines
- `student-announcements.test.ts` — 25 tests / 458 lines
- `student-notes.test.ts` — 26 tests / 434 lines
- `student-dashboard-enhancements.test.ts` — 31 tests / 696 lines
- `student-portal-hardening.test.ts` — 58 tests / 861 lines

**Total: 254 student portal tests across 4,713 lines**

---

## Appendix B — Sprint 6 Backlog Priority Order

| Priority | Item | Effort |
|---|---|---|
| 1 | **AB-005** — Add `student_id`/`course_id` partial indexes | XS (1 migration) |
| 2 | **AB-001** — Add OpenAPI security scheme + enrollment paths | S |
| 3 | **AB-002** — Add `created_by`/`updated_by` nullable columns via migration | S |
| 4 | **AB-007** — Write `docs/architecture/definition-of-done.md` | XS |
| 5 | **AB-004** — ADR for UUID/public ID strategy (decision only) | S |
| 6 | **AB-006** — Re-audit teacher route handlers for inline DB access | XS |
| 7 | **AB-003** — Ownership unification review (deferred until parent portal) | — |
| 8 | **AB-008** — Codegen stability (no action required; monitor) | — |
