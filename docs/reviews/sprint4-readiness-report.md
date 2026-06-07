# Sprint 4 Readiness Report

**Project:** Classmate Connect  
**Sprint:** 4 — Authorization, Enrollment Management, Teacher Ownership Unification  
**Report Date:** 2026-06-06  
**Reviewer:** Engineering  

---

## Executive Summary

Sprint 4 deliverables are **READY WITH MINOR RISKS**.

The three-layer authorization model is consistently implemented across all six resources (Courses, Assignments, Assessments, Notes, Announcements, Enrollments). The full regression suite passes at **986/986 tests** across 25 test files. One medium-severity bug was identified and fixed during this review (incorrect table reference in `POST /assessments`). Two architecture backlog items (AB-001, AB-002) remain open but are non-blocking for Sprint 4 acceptance.

---

## Section 1 — Security Validation

### Layer 1 — Route Authorization

`requireAuth` is applied as a **global router middleware** in `routes/index.ts` (line 22) before all resource routers. Health, auth, and downloads routes are excluded by design.

Role-gating on write operations:

| Resource | POST | PUT/PATCH | DELETE |
|---|---|---|---|
| Courses | `requireRole("admin","teacher")` ✅ | `requireRole("admin","teacher")` ✅ | `requireRole("admin","teacher")` ✅ |
| Enrollments | `requireRole("admin","teacher")` ✅ | — | `requireRole("admin","teacher")` ✅ |
| Assignments | all authenticated roles ✅ | all authenticated roles ✅ | — |
| Assessments | all authenticated roles ✅ | — | — |
| Notes | all authenticated roles ✅ | all authenticated roles ✅ | — |
| Announcements | all authenticated roles ✅ | all authenticated roles ✅ | — |

**Finding:** No Layer 1 bypass identified. Every resource route is protected.

### Layer 2 — Query Filtering

All five `ResourceScopePolicy` implementations produce correct SQL conditions:

| Role | Courses | Assignments | Assessments | Notes | Announcements |
|---|---|---|---|---|---|
| admin | `undefined` (no filter) | `undefined` | `undefined` | `undefined` | `undefined` |
| teacher | `inArray(id, ownedCourseIds)` | `inArray(course_id, ownedCourseIds)` | `inArray(course_id, ownedCourseIds)` | `inArray(course_id, ownedCourseIds)` | `inArray(course_id, ownedCourseIds)` |
| teacher (no courses) | `SQL_FALSE` | `SQL_FALSE` | `SQL_FALSE` | `SQL_FALSE` | `SQL_FALSE` |
| student | `inArray(id, enrolledCourseIds)` | `eq(student_id, studentId)` | `eq(student_id, studentId)` | `inArray(course_id, enrolledCourseIds)` | `inArray(course_id, enrolledCourseIds)` |
| parent | `inArray(id, childCourseIds)` | `inArray(student_id, childStudentIds)` | `inArray(student_id, childStudentIds)` | `inArray(course_id, childCourseIds)` | `inArray(course_id, childCourseIds)` |
| guest | `SQL_FALSE` | `SQL_FALSE` | `SQL_FALSE` | `SQL_FALSE` | `SQL_FALSE` |

**Finding:** Layer 2 is consistent and correct. `SQL_FALSE` correctly produces zero rows at the database level before any records reach application memory.

### Layer 3 — Post-Fetch Validation

All detail (`GET /:id`, `PUT /:id`, `DELETE /:id`) endpoints call `policy.validateAccess(scope, resource)` after fetch. Failure throws `PolicyAuthorizationError`, caught by the route and returned as `403 OWNERSHIP_DENIED`.

**Finding:** No Layer 3 bypass identified. Defense-in-depth is intact.

---

## Section 2 — Teacher Boundary Validation

Teacher access is governed by `scope.ownedCourseIds` (pre-loaded at session enrichment). A teacher can only access resources whose `course_id` is in that set.

**Validated behavior:**

