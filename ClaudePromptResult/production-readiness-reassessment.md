# Production Readiness Reassessment Report

**Date:** June 9, 2026
**Codebase revision:** post Sprint 6 Chunk 1 (commit e0a2f78)
**Test suite:** 1330/1330 passing
**Scope:** Full codebase inspection — backend, frontend, database, OpenAPI, RBAC, audit, security

---

## Executive Summary

The backend is production-quality in its security architecture. The 3-layer authorization system, soft-delete discipline, and password hardening are all sound. However, the frontend is in a near-read-only state for every user role. Teachers cannot create courses, assignments, notes, or announcements. The student portal has zero frontend pages. One security gap allows any authenticated user to invoke database probe endpoints from the Settings page. These findings collectively block a pilot deployment.

**Final Verdict: NOT READY FOR PILOT**

---

## Architecture Findings

### A-01 — Write operations bypass the repository layer
**Severity: Medium**

Read operations consistently use `.queries.ts` files with embedded Layer 2 scope filtering. Write operations (INSERT, UPDATE) in `courses.ts`, `notes.ts`, `assessments.ts`, and `students.ts` call `db.insert` / `db.update` directly inside route handlers. This creates two problems:

1. **Audit field drift** — there is no central place where `createdBy` / `updatedBy` are guaranteed to be set. Each handler must remember to do it. Several have already failed to (see A-02).
2. **No mutation test surface** — write logic is untestable in isolation; tests must go through the full HTTP layer or the DB directly.

The `UserService` / `UserRepository` pattern established in Sprint 6 is architecturally correct. The older resource types have not been brought to that standard.

---

### A-02 — `students.ts` mutations do not populate audit fields
**Severity: Medium**

The `PATCH /students/:id` handler calls `db.update(studentsTable).set(parsed.data)` — passing only the client-supplied fields. Neither `updatedAt` nor `updatedBy` are injected. The `POST /students` handler similarly does not set `createdBy`. The `DELETE` handler is the only one that correctly records `deletedBy`.

This is a direct consequence of A-01: without a service/repository layer that enforces audit fields, each handler is responsible for remembering them.

---

### A-03 — Dashboard does not scope by teacher
**Severity: Low / Design Decision**

`GET /dashboard/summary`, `GET /dashboard/recent-activity`, and `GET /dashboard/grade-breakdown` are guarded by `requireRole("admin","teacher")` but do not build a `ScopeContext`. All three query the full tables (minus soft-deleted rows). A teacher sees metrics for all students and all courses system-wide, not just their own classes.

This may be intentional for a single-school MVP. It must be a documented decision before launch.

---

### A-04 — Thin cross-repository coupling exists
**Severity: Low**

`student-course-workspace.queries.ts` imports `getCourseById` from `courses.queries.ts`. `student-courses.queries.ts` delegates entirely to `courses.queries.ts`. This is acceptable but departs from a pure single-responsibility model.

---

## Security Findings

### S-01 — `admin.ts` has no `requireRole` — OPEN (Critical)

`GET /admin/db-status` and `POST /admin/test-db` are mounted after `requireAuth` only. Any authenticated user regardless of role can call them.

`POST /admin/test-db` accepts an arbitrary host, port, database, user, and password from the request body and attempts a real database connection from the server. A student or parent session can use this to:
- Probe internal network topology
- Brute-force database credentials through the server
- Confirm existence of internal services

The Settings page in the frontend exposes both endpoints in a form UI, making them trivially accessible to any logged-in user.

```
routes/index.ts    →  router.use(adminRouter)   // after requireAuth only
admin.ts           →  no requireRole call anywhere in the file
settings/index.tsx →  calls /api/admin/db-status and /api/admin/test-db
```

---

### S-02 — `students.ts` has no Layer 3 IDOR validation — OPEN (High)

`GET /students/:id`, `PATCH /students/:id`, `DELETE /students/:id`, and `GET /students/:id/progress` all rely exclusively on Layer 1 (`requireRole("admin","teacher")`). There is no ownership check. Any teacher can read, edit, delete, or view progress for any student in the system regardless of course enrollment.

