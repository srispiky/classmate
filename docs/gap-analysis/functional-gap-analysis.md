# Classmate Connect — Functional Gap Analysis

**Date:** June 8 2026
**Baseline:** Sprint 5 complete — Student Portal production-ready
**Suite health:** 1259 / 1259 tests — clean typecheck

---

## Methodology

Every API route file, UI page file, database schema file, and OpenAPI spec path was inspected directly. The implementation matrix below reflects the actual current state of the codebase — not aspirational plans.

---

## Implementation Matrix

### 1. Authentication

| Item | Status |
|---|---|
| POST /auth/login | ✅ Implemented |
| POST /auth/logout | ✅ Implemented |
| GET /auth/me | ✅ Implemented |
| Session-based auth (express-session) | ✅ Implemented |
| `requireAuth` middleware on protected routes | ✅ Implemented |
| Password hashing (bcrypt) | ✅ Implemented |
| Password change endpoint | ❌ Not Implemented |
| Password reset / forgot-password flow | ❌ Not Implemented |
| Admin-driven user registration | ❌ Not Implemented |
| Session expiry / idle timeout handling | ❌ Not Implemented |
| MFA | ❌ Not Implemented |
| OAuth / SSO | ❌ Not Implemented |

**Existing endpoints:** `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`

**Security gaps:**
- No password change endpoint. Users cannot rotate credentials without database intervention.
- No account lockout on repeated failed login attempts.
- Session enrichment (linking session to studentId/teacherId) runs synchronously on login. If enrichment fails silently, the session may carry a null studentId without the user being notified.

**Production readiness:** Partial. Sufficient for a closed environment (admin-managed accounts), insufficient for self-service production.

---

### 2. User Management

| Item | Status |
|---|---|
| `users` table (id, username, passwordHash, displayName, role, isActive) | ✅ Implemented |
| Role constraint: admin / teacher / student / parent / guest | ✅ Implemented |
| GET /users | ❌ Not Implemented |
| POST /users (create account) | ❌ Not Implemented |
| PATCH /users/:id (update profile, reset password) | ❌ Not Implemented |
| DELETE /users/:id (deactivate) | ❌ Not Implemented |
| UI: User management page | ❌ Not Implemented |
| Admin panel for account creation | ❌ Not Implemented |

**Existing endpoints:** None. User accounts currently exist only via database seed/direct insertion.

**Missing CRUD:** Full CRUD missing. Users cannot be created or managed through the application.

**Missing workflows:**
- Onboarding: creating a teacher account and linking it to a `courses.teacherId`
- Student account creation and linking to `students.userId`
- Account deactivation (`isActive = false`)
- Role assignment

**Security gaps:** No API surface to manage users means no audit trail for account changes.

**Production readiness:** ❌ Blocked. Users cannot be onboarded without direct database access.

---

### 3. Student Management

| Item | Status |
|---|---|
| `students` table (name, email, grade, avatarUrl, enrolledCourseIds JSON, userId FK) | ✅ Implemented |
| GET /students | ✅ Implemented |
| POST /students | ✅ Implemented |
| GET /students/:id | ✅ Implemented |
| PATCH /students/:id | ✅ Implemented |
| GET /students/:id/progress | ✅ Implemented |
| GET /students/:id/ai-suggestions | ✅ Implemented |
| DELETE /students/:id | ❌ Not Implemented |
| Soft-delete on students table (`deleted_at`) | ❌ Not Implemented |
| `requireRole` on student CRUD endpoints | ❌ Not Implemented — **Security Gap** |
| Student ↔ User account linking API | ❌ Not Implemented |
| Student profile photo upload | ❌ Not Implemented |
| UI: Student list | ✅ Implemented |
| UI: Student detail | ✅ Implemented |
| UI: Student AI suggestions | ✅ Implemented |
| UI: Create / edit student form | ⚠️ Partially Implemented |

**Security gaps:**
- `/students` CRUD has **no `requireRole` check**. Any authenticated user — including students, parents, and guests — can create, read, and update student records. This is a high-severity security gap.
- `students.enrolledCourseIds` is a JSON column that exists alongside `course_enrollments` (the normalised junction table). These can diverge. The student portal reads from the session-derived scope (populated from `course_enrollments`), but the teacher-side API populates `enrolledCourseIds` JSON. **Dual source-of-truth is a data integrity risk.**