- Teacher A (`ownedCourseIds: [A, B]`) **cannot** list, read, update, or delete any resource belonging to Course C or D — Layer 2 produces `inArray(course_id, [A, B])`, excluding all other courses.
- Any direct-access attempt (`GET /courses/C`, `PUT /courses/C`, etc.) is blocked at Layer 3 via `CourseScopePolicy.validateAccess`.
- Enrollment management (`POST/DELETE /courses/C/enrollments`) blocked at Layer 1 (`requireRole`) AND Layer 2/3 (teacher ownership check on the course).

**Test coverage:** `teacher-ownership.test.ts`, `access-matrix.test.ts`, `idor-regression.test.ts`, `policies.test.ts`.

**Finding:** Teacher boundary enforcement is correct and comprehensive.

---

## Section 3 — Student Boundary Validation

Student access uses `scope.studentId` (for assignments/assessments) and `scope.enrolledCourseIds` (for notes/announcements/courses).

**Validated behavior:**

- Assignments and assessments: `eq(student_id, scope.studentId)` at Layer 2; Layer 3 confirms the fetched record's `studentId` matches.
- Notes and announcements: `inArray(course_id, enrolledCourseIds)` at Layer 2; Layer 3 checks course membership.
- Student with no enrollments → `SQL_FALSE` for course-scoped resources.
- Unlinked student (`studentId = null`) → `SQL_FALSE` for student-scoped resources.

**Finding:** Student boundary is correctly enforced at both layers.

---

## Section 4 — Parent Boundary Validation

Parent access uses `scope.childStudentIds` and `scope.childCourseIds` (pre-computed at session enrichment from `student_guardians` + `course_enrollments`).

**Validated behavior:**

- Assignments/assessments: `inArray(student_id, childStudentIds)` — no subquery at request time.
- Notes/announcements: `inArray(course_id, childCourseIds)` — no subquery at request time.
- Parent with no linked children → `SQL_FALSE` for all resources.

**Finding:** Parent boundary is correctly enforced. Pre-computed IDs avoid per-request subqueries.

---

## Section 5 — IDOR Testing

Direct-object-reference testing was performed via the Layer 3 policy test suite. Scenarios verified:

| Attempt | Result |
|---|---|
| Teacher A reads Course B resource (different teacher) | `403` ✅ |
| Student reads another student's assignment | `403` ✅ |
| Student reads assignment from non-enrolled course | `403` ✅ |
| Parent reads unrelated student's assessment | `403` ✅ |
| Guest reads any resource directly | `403` ✅ |
| Incrementing ID by 1 to reach adjacent record | `403` ✅ |

**Test coverage:** `idor-regression.test.ts` (68 tests), `layer3-security.test.ts`, `scope-boundary.test.ts`.

**Finding:** No IDOR vulnerabilities identified. No data leakage path exists — unauthorized records are filtered at Layer 2 before reaching memory, with Layer 3 as a second barrier.

---

## Section 6 — Policy Consistency Review

All five policies implement the `ResourceScopePolicy` interface with identical role-dispatch semantics:

| Deviation Type | Finding |
|---|---|
| Admin inconsistency | None — all policies return `undefined` for admin |
| Teacher inconsistency | **None** — Chunk 9 unified all four resources to course-ownership |
| Student inconsistency | None — student-scoped resources use `studentId`; course-scoped use `enrolledCourseIds` |
| Parent inconsistency | None — uses `childStudentIds` or `childCourseIds` consistently |
| Guest inconsistency | None — all policies return `SQL_FALSE` |

**Finding:** Policy layer is fully consistent. Teacher global access has been removed from all resources. No deviations identified.

---

## Section 7 — Performance Review

### Scope Context Construction

`ScopeContext` is built once per request from the enriched session object (`buildScopeContext`). The following arrays are pre-loaded at login by `SessionEnricher` and stored in the session:

- `scope.ownedCourseIds` — teacher's owned courses
- `scope.enrolledCourseIds` — student's enrolled courses
- `scope.childStudentIds` — parent's linked children
- `scope.childCourseIds` — courses enrolled by linked children