The `buildScopeContext` call in the DELETE handler is used only to extract `userId` for `deletedBy`. It does not validate that the requesting teacher has any relationship to the student.

Every other resource type (assignments, assessments, announcements, notes, courses) implements the full 3-layer pattern. Students is the sole outlier.

---

### S-03 — `GET /courses` carries no `requireRole` — Partially Resolved (Low)

Both `GET /courses` and `GET /courses/:id` are protected only by `requireAuth`. The scope filter returns role-appropriate data:
- Admin → all courses
- Teacher → owned courses only
- Student → enrolled courses only
- Parent → child's courses only
- Guest → zero rows (`SQL_FALSE`)

The risk is acceptable as-is but requires a documented architectural decision: is it intentional that guests can call these endpoints and receive empty results rather than a 403?

---

### S-04 — Password envelope key is production-critical — Pre-deployment (High)

`password.ts` requires `PASSWORD_ENCRYPTION_KEY` at runtime. Absence throws at first password operation. Loss of the key renders all stored password hashes permanently unverifiable. This key must be provisioned in production secrets before first deployment and backed up in a secrets manager. There is no fallback or migration path if the key is rotated without re-encrypting existing hashes.

---

## RBAC Audit

| Component | Status | Evidence |
|---|---|---|
| `requireRole()` middleware | **ACTIVE** | Applied to all protected route groups |
| `users.role` as authoritative source | **ACTIVE** | Session enricher reads `users.role`; `requireRole` reads `scope.role` from session |
| Session enricher (role-based branching) | **ACTIVE** | `enrichTeacher`, `enrichStudent`, `enrichParent` methods confirmed |
| `user_roles` table | **PARTIAL** | Schema defined, seeded, but never queried for authorization |
| `role_permissions` table | **PARTIAL** | Schema defined, seeded, but never queried |
| `permissions` table | **PARTIAL** | Schema defined, seeded, but never queried |
| `rbac_version` table | **UNUSED** | Schema exists, no runtime usage found |
| `requirePermission()` middleware | **UNUSED** | Not implemented — does not exist in codebase |

The RBAC tables (`user_roles`, `role_permissions`, `permissions`) are dead schema weight. They will create confusion for future engineers who expect them to be authoritative. They should either be activated or formally removed before launch.

---

## Audit Field Review

| Table | `created_at` | `updated_at` | `created_by` | `updated_by` | `deleted_at` | `deleted_by` |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| `students` | ✅ schema | ❌ missing | ❌ not set in route | ❌ missing | ✅ | ✅ |
| `courses` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `assignments` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `assessments` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `announcements` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `notes` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `users` | ✅ | ✅ | ✅ | ✅ | ❌ no soft-delete | ❌ |

`students` is the outlier. The schema is missing `updated_at` and `updated_by` entirely, and even the existing `created_at` is not paired with a `createdBy` value at the route level.

`users` is intentionally deactivated by `isActive` flag rather than soft-delete — acceptable, but should be documented.

---

## Soft Delete Audit

| Resource | List filtering | Detail filtering | Mutation guard | Delete sets `deleted_at` |
|---|:---:|:---:|:---:|:---:|
| Students | ✅ | ✅ (post-fetch null check) | ✅ | ✅ |
| Courses | ✅ | ✅ (query-level) | ✅ | ✅ |
| Assignments | ✅ | ✅ | ✅ | ✅ |
| Assessments | ✅ | ✅ | ✅ | ✅ |
| Announcements | ✅ | ✅ | ✅ | ✅ |
| Notes | ✅ | ✅ | ✅ | ✅ |

Soft delete is consistently enforced across all six resource types. No gaps found.

---

## Data Integrity Findings

### D-01 — `students.enrolledCourseIds` is a deprecated orphan column — Medium

Two enrollment sources coexist:
- `students.enrolled_course_ids` — JSON array, still present in schema, still populated by the student create route
- `course_enrollments` table — the authoritative normalized join table