**Production readiness:** ⚠️ Partial. Functional but requires role enforcement and soft-delete before production.

---

### 4. Teacher Management

| Item | Status |
|---|---|
| Teachers as users with `role = 'teacher'` | ✅ Implemented (schema only) |
| `courses.teacherId` FK to users | ✅ Implemented |
| GET /teachers | ❌ Not Implemented |
| POST /teachers | ❌ Not Implemented |
| PATCH /teachers/:id | ❌ Not Implemented |
| Teacher profile page | ❌ Not Implemented |
| Teacher ↔ Course assignment | ⚠️ Partially Implemented (via course creation) |
| Teacher-owned resource validation | ⚠️ Partially Implemented (courses only) |

**Existing endpoints:** None dedicated. Teachers are just users with the teacher role.

**Missing workflows:**
- Teacher directory / lookup
- Teacher assignment to courses
- Teacher profile management
- Teacher workload view

**Production readiness:** ❌ Not started. Teacher identity exists in the data model but is not surfaced through any management interface.

---

### 5. Parent Management

| Item | Status |
|---|---|
| `student_guardians` table (studentId, userId, relationship) | ✅ Implemented |
| `parent` role in users.role constraint | ✅ Implemented |
| GET /parents | ❌ Not Implemented |
| POST /parents | ❌ Not Implemented |
| Guardian ↔ Student linking API | ❌ Not Implemented |
| Parent portal (any route) | ❌ Not Implemented |
| Parent-scoped data access | ❌ Not Implemented |

**Existing endpoints:** None.

**Production readiness:** ❌ Not started. Schema exists; no implementation.

---

### 6. Course Management

| Item | Status |
|---|---|
| `courses` table (full schema with soft-delete + audit fields) | ✅ Implemented |
| GET /courses | ✅ Implemented |
| GET /courses/:id | ✅ Implemented |
| POST /courses | ✅ Implemented (`requireRole("admin","teacher")`) |
| PUT /courses/:id | ✅ Implemented (`requireRole("admin","teacher")`) |
| DELETE /courses/:id (soft-delete) | ✅ Implemented (`requireRole("admin","teacher")`) |
| GET /courses/:courseId/students (enrolled list) | ❌ Not Implemented |
| Course archiving workflow | ⚠️ Partially Implemented (status field only) |
| Teacher ownership validation (only owner can edit) | ❌ Not Implemented |
| UI: Course list | ✅ Implemented |
| UI: Course detail | ✅ Implemented |
| UI: Create / edit course form | ⚠️ Partially Implemented |

**Security gaps:**
- Any teacher can update or delete any other teacher's course. `requireRole("teacher")` is enforced but teacher-to-course ownership is not.

**Production readiness:** ⚠️ Mostly ready. Needs ownership enforcement and enrolled-students endpoint.

---

### 7. Enrollment Management

| Item | Status |
|---|---|
| `course_enrollments` table (full normalised schema, indexed) | ✅ Implemented |
| POST /courses/:courseId/enrollments | ✅ Implemented |
| DELETE /courses/:courseId/enrollments/:studentId | ✅ Implemented |
| GET /courses/:courseId/enrollments | ❌ Not Implemented |
| Bulk enrollment | ❌ Not Implemented |
| Enrollment sync with `students.enrolledCourseIds` JSON | ⚠️ Partially Implemented — **Data integrity risk** |
| Enrollment history / audit | ❌ Not Implemented |

**Missing workflows:**
- List currently enrolled students for a course
- Bulk import from CSV
- Enrollment transfer

**Data integrity risk:** `students.enrolledCourseIds` (JSON column) and `course_enrollments` (normalised table) are updated by different code paths and can diverge. The student portal reads from the normalised `course_enrollments` table (via session enrichment). The teacher-facing progress endpoint reads from `assignmentsTable.studentId` directly. The divergence is invisible at runtime but becomes a problem when querying one source vs. the other.

**Production readiness:** ⚠️ Partial. Core add/remove is functional; list and sync are missing.

---

### 8. Assignment Management