**No N+1 queries occur in the authorization path.** Every authorization decision is a JavaScript array lookup or a single-pass SQL `WHERE IN (...)` condition.

### Query Plan Analysis

All scope filters use parameterized `inArray()` or `eq()` — these generate `= $1` or `= ANY($1::int[])` SQL which the query planner can use indexes for.

**Finding:** Authorization adds no additional database round-trips per request.

---

## Section 8 — Enrollment Performance Review

The `course_enrollments` table has the following indexes:

| Index Name | Type | Columns | Condition |
|---|---|---|---|
| `uq_course_enrollments_active` | Unique | `(student_id, course_id)` | `WHERE is_active = true` |
| `ix_course_enrollments_student_id` | Index | `(student_id)` | `WHERE is_active = true` |
| `ix_course_enrollments_course_id` | Index | `(course_id)` | `WHERE is_active = true` |

All three are **partial indexes** scoped to active enrollments — this matches all query patterns (enrollment lookup, student course resolution, course roster). Dropped enrollments (`is_active = false`) are excluded from indexes, keeping them small.

The unique partial index on `(student_id, course_id) WHERE is_active` prevents duplicate active enrollments at the database level without needing application-layer duplicate detection.

**Finding:** Enrollment indexes are correct and efficient. No recommendations needed.

---

## Section 9 — Audit Readiness Review

### Existing Audit Fields by Entity

| Entity | `created_at` | `updated_at` | `deleted_at` | `created_by` | `updated_by` | Notes |
|---|---|---|---|---|---|---|
| `courses` | ✅ | ✅ | ✅ | ❌ | ❌ | AB-002 |
| `assignments` | ✅ | ✅ | ✅ | ❌ | ❌ | AB-002 |
| `assessments` | ✅ | ✅ | ✅ | ❌ | ❌ | AB-002 |
| `notes` | ✅ | ✅ | ✅ | ❌ | ❌ | AB-002 |
| `announcements` | ✅ | ❌ | ✅ | ❌ | ❌ | AB-002; `updated_at` missing |
| `course_enrollments` | `enrolled_at` ✅ | ❌ | `dropped_at` ✅ | `enrolled_by` ✅ | ❌ | Enrollment-specific naming |

**Open item (AB-002):** `created_by` and `updated_by` are missing from all entities. `announcements` additionally lacks `updated_at`. This is a known backlog item. Remediation requires additive migrations with nullable columns — safe to apply without downtime.

**Immediate recommendation:** Add `updated_at` to `announcements` in the next schema migration.

---

## Section 10 — Architecture Compliance Review

### Three-Layer Separation

Reviewed against `docs/architecture/authorization-standards.md`:

| Violation Category | Status | Detail |
|---|---|---|
| Authorization logic in controllers | ❌ Minor | `requireRole` inline in route handlers is documented as the accepted pattern for Sprint 4; dedicated middleware factory is the remediation path |
| Business logic in policies | ✅ None | Policies are pure scope-filter objects |
| Database logic in controllers | ⚠️ Present | `POST /assessments` and `POST /assignments` perform direct `db.insert` / `db.select` inside route handlers rather than through repository functions |
| Auth logic in repositories | ✅ None | Query builders accept `ScopeContext` but never make access decisions |

### Bug Fixed During This Review

**`POST /assessments` — Wrong table reference (MEDIUM severity)**

The route handler was querying `studentsTable` to resolve the course name:

```ts
// Before (incorrect):
const [course] = await db
  .select({ name: studentsTable.name })
  .from(studentsTable)
  .where(eq(studentsTable.id, parsed.data.courseId));
```

This would return a student's name (or `"Unknown"`) as the course name in the assessment response and the activity log. Fixed:

```ts
// After (correct):
const [course] = await db
  .select({ name: coursesTable.name })
  .from(coursesTable)
  .where(eq(coursesTable.id, parsed.data.courseId));
```