The session enricher explicitly uses `course_enrollments` and comments the JSON column as deprecated. A migration script (`scripts/src/migrate-course-enrollments.ts`) exists, confirming the intent to retire the column. However, the column is never removed or zeroed during enrollment operations.

Risk: If any future code reads from `students.enrolledCourseIds` instead of `course_enrollments`, it will silently return stale data. The column should be deprecated in the schema (set nullable, default null) and removed after a migration window.

---

### D-02 — `courses.teacherId` vs `users.id` mapping — Resolved

Teacher ownership maps `courses.teacher_id → users.id` directly. The session enricher confirms: `ownedCourseIds` is populated by querying `courses WHERE teacher_id = userId`. The `coursePolicy.validateAccess` Layer 3 check enforces ownership on all mutations. No gap.

---

### D-03 — `students.userId` linkage — Resolved

A unique partial index (`uq_students_user_id` where `userId IS NOT NULL`) prevents duplicate user-student bindings. `ON DELETE SET NULL` avoids orphaning the student record if a user account is deleted. The session enricher correctly resolves `studentId` from `students WHERE user_id = userId`.

---

### D-04 — `student_guardians` — No orphan risk

Both FK columns have `ON DELETE CASCADE`, meaning deleting either the student or the parent user cleans up the guardian link automatically. `createdBy` is required (not null). Clean.

---

## OpenAPI Findings

| Gap | Severity |
|---|---|
| `PATCH /assessments/:id` — missing from spec and implementation | Medium |
| `Student` schema missing `updatedAt`, `updatedBy`, `createdBy` | Medium |
| `/admin/db-status` and `/admin/test-db` — not in spec | Low |
| `/student/courses/:id/workspace` — backend implemented, spec coverage unverified | Low |
| Users — no soft-delete endpoint; `isActive` PATCH is the deactivation mechanism | Low (documented gap) |

The generated client and Zod schemas are stable and consistent with the spec as written. No codegen drift observed. The risk is that undocumented endpoints (`/admin/*`) are callable without a contract, which makes them invisible to future API consumers.

---

## Functional Readiness Matrix

| Module | Status | Notes |
|---|---|---|
| **Authentication** | READY | Login, logout, session, inactive-user 401 all implemented |
| **User Management** | READY WITH OBSERVATIONS | Full backend; zero frontend UI |
| **Student Management** | READY WITH OBSERVATIONS | Backend solid; UI is list+create only; missing Layer 3 IDOR; audit fields incomplete |
| **Teacher Management** | NOT READY | No teacher entity beyond `users.role = 'teacher'`; no teacher profile, no teacher CRUD |
| **Parent Management** | NOT READY | Session enrichment exists; student_guardians schema exists; no API endpoints, no frontend |
| **Course Management** | NOT READY | Backend full CRUD; frontend create is a placeholder button; no edit/archive/delete UI |
| **Enrollment Management** | READY WITH OBSERVATIONS | Backend complete; `students.enrolledCourseIds` deprecated column still present |
| **Assignment Management** | NOT READY | Backend full CRUD; frontend read-only |
| **Assessment Management** | NOT READY | No PATCH on backend or spec; frontend read-only |
| **Announcement Management** | NOT READY | Backend full CRUD; no frontend page exists |
| **Notes Management** | NOT READY | Backend full CRUD; frontend read-only |
| **Student Portal** | NOT READY | Backend fully implemented (6 routers, all guarded); zero frontend pages |
| **Teacher Portal** | NOT READY | Teacher sees read-only UI for their own data |
| **Parent Portal** | NOT READY | Backend enrichment only; no API endpoints, no frontend |
| **Attendance** | NOT READY | Not implemented |
| **Gradebook** | NOT READY | Not implemented |
| **Reporting** | NOT READY | Not implemented |
| **Audit Logging** | READY WITH OBSERVATIONS | Complete on 5/6 tables; students missing `updated_at`/`updated_by`; create route misses `createdBy` |
| **OpenAPI** | READY WITH OBSERVATIONS | Stable; assessment PATCH missing; student schema gaps |
| **RBAC** | READY WITH OBSERVATIONS | `requireRole` active; `user_roles`/`permissions` tables are dead weight |