| Item | Status |
|---|---|
| `assignments` table (full schema with soft-delete + audit fields) | ✅ Implemented |
| GET /assignments | ✅ Implemented |
| POST /assignments | ✅ Implemented |
| GET /assignments/:id | ✅ Implemented |
| PATCH /assignments/:id | ✅ Implemented |
| DELETE /assignments/:id | ❌ Not Implemented |
| Soft-delete enforcement on GET /assignments | ❌ Not Implemented — **Bug** |
| `requireRole` on all assignment endpoints | ❌ Not Implemented — **Security Gap** |
| Assignment templates / batch creation | ❌ Not Implemented |
| Grade submission workflow | ⚠️ Partially Implemented (PATCH sets score/status) |
| UI: Assignment list | ✅ Implemented |
| UI: Assignment detail / grade form | ⚠️ Partially Implemented |
| Student Portal: assignment read-only | ✅ Implemented (Sprint 5) |

**Security gaps:**
- No `requireRole` on any assignment endpoint. Authenticated students can `POST /assignments` (create assignments for any student ID) and `PATCH /assignments/:id` (self-grade their own assignments).
- `GET /assignments` does not filter by `deleted_at IS NULL` in the teacher-facing route — soft-deleted assignments may appear to teachers. (The student portal correctly filters; the teacher route does not.)

**Production readiness:** ❌ Blocked by security gap and missing soft-delete filter.

---

### 9. Assessment Management

| Item | Status |
|---|---|
| `assessments` table (full schema with soft-delete + audit fields) | ✅ Implemented |
| GET /assessments | ✅ Implemented |
| POST /assessments | ✅ Implemented |
| GET /assessments/:id | ✅ Implemented |
| GET /assessments/:id/ai-suggestions | ✅ Implemented |
| GET /students/:id/ai-suggestions | ✅ Implemented |
| PATCH /assessments/:id | ❌ Not Implemented |
| DELETE /assessments/:id | ❌ Not Implemented |
| `requireRole` on assessment endpoints | ❌ Not Implemented — **Security Gap** |
| AI suggestion generation (OpenAI / Anthropic) | ✅ Implemented |
| UI: Assessment list | ✅ Implemented |
| UI: Create assessment form | ⚠️ Partially Implemented |
| Student Portal: assessment read-only | ✅ Implemented (Sprint 5) |

**Security gaps:**
- No `requireRole` — any authenticated user can create assessments for any student.
- No soft-delete filter on `GET /assessments`.

**Production readiness:** ❌ Blocked by security gap and missing UPDATE/DELETE.

---

### 10. Announcement Management

| Item | Status |
|---|---|
| `announcements` table (full schema with soft-delete + audit) | ✅ Implemented |
| GET /announcements | ✅ Implemented |
| POST /announcements | ✅ Implemented |
| GET /announcements/:id | ✅ Implemented |
| PATCH /announcements/:id | ✅ Implemented |
| DELETE /announcements/:id | ❌ Not Implemented |
| `requireRole` on announcement endpoints | ❌ Not Implemented — **Security Gap** |
| Announcement priority levels | ✅ Implemented (schema field) |
| Soft-delete filter on GET /announcements (teacher side) | ❌ Not verified — needs audit |
| UI: Announcement management | ❌ Not Implemented (no dedicated UI page) |
| Student Portal: announcement read-only | ✅ Implemented (Sprint 5) |

**Security gaps:** Any authenticated user can post or edit announcements.

**Production readiness:** ❌ Blocked by security gap and missing DELETE.

---

### 11. Notes Management

| Item | Status |
|---|---|
| `notes` table (full schema with soft-delete + audit) | ✅ Implemented |
| GET /notes | ✅ Implemented |
| POST /notes | ✅ Implemented |
| GET /notes/:id | ✅ Implemented |
| PATCH /notes/:id | ✅ Implemented |
| DELETE /notes/:id | ❌ Not Implemented |
| `requireRole` on note endpoints | ❌ Not Implemented — **Security Gap** |
| Video URL support | ✅ Implemented (schema field `video_url`) |
| UI: Notes list | ✅ Implemented |
| UI: Note detail | ✅ Implemented |
| UI: Create / edit note form | ⚠️ Partially Implemented |
| Student Portal: notes read-only | ✅ Implemented (Sprint 5) |