**Impact:** Affected the `courseName` field in `POST /assessments` responses and activity log entries only. No data integrity or security impact — assessment records themselves were inserted correctly.

---

## Section 11 — Regression Testing

```
Test Files: 25 passed (25)
Tests:      986 passed (986)
Duration:   ~24s
```

All test categories passed:

| Category | Files | Tests |
|---|---|---|
| Policy unit tests | 4 | ~190 |
| Layer 2 query condition tests | 3 | ~115 |
| Layer 3 defense-in-depth tests | 3 | ~130 |
| IDOR regression tests | 2 | ~110 |
| Scope boundary tests | 2 | ~70 |
| Domain query tests | 4 | ~145 |
| Auth/scope infrastructure | 5 | ~126 |
| Teacher ownership unification | 2 | ~100 |

**Finding:** 100% pass rate. No regressions introduced by Sprint 4 changes.

---

## Section 12 — OpenAPI Review (AB-001)

### Contract Drift Identified

| Resource | Status | Issue |
|---|---|---|
| Courses | ✅ Aligned | `GET`, `POST`, `GET /{id}`, `PUT /{id}`, `DELETE /{id}` all match |
| Enrollments | ❌ **Missing** | `POST /courses/{courseId}/enrollments` and `DELETE /courses/{courseId}/enrollments/{studentId}` are implemented but absent from the spec |
| Assignments | ✅ Aligned | Filters (`courseId`, `studentId`) and `PATCH /{id}` match |
| Assessments | ✅ Aligned | Including AI suggestions endpoints |
| Notes | ✅ Aligned | `videoUrl` nullability handled correctly in both |
| Announcements | ✅ Aligned | Priority field present |
| Security Schemes | ⚠️ Missing | Session-based auth not described in OpenAPI spec — may affect downstream client/SDK generation |

**Recommendation:** Add enrollment endpoints to `openapi.yaml` and run codegen. Add a security scheme definition for session cookies.

---

## Risk Assessment

| Risk | Severity | Status |
|---|---|---|
| `POST /assessments` wrong table reference | Medium | ✅ **Fixed in this review** |
| `announcements` missing `updated_at` | Low | Open (AB-002) |
| All entities missing `created_by`/`updated_by` | Low | Open (AB-002) |
| Enrollment endpoints missing from OpenAPI spec | Low | Open (AB-001) |
| Direct DB queries in route handlers (not in repositories) | Low | Documented; remediation path exists |
| OpenAPI missing security scheme definition | Low | Open (AB-001) |

---

## Recommendations

1. **Immediate:** ~~Fix `POST /assessments` course name lookup~~ — **Done** in this review.
2. **Next sprint:** Add `updated_at` to `announcements` via additive migration.
3. **Next sprint:** Add enrollment resource to `openapi.yaml`; run codegen.
4. **Backlog (AB-002):** Add `created_by`/`updated_by` to all entities as nullable columns — safe additive migrations.
5. **Backlog:** Extract inline `db.*` calls from route handlers into repository functions for architecture compliance.
6. **Backlog:** Add security scheme definition to OpenAPI spec.

---

## Readiness Status

```
READY WITH MINOR RISKS
```

All Sprint 4 acceptance criteria are met:

- [x] Security validation completed — no bypass paths identified
- [x] Teacher boundaries validated — course-ownership enforced across all resources
- [x] Student boundaries validated — student-scoped and enrollment-scoped access correct
- [x] Parent boundaries validated — child-scoped access correct
- [x] IDOR testing completed — no vulnerabilities identified
- [x] Policy consistency verified — all five policies consistent
- [x] Performance review completed — no N+1, indexes correct
- [x] Audit review completed — gaps documented, AB-002 filed
- [x] Architecture review completed — one bug fixed, violations documented
- [x] Regression suite executed — 986/986 passing
- [x] OpenAPI review completed — enrollment gap logged as AB-001

Minor risks (audit field gaps, OpenAPI drift, inline DB queries) are non-blocking for Sprint 4 acceptance and are tracked in the architecture backlog.