---

## Launch Readiness Assessment

| Dimension | Verdict | Rationale |
|---|---|---|
| **Security** | FAIL | S-01 (admin routes unguarded, exploitable by any session) and S-02 (student IDOR across teachers) are unacceptable for even a pilot |
| **Architecture** | CONDITIONAL PASS | 3-layer auth is sound; write-bypass-repository pattern creates audit drift but is not a blocker |
| **Operational Readiness** | FAIL | Teachers cannot create courses, assignments, announcements, or notes; student portal has no UI |
| **Maintainability** | CONDITIONAL PASS | Codegen pipeline, Zod contracts, and test coverage (1330 tests) are strong foundations |
| **Scalability** | CONDITIONAL PASS | PostgreSQL + Drizzle + normalized course_enrollments are appropriate; deprecated JSON column should be retired |

---

## Remaining Launch Blockers

| # | Blocker | Security | Business | Effort |
|---|---|---|---|---|
| LB-1 | `admin.ts` no `requireRole` — any user probes DB | Critical | Medium | 1h |
| LB-2 | Settings page exposes `POST /admin/test-db` to all users | Critical | Medium | 2h |
| LB-3 | Student IDOR — teachers access any student across the system | High | High | 1 day |
| LB-4 | Student portal has zero frontend pages | Medium | Critical | 3–4 days |
| LB-5 | Teacher portal is read-only — no CRUD for Courses, Assignments, Notes | Low | Critical | 1 week |
| LB-6 | Announcements has no frontend at all | Low | Critical | 2 days |
| LB-7 | `students` missing `updated_at`/`updated_by` + route not setting `createdBy` | Medium | Medium | 4h |
| LB-8 | `assessments` no PATCH — scores cannot be corrected | Low | High | 1 day |
| LB-9 | `students.enrolledCourseIds` deprecated column not retired | Low | Low | 4h |
| LB-10 | RBAC tables (`user_roles`, `permissions`) dead weight — misleading | Low | Low | 2h (document or drop) |

---

## Recommended Sprint 7 Priorities

Ranked by combined security + business impact vs. implementation effort:

| Rank | Item | Rationale |
|---|---|---|
| 1 | Fix `admin.ts` `requireRole("admin")` + restrict Settings page to admins | 1-hour fix that closes a Critical security gap; should be done immediately |
| 2 | Fix `students.ts` Layer 3 IDOR — add `policy.validateAccess` per student | 1-day fix; closes high-severity cross-teacher data access |
| 3 | Teacher Portal — Course CRUD UI (create dialog, edit form, archive) | Without courses, no content exists for any other module |
| 4 | Teacher Portal — Assignment CRUD UI (create, grade, delete) | Highest day-to-day teacher workflow |
| 5 | Teacher Portal — Announcements page (full CRUD) | Complete gap; backend is done |
| 6 | Teacher Portal — Notes CRUD UI | Backend done; only UI needed |
| 7 | Teacher Portal — Assessment create UI + backend PATCH endpoint | Needs both backend and frontend work |
| 8 | Student Portal — frontend pages (dashboard, courses, assignments, assessments, notes, announcements) | Backend is 100% complete; purely frontend work |
| 9 | Fix `students` audit fields — add `updated_at`/`updated_by` to schema; set `createdBy`/`updatedBy` in route | Schema migration + route fix |
| 10 | Retire `students.enrolledCourseIds` JSON column | Remove deprecated column; already migrated at the data layer |

---

## Final Verdict

**NOT READY FOR PILOT**

The backend authorization architecture is genuinely production-grade. However, two Critical security findings (unguarded database probe endpoints accessible to any authenticated user) and one High finding (student IDOR across teachers) cannot be accepted in a pilot environment. More operationally, the application is unusable by its primary user personas: teachers cannot create any content, and students have no portal to log into.

Items LB-1 and LB-2 are single-engineer, single-day fixes that would resolve the security blockers. Items LB-4 through LB-6 constitute the Teacher Portal sprint. Completing both would move the verdict to **READY FOR PILOT WITH OBSERVATIONS**.