**Production readiness:** ❌ Blocked by security gap and missing DELETE.

---

### 12. Student Portal

| Item | Status |
|---|---|
| GET /student/dashboard | ✅ Implemented |
| GET /student/courses | ✅ Implemented |
| GET /student/courses/:id | ✅ Implemented |
| GET /student/courses/:id/workspace | ✅ Implemented |
| GET /student/assignments | ✅ Implemented |
| GET /student/assignments/:id | ✅ Implemented |
| GET /student/assessments | ✅ Implemented |
| GET /student/assessments/:id | ✅ Implemented |
| GET /student/announcements | ✅ Implemented |
| GET /student/announcements/:id | ✅ Implemented |
| GET /student/notes | ✅ Implemented |
| GET /student/notes/:id | ✅ Implemented |
| Student UI (dedicated portal / login experience) | ❌ Not Implemented |
| Student assignment submission | ❌ Not Implemented |

**Production readiness:** ✅ API complete and production-ready (Sprint 5). UI portal not started.

---

### 13. Teacher Portal

| Item | Status |
|---|---|
| Teacher-specific API routes (/teacher/*) | ❌ Not Implemented |
| Role-gated UI pages | ❌ Not Implemented |
| Teacher dashboard (exists as generic /dashboard) | ⚠️ Partially Implemented |
| Teacher-owned course list | ❌ Not Implemented |
| Teacher-only assignment/assessment views | ❌ Not Implemented |
| Grade book view | ❌ Not Implemented |

**Current state:** The classmate UI serves teachers but shows all data to all authenticated users. There is no role-based routing in the UI — a student account logging into the classmate app sees the same pages as a teacher.

**Production readiness:** ❌ Not started as a distinct portal. UI needs role-gating.

---

### 14. Parent Portal

| Item | Status |
|---|---|
| Parent portal API routes (/parent/*) | ❌ Not Implemented |
| Parent-scoped child progress view | ❌ Not Implemented |
| Parent-scoped announcement view | ❌ Not Implemented |
| Guardian management endpoints | ❌ Not Implemented |
| Parent UI | ❌ Not Implemented |

**Production readiness:** ❌ Not started.

---

### 15. Attendance

| Item | Status |
|---|---|
| Attendance table | ❌ Not Implemented |
| Attendance API endpoints | ❌ Not Implemented |
| Attendance UI | ❌ Not Implemented |
| Attendance reporting | ❌ Not Implemented |

**Production readiness:** ❌ Not started. No schema, no code.

---

### 16. Gradebook

| Item | Status |
|---|---|
| Dedicated `gradebook` table | ❌ Not Implemented |
| GET /gradebook (aggregated view) | ❌ Not Implemented |
| Grade calculation / averaging | ⚠️ Partially Implemented (in GET /students/:id/progress) |
| Gradebook export (CSV / PDF) | ❌ Not Implemented |
| Grade categories / weights | ❌ Not Implemented |
| UI: Gradebook view | ❌ Not Implemented |

**Current state:** Grades exist in `assignments.score`/`maxScore` and `assessments.score`/`maxScore`. A basic average is computed in `GET /students/:id/progress`. No aggregated gradebook surface exists.

**Production readiness:** ❌ Not started.

---

### 17. Reporting

| Item | Status |
|---|---|
| GET /dashboard/summary | ✅ Implemented (basic class-wide stats) |
| GET /dashboard/grade-breakdown | ✅ Implemented |
| GET /dashboard/recent-activity | ✅ Implemented |
| GET /students/:id/progress | ✅ Implemented |
| Student progress report | ⚠️ Partially Implemented |
| Course performance report | ❌ Not Implemented |
| Class-wide grade report | ❌ Not Implemented |
| Report export (CSV / PDF / Excel) | ❌ Not Implemented |
| Scheduled / email reports | ❌ Not Implemented |
| UI: Reports section | ❌ Not Implemented |

**Production readiness:** ❌ Minimal. Basic aggregations exist; no formal reporting feature.

---

### 18. Audit Logging

| Item | Status |
|---|---|
| `activity` table (type, description, studentName, courseName, timestamp) | ✅ Implemented |
| GET /dashboard/recent-activity | ✅ Implemented (reads from activity table) |
| `created_by` / `updated_by` / `deleted_by` on courses | ✅ Implemented |
| `created_by` / `updated_by` / `deleted_by` on announcements | ✅ Implemented |
| `created_by` / `updated_by` / `deleted_by` on assignments | ✅ Implemented |
| `created_by` / `updated_by` / `deleted_by` on assessments | ✅ Implemented |
| `created_by` / `updated_by` / `deleted_by` on notes | ✅ Implemented |
| `created_by` / `updated_by` on students | ❌ Not Implemented (AB-002 carry) |
| Write-through audit: API actually populates `created_by` | ❌ Not Implemented — **Gap** |
| Audit log API endpoint | ❌ Not Implemented |
| Audit log UI | ❌ Not Implemented |

**Critical gap:** The audit columns exist in the schema but **the API routes do not populate them**. `created_by` is never set when creating assignments, assessments, etc. — the columns always remain null. The schema is correct; the application layer is not writing the values.

**Production readiness:** ❌ Schema exists but audit writes are not wired.

---

### 19. OpenAPI

| Item | Status |
|---|---|
| All teacher-facing endpoints documented | ✅ Implemented |
| All student portal endpoints documented | ✅ Implemented |
| Dashboard endpoints documented | ✅ Implemented |
| Enrollment endpoints documented | ✅ Implemented |
| Zod validators generated (Orval) | ✅ Implemented |
| React Query hooks generated (Orval) | ✅ Implemented |
| Barrel guard (no naming conflicts) | ✅ Implemented |
| Security scheme definition | ❌ Not Implemented (AB-001) |
| User management endpoints | ❌ Not Implemented (no endpoints exist) |
| Teacher management endpoints | ❌ Not Implemented |
| Parent portal endpoints | ❌ Not Implemented |
| Attendance endpoints | ❌ Not Implemented |
| Gradebook endpoints | ❌ Not Implemented |

**Production readiness:** ✅ Synchronized with all currently implemented endpoints. Will require updates as new modules are added.

---

### 20. RBAC

| Item | Status |
|---|---|
| `roles` table | ✅ Implemented |
| `permissions` table | ✅ Implemented |
| `role_permissions` table | ✅ Implemented |
| `user_roles` table | ✅ Implemented |
| `rbac_version` table | ✅ Implemented |
| Inline role check on `users.role` column | ✅ Implemented |
| `requireRole` middleware | ✅ Implemented |
| `requireRole` applied to courses CRUD | ✅ Implemented |
| `requireRole` applied to enrollments | ✅ Implemented |
| `requireRole` applied to student portal | ✅ Implemented (Sprint 5) |
| `requireRole` applied to students CRUD | ❌ Not Implemented — **Security Gap** |
| `requireRole` applied to assignments CRUD | ❌ Not Implemented — **Security Gap** |
| `requireRole` applied to assessments CRUD | ❌ Not Implemented — **Security Gap** |
| `requireRole` applied to announcements CRUD | ❌ Not Implemented — **Security Gap** |
| `requireRole` applied to notes CRUD | ❌ Not Implemented — **Security Gap** |
| `requireRole` applied to dashboard | ❌ Not Implemented |
| Policy-based permission queries (using `role_permissions` table) | ❌ Not Implemented |
| API for managing roles / permissions | ❌ Not Implemented |
| Permission seeding | ❌ Not Implemented |

**Critical gap:** The RBAC database schema is complete and well-designed, but the `role_permissions` and `user_roles` tables are **never queried by the application**. The schema represents future capability; the only enforced mechanism is the `requireRole` middleware checking `req.session.role`. The permission-level RBAC is entirely inert.

**Immediate security risk:** Five high-traffic resource routes (students, assignments, assessments, announcements, notes) have no role restriction. Any authenticated user of any role can perform CRUD operations on these resources.

**Production readiness:** ❌ Partial enforcement. Requires `requireRole` on 5 route groups before production.

---

## Consolidated Security Risk Register

| ID | Route Group | Gap | Severity | Impact |
|---|---|---|---|---|
| SEC-001 | `/students`, `/students/:id` | No `requireRole` — student/parent can edit student records | High | Data integrity |
| SEC-002 | `/assignments`, `/assignments/:id` | No `requireRole` — students can create/grade own assignments | Critical | Grade fraud |
| SEC-003 | `/assessments` | No `requireRole` — students can create assessments for themselves | Critical | Score fraud |
| SEC-004 | `/announcements`, `/announcements/:id` | No `requireRole` — any user can post announcements | High | Content integrity |
| SEC-005 | `/notes`, `/notes/:id` | No `requireRole` — any user can create/modify lesson notes | High | Content integrity |
| SEC-006 | Course ownership | Any teacher can edit/delete any other teacher's course | Medium | Data integrity |
| SEC-007 | Audit columns | `created_by`/`updated_by` never populated by API | Medium | Compliance |
| SEC-008 | Students dual source | `students.enrolledCourseIds` JSON can diverge from `course_enrollments` | Medium | Data integrity |
| SEC-009 | Teacher-facing GET /assignments | No `deleted_at IS NULL` filter — soft-deleted rows may appear | Low | Data quality |
| SEC-010 | Dashboard routes | No `requireRole` — any authenticated role sees class-wide stats | Low | Information disclosure |

---

## Production Readiness by Module

| Module | API | UI | DB | Security | Ready |
|---|---|---|---|---|---|
| Authentication | ⚠️ | ✅ | ✅ | ⚠️ | **PARTIAL** |
| User Management | ❌ | ❌ | ✅ | — | **BLOCKED** |
| Student Management | ✅ | ✅ | ⚠️ | ❌ | **BLOCKED** |
| Teacher Management | ❌ | ❌ | ⚠️ | — | **NOT STARTED** |
| Parent Management | ❌ | ❌ | ✅ | — | **NOT STARTED** |
| Course Management | ✅ | ✅ | ✅ | ⚠️ | **PARTIAL** |
| Enrollment Management | ⚠️ | ✅ | ✅ | ✅ | **PARTIAL** |
| Assignment Management | ⚠️ | ⚠️ | ✅ | ❌ | **BLOCKED** |
| Assessment Management | ⚠️ | ⚠️ | ✅ | ❌ | **BLOCKED** |
| Announcement Management | ⚠️ | ❌ | ✅ | ❌ | **BLOCKED** |
| Notes Management | ⚠️ | ✅ | ✅ | ❌ | **BLOCKED** |
| Student Portal (API) | ✅ | — | ✅ | ✅ | **READY** |
| Student Portal (UI) | ✅ | ❌ | ✅ | ✅ | **PARTIAL** |
| Teacher Portal | ❌ | ❌ | — | — | **NOT STARTED** |
| Parent Portal | ❌ | ❌ | ✅ | — | **NOT STARTED** |
| Attendance | ❌ | ❌ | ❌ | — | **NOT STARTED** |
| Gradebook | ❌ | ❌ | ❌ | — | **NOT STARTED** |
| Reporting | ⚠️ | ❌ | — | — | **PARTIAL** |
| Audit Logging | ⚠️ | ❌ | ✅ | — | **PARTIAL** |
| OpenAPI | ✅ | — | — | ⚠️ | **PARTIAL** |
| RBAC | ⚠️ | ❌ | ✅ | ❌ | **BLOCKED** |

---

## Roadmap

---

### Phase 1 — Must-Have for Production Launch

*These items block a safe, functional production deployment. None of the listed security gaps should reach production.*

#### 1.1 Security Hardening (Sprint 6 — Week 1)

**Effort: S — 1-2 days**

Add `requireRole("admin", "teacher")` to the five unprotected route groups:

```
/students, /students/:id           → requireRole("admin", "teacher")
/assignments, /assignments/:id     → requireRole("admin", "teacher")
/assessments, /assessments/:id     → requireRole("admin", "teacher")
/announcements, /announcements/:id → requireRole("admin", "teacher")
/notes, /notes/:id                 → requireRole("admin", "teacher")
/dashboard/*                       → requireRole("admin", "teacher")
```

Add teacher-ownership validation to course update/delete (a teacher may only modify courses they own).

Fix `GET /assignments` to filter `deleted_at IS NULL`.

Populate `created_by` / `updated_by` from `req.session.userId` in all POST/PATCH handlers.

---

#### 1.2 Database Index Coverage (Sprint 6 — Week 1)

**Effort: XS — 1 migration**

```sql
CREATE INDEX ix_assignments_student_id  ON assignments (student_id)  WHERE deleted_at IS NULL;
CREATE INDEX ix_assignments_course_id   ON assignments (course_id)   WHERE deleted_at IS NULL;
CREATE INDEX ix_assessments_student_id  ON assessments (student_id)  WHERE deleted_at IS NULL;
CREATE INDEX ix_assessments_course_id   ON assessments (course_id)   WHERE deleted_at IS NULL;
CREATE INDEX ix_notes_course_id         ON notes (course_id)         WHERE deleted_at IS NULL;
CREATE INDEX ix_announcements_course_id ON announcements (course_id) WHERE deleted_at IS NULL;
```

---

#### 1.3 DELETE Endpoints for All Resources (Sprint 6 — Week 1-2)

**Effort: S**

Add soft-delete `DELETE` endpoints:

```
DELETE /assignments/:id
DELETE /assessments/:id
DELETE /announcements/:id
DELETE /notes/:id
DELETE /students/:id
```

Pattern: `SET deleted_at = NOW(), deleted_by = $userId WHERE id = $id RETURNING`.

---

#### 1.4 User Management API (Sprint 6 — Week 2)

**Effort: M**

Minimum viable user management for a closed-environment launch:

```
GET    /users              — list all users (admin only)
POST   /users              — create user account (admin only)
PATCH  /users/:id          — update display name, role, isActive (admin only)
POST   /users/:id/reset-password  — admin-driven password reset
```

OpenAPI documentation + codegen after each endpoint.

---

#### 1.5 Enrollment Sync Resolution (Sprint 6 — Week 2)

**Effort: S**

Remove `students.enrolledCourseIds` JSON column as the authoritative enrollment source. The `course_enrollments` table is the source of truth. SessionEnricher already reads from `course_enrollments` — the JSON column is now redundant and risky.

Options:
1. Deprecate the JSON column; keep it but stop writing to it; migrate reads to `course_enrollments`.
2. Remove the JSON column and the DB column (requires migration).

Recommended: Option 2 in a two-step migration (nullable → remove).

---

#### 1.6 GET /courses/:courseId/enrollments (Sprint 6 — Week 2)

**Effort: XS**

```
GET /courses/:courseId/enrollments → [{studentId, name, email, enrolledAt}]
```

Required by any teacher UI that shows which students are in a course.

---

### Phase 2 — Important, Can Wait

*These items are needed for a fully featured product but do not block a safe initial launch.*

#### 2.1 Student Portal UI (Sprint 6)

The student portal API is complete (Sprint 5). Build the React frontend for students:

- Dedicated login with role-based redirect (student → student UI; teacher → teacher UI)
- Student dashboard page
- Student course list / detail / workspace
- Student assignment list / detail
- Student assessment list / detail
- Student announcement / notes views

#### 2.2 Teacher Portal Role-Gating (Sprint 6)

Add role-based routing to the existing classmate UI:

- After login, redirect by role: `student → /student`, `teacher → /`, `admin → /admin`
- Protect teacher-only pages with a `<RequireRole role="teacher">` wrapper
- Students landing on teacher pages should be redirected

#### 2.3 PATCH /assessments/:id (Sprint 6)

Assessment update is missing. Assessments can only be created — not corrected after creation.

#### 2.4 Parent Portal MVP (Sprint 7)

Minimum parent-facing API:

```
GET /parent/children              — list linked students (via student_guardians)
GET /parent/children/:id/progress — student progress summary
GET /parent/children/:id/assignments
GET /parent/children/:id/assessments
GET /parent/children/:id/announcements
```

Guardian management:
```
POST   /guardians            — link parent user to student (admin/teacher)
DELETE /guardians/:id        — unlink guardian
```

#### 2.5 Teacher Management (Sprint 7)

```
GET  /teachers               — list all teacher users
GET  /teachers/:id/courses   — teacher's assigned courses
```

#### 2.6 Audit Log Writes (Sprint 6-7)

Wire `created_by` / `updated_by` / `deleted_by` population into every POST/PATCH/DELETE handler. This is a cross-cutting concern — easiest to implement as a middleware or service helper.

#### 2.7 Gradebook (Sprint 7)

```
GET /gradebook?courseId=&studentId=   — aggregated grades per student per course
GET /gradebook/course/:id             — course-wide grade summary
```

No new table needed — aggregates from `assignments` and `assessments`.

#### 2.8 Reporting Exports (Sprint 7)

```
GET /reports/student/:id/progress.csv
GET /reports/course/:id/grades.csv
```

Use the existing dashboard aggregation logic as the data source.

#### 2.9 Assignment Submission Flow (Sprint 7)

Allow students to submit assignments (currently read-only in the student portal):

```
PATCH /student/assignments/:id/submit  → sets status = "submitted"
```

Requires role guard: only the owning student can submit their own assignment.

#### 2.10 Announcement Management UI (Sprint 6)

No UI page exists for creating or managing announcements. Add:
- Announcement list page (teacher view)
- Create/edit announcement form
- Announcement detail with course targeting

---

### Phase 3 — Future Enhancements

*Valuable features that extend the platform beyond its current educational scope.*

#### 3.1 Attendance Module

Full attendance system:
- `attendance` table: `(studentId, courseId, date, status: present|absent|late|excused, notes)`
- `POST /attendance` — record attendance
- `GET /attendance?courseId=&date=` — view daily attendance
- `GET /students/:id/attendance` — student attendance history
- Attendance reporting and trend analysis

#### 3.2 Full Permission-Based RBAC

Activate the existing `role_permissions` / `user_roles` tables:
- Seed permission records (e.g. `assignments:create`, `grades:view`, `students:manage`)
- Build `checkPermission(userId, permission)` helper using `role_permissions`
- Replace coarse `requireRole` with fine-grained `requirePermission` middleware
- Build API for admin management of roles and permission assignments

#### 3.3 Notifications / Messaging

- In-app notification system for new announcements, grades, assignment due dates
- Email digest for parents
- Push notifications (mobile)

#### 3.4 Bulk Operations

- Bulk student import from CSV
- Bulk enrollment from CSV
- Bulk grade import (spreadsheet upload)

#### 3.5 Calendar Integration

- Assignment due dates surfaced on a calendar view
- Assessment scheduling
- iCal export

#### 3.6 Video / Content Delivery

- Notes already support `video_url`
- Build a proper video library with upload, storage, and streaming
- Lesson recording integration

#### 3.7 Mobile App (Expo / React Native)

- Student mobile app consuming the student portal API (already complete)
- Parent mobile app consuming the parent portal API (Phase 2)
- Push notification support via RevenueCat or native

#### 3.8 Multi-Tenant / School Management

- School / institution table
- Multi-school data isolation
- School admin role
- Per-school branding

---

## Summary Table

| Phase | Module | Effort | Sprint |
|---|---|---|---|
| **1** | Security hardening (5 route groups + ownership) | S | 6 |
| **1** | DB indexes (6 partial indexes) | XS | 6 |
| **1** | DELETE endpoints (5 resources) | S | 6 |
| **1** | User management API (CRUD) | M | 6 |
| **1** | Enrollment sync resolution | S | 6 |
| **1** | GET /courses/:id/enrollments | XS | 6 |
| **2** | Student Portal UI | L | 6 |
| **2** | Teacher Portal role-gating | M | 6 |
| **2** | PATCH /assessments/:id | XS | 6 |
| **2** | Parent Portal MVP | L | 7 |
| **2** | Teacher management | S | 7 |
| **2** | Audit log writes | S | 6-7 |
| **2** | Gradebook aggregation | M | 7 |
| **2** | Reporting exports | S | 7 |
| **2** | Assignment submission flow | S | 7 |
| **2** | Announcement management UI | S | 6 |
| **3** | Attendance module | L | 8+ |
| **3** | Full permission-based RBAC | L | 8+ |
| **3** | Notifications / messaging | L | 8+ |
| **3** | Bulk operations | M | 8+ |
| **3** | Calendar integration | M | 8+ |
| **3** | Video / content delivery | L | 8+ |
| **3** | Mobile app | XL | 9+ |
| **3** | Multi-tenant / school management | XL | Future |
