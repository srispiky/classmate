# Classmate Connect — API Authorization & Navigation Design

> **Source of truth:** Architecture v1.0 · RBAC Design v1.0  
> **Version:** 1.0  
> **Date:** June 2026  
> **Platform:** Express 5 + TypeScript + PostgreSQL  
> **Scope:** Implementation design only. No code.

---

## Table of Contents

1. [Roles Reference](#1-roles-reference)
2. [Session Payload Design](#2-session-payload-design)
3. [Middleware Stack Design](#3-middleware-stack-design)
4. [API Endpoint Inventory](#4-api-endpoint-inventory)
5. [Route Authorization Matrix](#5-route-authorization-matrix)
6. [Row-Level Access Rules](#6-row-level-access-rules)
7. [Frontend Navigation Matrix by Role](#7-frontend-navigation-matrix-by-role)
8. [Guest Access Model](#8-guest-access-model)
9. [Error Response Conventions](#9-error-response-conventions)

---

## 1. Roles Reference

| Role | `name` | Login Required | Description |
|---|---|:---:|---|
| Administrator | `admin` | Yes | Full system access. User management, all academic content, system ops. |
| Teacher | `teacher` | Yes | Class-level access. Students, assignments, assessments, notes, reports. |
| Student | `student` | Yes | Self-service portal. Own subjects, assignments, assessments only. |
| Parent / Guardian | `parent` | Yes | Scoped read-only. Own children's records only. |
| Guest | `guest` | No | Unauthenticated or token-limited. Public course catalogue only. |

> **Guest** is the only unauthenticated role. It does not require a session. All other roles require a valid session cookie.

---

## 2. Session Payload Design

### 2a. Base Session (all authenticated roles)

The `express-session` payload stored in the `session` PostgreSQL table.

```
Session (req.session)
─────────────────────────────────────────────────────────────────────
Field              Type        Source              Notes
─────────────────────────────────────────────────────────────────────
userId             number      users.id            Primary user identifier
username           string      users.username      Used in logs
displayName        string      users.display_name  Used in UI header
role               string      users.role          Primary role shortcut
                                                   Matches: admin | teacher |
                                                   student | parent
permissions        string[]    DERIVED             Resolved from user_roles +
                                                   role_permissions at login.
                                                   Cached in session to avoid
                                                   DB round-trip per request.
                                                   Example:
                                                   ['students:read',
                                                    'courses:read',
                                                    'reports:view']
─────────────────────────────────────────────────────────────────────
```

### 2b. Role-Specific Session Extensions

Fields appended to the session at login, conditionally by role:

#### Student

```
─────────────────────────────────────────────────────────────────────
Field              Type        Source              Notes
─────────────────────────────────────────────────────────────────────
studentId          number      students.id         FK link: students.user_id =
                                                   users.id. NULL if the user
                                                   account exists but has not
                                                   been linked to a student
                                                   record yet.
enrolledCourseIds  number[]    students.enrolled   Cached for fast scope checks.
                               _course_ids         Re-loaded on each login.
─────────────────────────────────────────────────────────────────────
```

#### Parent

```
─────────────────────────────────────────────────────────────────────
Field              Type        Source              Notes
─────────────────────────────────────────────────────────────────────
childStudentIds    number[]    student_guardians   All student_id values where
                               WHERE user_id =     user_id = this parent's
                               session.userId      userId. Loaded at login.
                                                   Re-loaded on next login if
                                                   a guardian link is added.
─────────────────────────────────────────────────────────────────────
```

#### Admin / Teacher

No role-specific extensions. All rows are accessible (global scope).

### 2c. Session Lifecycle

| Event | Action |
|---|---|
| Login (`POST /api/auth/login`) | Resolve permissions from `user_roles` + `role_permissions`. Load role-specific fields (studentId, childStudentIds). Store full payload in session. |
| Request | Read `req.session`. No DB query needed for auth/permission checks. |
| Guardian link added (admin action) | Does NOT auto-update the parent's active session. Parent must re-login to pick up the new `childStudentIds`. |
| Student roster link added (admin action) | Same — student must re-login to pick up `studentId`. |
| Logout / session expiry (8h TTL) | Session row deleted from `session` table. |
| User deactivated (`is_active = false`) | `requireAuth` middleware checks `is_active` at request time by comparing against a short-lived in-memory flag OR by re-querying `users` table once per session. Deactivated users receive 401. |

### 2d. `GET /api/auth/me` Response

The payload returned to the frontend (subset of session, safe to expose):

```
{
  id:               number        — users.id
  username:         string
  displayName:      string
  role:             string        — primary role
  permissions:      string[]      — full resolved permission list
  studentId?:       number        — only if role = 'student'
  childStudentIds?: number[]      — only if role = 'parent'
}
```

---

## 3. Middleware Stack Design

### 3a. Middleware Execution Order (per request)

```
Incoming Request
       │
       ▼
[1] pinoHttp         — request logging (all routes)
       │
       ▼
[2] cors             — CORS headers (all routes)
       │
       ▼
[3] express.json     — body parsing (all routes)
       │
       ▼
[4] session()        — session cookie restore (all routes)
       │
       ▼
[5] Router
       │
       ├─── Public routes (no auth required)
       │         /api/healthz
       │         /api/auth/login
       │         /api/auth/logout
       │         /api/downloads/upgrade
       │         /api/public/courses           ← NEW (guest access)
       │
       ├─── [6] requireAuth                    ← checks session.userId + is_active
       │         │
       │         ├─── [7] requirePermission()  ← checks session.permissions[]
       │         │         │
       │         │         └─── Route handler
       │         │
       │         └─── (some routes: requireAuth only, no role check)
       │
       └─── 404 handler
```

### 3b. Middleware Definitions (design, not code)

#### `requireAuth`

**Purpose:** Confirm a valid, active session exists.  
**Checks:**
1. `req.session.userId` is set → else 401
2. (Recommended) `users.is_active = true` for that userId → else 401  

**Passes to next:** Unchanged request. Downstream middleware reads `req.session`.

---

#### `requirePermission(permissionKey: string)`

**Purpose:** Confirm the authenticated user holds a specific permission.  
**Checks:**
1. `req.session.permissions.includes(permissionKey)` → else 403  

**Usage pattern:** Applied per route after `requireAuth`.  
Multiple permissions on one route: apply multiple `requirePermission` calls OR accept any of N keys.

---

#### `requireRole(...roles: string[])`

**Purpose:** Shorthand for role-based checks where a full permission check is not needed.  
**Checks:**
1. `roles.includes(req.session.role)` → else 403  

**Usage pattern:** Applied to admin-only routes (e.g., system admin endpoints).

---

#### `requireOwnership(resolveId: (req) => Promise<number | null>)`

**Purpose:** Enforce row-level scope for Student and Parent roles.  
**Checks:**
1. If `req.session.role` is `admin` or `teacher` → skip (global scope)
2. If `req.session.role` is `student` → confirm resolved student ID matches `req.session.studentId`
3. If `req.session.role` is `parent` → confirm resolved student ID is in `req.session.childStudentIds[]`
4. Else → 403  

Applied on routes that serve student-scoped resources (assignments, assessments, student detail).

---

## 4. API Endpoint Inventory

Full inventory of all current + planned endpoints across all modules.

### Legend

| Symbol | Meaning |
|---|---|
| ✅ | Exists in codebase today |
| 🔲 | Planned — Phase 2 |
| `AUTH` | Requires valid session |
| `PERM:key` | Requires permission key |
| `SCOPED` | Subject to row-level access rules |

---

### 4a. Auth

| # | Method | Path | Status | Auth | Description |
|---|---|---|---|---|---|
| A1 | POST | `/api/auth/login` | ✅ | None | Authenticate and create session |
| A2 | POST | `/api/auth/logout` | ✅ | None | Destroy session |
| A3 | GET | `/api/auth/me` | ✅ | AUTH | Return current user + permissions |

---

### 4b. Students

| # | Method | Path | Status | Auth | Description |
|---|---|---|---|---|---|
| S1 | GET | `/api/students` | ✅ | AUTH + `students:read` | List all students |
| S2 | POST | `/api/students` | ✅ | AUTH + `students:create` | Create student record |
| S3 | GET | `/api/students/:id` | ✅ | AUTH + `students:read` + SCOPED | Get student detail |
| S4 | PATCH | `/api/students/:id` | ✅ | AUTH + `students:update` | Update student |
| S5 | DELETE | `/api/students/:id` | 🔲 | AUTH + `students:delete` | Delete student |
| S6 | GET | `/api/students/:id/progress` | ✅ | AUTH + `students:read` + SCOPED | Progress summary |
| S7 | GET | `/api/students/:id/ai-suggestions` | ✅ | AUTH + `ai:suggestions` + SCOPED | AI suggestions |

---

### 4c. Courses

| # | Method | Path | Status | Auth | Description |
|---|---|---|---|---|---|
| C1 | GET | `/api/courses` | ✅ | AUTH + `courses:read` | List courses |
| C2 | POST | `/api/courses` | ✅ | AUTH + `courses:create` | Create course |
| C3 | GET | `/api/courses/:id` | ✅ | AUTH + `courses:read` + SCOPED | Get course detail |
| C4 | PATCH | `/api/courses/:id` | ✅ | AUTH + `courses:update` | Update course |
| C5 | DELETE | `/api/courses/:id` | ✅ | AUTH + `courses:delete` | Delete course |
| C6 | GET | `/api/public/courses` | 🔲 | None (Guest) | Public course listing (name, subject only) |

---

### 4d. Assignments

| # | Method | Path | Status | Auth | Description |
|---|---|---|---|---|---|
| AS1 | GET | `/api/assignments` | ✅ | AUTH + `assignments:read` + SCOPED | List assignments |
| AS2 | POST | `/api/assignments` | ✅ | AUTH + `assignments:create` | Create assignment |
| AS3 | GET | `/api/assignments/:id` | ✅ | AUTH + `assignments:read` + SCOPED | Get assignment |
| AS4 | PATCH | `/api/assignments/:id` | ✅ | AUTH + `assignments:update` | Grade / update |
| AS5 | DELETE | `/api/assignments/:id` | ✅ | AUTH + `assignments:delete` | Delete assignment |

---

### 4e. Notes / Lessons

| # | Method | Path | Status | Auth | Description |
|---|---|---|---|---|---|
| N1 | GET | `/api/notes` | ✅ | AUTH + `notes:read` + SCOPED | List notes |
| N2 | POST | `/api/notes` | ✅ | AUTH + `notes:create` | Create note |
| N3 | GET | `/api/notes/:id` | ✅ | AUTH + `notes:read` + SCOPED | Get note |
| N4 | PATCH | `/api/notes/:id` | ✅ | AUTH + `notes:update` | Update note |
| N5 | DELETE | `/api/notes/:id` | ✅ | AUTH + `notes:delete` | Delete note |

---

### 4f. Assessments

| # | Method | Path | Status | Auth | Description |
|---|---|---|---|---|---|
| AE1 | GET | `/api/assessments` | ✅ | AUTH + `assessments:read` + SCOPED | List assessments |
| AE2 | POST | `/api/assessments` | ✅ | AUTH + `assessments:create` | Create assessment |
| AE3 | PATCH | `/api/assessments/:id` | ✅ | AUTH + `assessments:update` | Update assessment |
| AE4 | DELETE | `/api/assessments/:id` | ✅ | AUTH + `assessments:delete` | Delete assessment |

---

### 4g. Dashboard

| # | Method | Path | Status | Auth | Description |
|---|---|---|---|---|---|
| D1 | GET | `/api/dashboard/summary` | ✅ | AUTH + `dashboard:view` | Class overview stats |
| D2 | GET | `/api/dashboard/recent-activity` | ✅ | AUTH + `dashboard:view` | Activity feed |
| D3 | GET | `/api/dashboard/grade-breakdown` | ✅ | AUTH + `dashboard:view` | Grade distribution |

---

### 4h. Reports

| # | Method | Path | Status | Auth | Description |
|---|---|---|---|---|---|
| R1 | GET | `/api/reports/student-progress` | 🔲 | AUTH + `reports:view` + SCOPED | All-student progress report |

---

### 4i. Student Portal (self-service)

| # | Method | Path | Status | Auth | Description |
|---|---|---|---|---|---|
| SP1 | GET | `/api/student/dashboard` | 🔲 | AUTH + role=student | Own summary: subjects, upcoming, scores |
| SP2 | GET | `/api/student/subjects` | 🔲 | AUTH + role=student | Enrolled courses with per-course progress |
| SP3 | GET | `/api/student/subjects/:courseId` | 🔲 | AUTH + role=student | Course detail: notes, assignments, assessments |
| SP4 | GET | `/api/student/assignments` | 🔲 | AUTH + role=student | Own assignments |
| SP5 | GET | `/api/student/assessments` | 🔲 | AUTH + role=student | Own assessments |

---

### 4j. Admin — User Management

| # | Method | Path | Status | Auth | Description |
|---|---|---|---|---|---|
| U1 | GET | `/api/admin/users` | 🔲 | AUTH + `users:read` | List users (paginated, filterable by role) |
| U2 | POST | `/api/admin/users` | 🔲 | AUTH + `users:manage` | Create user account |
| U3 | GET | `/api/admin/users/:id` | 🔲 | AUTH + `users:read` | Get user detail + assigned roles |
| U4 | PATCH | `/api/admin/users/:id` | 🔲 | AUTH + `users:manage` | Update user (name, role, is_active) |
| U5 | DELETE | `/api/admin/users/:id` | 🔲 | AUTH + `users:manage` | Deactivate user (soft delete) |
| U6 | POST | `/api/admin/users/:id/reset-password` | 🔲 | AUTH + `users:manage` | Admin password reset |
| U7 | GET | `/api/admin/roles` | 🔲 | AUTH + `roles:manage` | List roles + their permissions |
| U8 | POST | `/api/admin/users/:id/roles` | 🔲 | AUTH + `roles:manage` | Grant role to user |
| U9 | DELETE | `/api/admin/users/:id/roles/:roleId` | 🔲 | AUTH + `roles:manage` | Revoke role from user |

---

### 4k. Admin — Infrastructure (existing)

| # | Method | Path | Status | Auth | Description |
|---|---|---|---|---|---|
| I1 | GET | `/api/admin/db-status` | ✅ | AUTH + `system:admin` | DB connection status + table counts |
| I2 | POST | `/api/admin/test-db` | ✅ | AUTH + `system:admin` | Test custom DB connection |
| I3 | GET | `/api/downloads/upgrade` | ✅ | None | Download upgrade bundle |
| I4 | GET | `/api/healthz` | ✅ | None | Health check |

---

## 5. Route Authorization Matrix

### Legend

| Symbol | Meaning |
|---|---|
| ✅ | Full access — all rows |
| 🔒 | Scoped access — see Row-Level Rules (Section 6) |
| ❌ | Denied — 403 Forbidden |
| — | Not applicable for this role |

---

### Auth Endpoints

| Endpoint | Admin | Teacher | Student | Parent | Guest |
|---|:---:|:---:|:---:|:---:|:---:|
| POST `/auth/login` | ✅ | ✅ | ✅ | ✅ | ✅ |
| POST `/auth/logout` | ✅ | ✅ | ✅ | ✅ | — |
| GET `/auth/me` | ✅ | ✅ | ✅ | ✅ | ❌ |

---

### Students

| Endpoint | Admin | Teacher | Student | Parent | Guest |
|---|:---:|:---:|:---:|:---:|:---:|
| GET `/students` | ✅ | ✅ | ❌ | ❌ | ❌ |
| POST `/students` | ✅ | ✅ | ❌ | ❌ | ❌ |
| GET `/students/:id` | ✅ | ✅ | 🔒 own | 🔒 children | ❌ |
| PATCH `/students/:id` | ✅ | ✅ | ❌ | ❌ | ❌ |
| DELETE `/students/:id` | ✅ | ❌ | ❌ | ❌ | ❌ |
| GET `/students/:id/progress` | ✅ | ✅ | 🔒 own | 🔒 children | ❌ |
| GET `/students/:id/ai-suggestions` | ✅ | ✅ | 🔒 own | 🔒 children | ❌ |

---

### Courses

| Endpoint | Admin | Teacher | Student | Parent | Guest |
|---|:---:|:---:|:---:|:---:|:---:|
| GET `/courses` | ✅ | ✅ | 🔒 enrolled | 🔒 child enrolled | ❌ |
| POST `/courses` | ✅ | ✅ | ❌ | ❌ | ❌ |
| GET `/courses/:id` | ✅ | ✅ | 🔒 enrolled | 🔒 child enrolled | ❌ |
| PATCH `/courses/:id` | ✅ | ✅ | ❌ | ❌ | ❌ |
| DELETE `/courses/:id` | ✅ | ❌ | ❌ | ❌ | ❌ |
| GET `/public/courses` | ✅ | ✅ | ✅ | ✅ | ✅ |

---

### Assignments

| Endpoint | Admin | Teacher | Student | Parent | Guest |
|---|:---:|:---:|:---:|:---:|:---:|
| GET `/assignments` | ✅ | ✅ | 🔒 own | 🔒 children | ❌ |
| POST `/assignments` | ✅ | ✅ | ❌ | ❌ | ❌ |
| GET `/assignments/:id` | ✅ | ✅ | 🔒 own | 🔒 children | ❌ |
| PATCH `/assignments/:id` | ✅ | ✅ | ❌ | ❌ | ❌ |
| DELETE `/assignments/:id` | ✅ | ✅ | ❌ | ❌ | ❌ |

---

### Notes / Lessons

| Endpoint | Admin | Teacher | Student | Parent | Guest |
|---|:---:|:---:|:---:|:---:|:---:|
| GET `/notes` | ✅ | ✅ | 🔒 enrolled | 🔒 child enrolled | ❌ |
| POST `/notes` | ✅ | ✅ | ❌ | ❌ | ❌ |
| GET `/notes/:id` | ✅ | ✅ | 🔒 enrolled | 🔒 child enrolled | ❌ |
| PATCH `/notes/:id` | ✅ | ✅ | ❌ | ❌ | ❌ |
| DELETE `/notes/:id` | ✅ | ✅ | ❌ | ❌ | ❌ |

---

### Assessments

| Endpoint | Admin | Teacher | Student | Parent | Guest |
|---|:---:|:---:|:---:|:---:|:---:|
| GET `/assessments` | ✅ | ✅ | 🔒 own | 🔒 children | ❌ |
| POST `/assessments` | ✅ | ✅ | ❌ | ❌ | ❌ |
| PATCH `/assessments/:id` | ✅ | ✅ | ❌ | ❌ | ❌ |
| DELETE `/assessments/:id` | ✅ | ❌ | ❌ | ❌ | ❌ |

---

### Dashboard

| Endpoint | Admin | Teacher | Student | Parent | Guest |
|---|:---:|:---:|:---:|:---:|:---:|
| GET `/dashboard/summary` | ✅ | ✅ | ❌ | ❌ | ❌ |
| GET `/dashboard/recent-activity` | ✅ | ✅ | ❌ | ❌ | ❌ |
| GET `/dashboard/grade-breakdown` | ✅ | ✅ | ❌ | ❌ | ❌ |

---

### Reports (Phase 2)

| Endpoint | Admin | Teacher | Student | Parent | Guest |
|---|:---:|:---:|:---:|:---:|:---:|
| GET `/reports/student-progress` | ✅ | ✅ | ❌ | 🔒 children | ❌ |

---

### Student Portal (Phase 2)

| Endpoint | Admin | Teacher | Student | Parent | Guest |
|---|:---:|:---:|:---:|:---:|:---:|
| GET `/student/dashboard` | — | — | ✅ | — | ❌ |
| GET `/student/subjects` | — | — | ✅ | — | ❌ |
| GET `/student/subjects/:courseId` | — | — | ✅ | — | ❌ |
| GET `/student/assignments` | — | — | ✅ | — | ❌ |
| GET `/student/assessments` | — | — | ✅ | — | ❌ |

---

### Admin — User Management (Phase 2)

| Endpoint | Admin | Teacher | Student | Parent | Guest |
|---|:---:|:---:|:---:|:---:|:---:|
| GET `/admin/users` | ✅ | ❌ | ❌ | ❌ | ❌ |
| POST `/admin/users` | ✅ | ❌ | ❌ | ❌ | ❌ |
| GET `/admin/users/:id` | ✅ | ❌ | ❌ | ❌ | ❌ |
| PATCH `/admin/users/:id` | ✅ | ❌ | ❌ | ❌ | ❌ |
| DELETE `/admin/users/:id` | ✅ | ❌ | ❌ | ❌ | ❌ |
| POST `/admin/users/:id/reset-password` | ✅ | ❌ | ❌ | ❌ | ❌ |
| GET `/admin/roles` | ✅ | ❌ | ❌ | ❌ | ❌ |
| POST `/admin/users/:id/roles` | ✅ | ❌ | ❌ | ❌ | ❌ |
| DELETE `/admin/users/:id/roles/:roleId` | ✅ | ❌ | ❌ | ❌ | ❌ |

---

### Infrastructure

| Endpoint | Admin | Teacher | Student | Parent | Guest |
|---|:---:|:---:|:---:|:---:|:---:|
| GET `/admin/db-status` | ✅ | ❌ | ❌ | ❌ | ❌ |
| POST `/admin/test-db` | ✅ | ❌ | ❌ | ❌ | ❌ |
| GET `/downloads/upgrade` | ✅ | ✅ | ❌ | ❌ | ❌ |
| GET `/healthz` | ✅ | ✅ | ✅ | ✅ | ✅ |

---

## 6. Row-Level Access Rules

Scoped (🔒) endpoints filter query results to the user's authorized slice of data. Rules are enforced in the **route handler**, not at the database constraint level.

---

### 6a. Scope Types

| Scope Name | Applied to Role | SQL Filter Logic |
|---|---|---|
| **Global** | admin, teacher | No filter — all rows returned |
| **Own Student** | student | `WHERE student_id = :session.studentId` |
| **My Children** | parent | `WHERE student_id = ANY(:session.childStudentIds)` |
| **Enrolled Courses** | student | `WHERE course_id = ANY(:session.enrolledCourseIds)` |
| **Children's Courses** | parent | `WHERE course_id = ANY(SELECT enrolled_course_ids FROM students WHERE id = ANY(:session.childStudentIds))` |
| **None** | guest | `WHERE FALSE` — always empty (or 403 for most routes) |

---

### 6b. Scope Resolution per Resource

#### `students` table

```
Role          Scope              Filter
────────────────────────────────────────────────────────────────────
admin         Global             (none)
teacher       Global             (none)
student       Own                WHERE students.id = session.studentId
parent        My children        WHERE students.id = ANY(session.childStudentIds)
guest         None               403 Forbidden
```

#### `assignments` table

```
Role          Scope              Filter
────────────────────────────────────────────────────────────────────
admin         Global             (none)
teacher       Global             (none)
student       Own                WHERE assignments.student_id = session.studentId
parent        My children        WHERE assignments.student_id = ANY(session.childStudentIds)
guest         None               403 Forbidden
```

#### `assessments` table

```
Role          Scope              Filter
────────────────────────────────────────────────────────────────────
admin         Global             (none)
teacher       Global             (none)
student       Own                WHERE assessments.student_id = session.studentId
parent        My children        WHERE assessments.student_id = ANY(session.childStudentIds)
guest         None               403 Forbidden
```

#### `courses` table

```
Role          Scope              Filter
────────────────────────────────────────────────────────────────────
admin         Global             (none)
teacher       Global             (none)
student       Enrolled           WHERE courses.id = ANY(session.enrolledCourseIds)
parent        Children enrolled  WHERE courses.id = ANY(
                                   SELECT DISTINCT unnest(enrolled_course_ids)
                                   FROM students
                                   WHERE id = ANY(session.childStudentIds)
                                 )
guest         Public only        Served from /api/public/courses (name, subject, description)
              (GET /public/*)    No access to /api/courses
```

#### `notes` table

```
Role          Scope              Filter
────────────────────────────────────────────────────────────────────
admin         Global             (none)
teacher       Global             (none)
student       Enrolled           WHERE notes.course_id = ANY(session.enrolledCourseIds)
parent        Children enrolled  WHERE notes.course_id IN (
                                   SELECT DISTINCT unnest(enrolled_course_ids)
                                   FROM students WHERE id = ANY(session.childStudentIds)
                                 )
guest         None               403 Forbidden
```

#### `reports` — `/api/reports/student-progress`

```
Role          Scope              Filter
────────────────────────────────────────────────────────────────────
admin         Global             All students
teacher       Global             All students
student       None               403 Forbidden
parent        My children        Filtered to session.childStudentIds
guest         None               403 Forbidden
```

---

### 6c. Single-Resource Access Check (GET /:id routes)

When a role with scoped access requests a specific resource by ID:

```
1. Fetch the resource record by :id
2. Extract the record's student_id (or course_id for course-scoped resources)
3. Check:
   ─ role = student  → record.student_id MUST equal session.studentId
   ─ role = parent   → record.student_id MUST be in session.childStudentIds[]
4. If check fails → 403 Forbidden (not 404 — leaking existence is acceptable here
   since IDs are not secret; 404 could confuse users who legitimately know the ID)
```

> **Design choice:** Return 403 (not 404) on ownership violations. Students and parents know their own IDs — returning 404 for a resource they're not authorized for adds confusion without real security benefit. Admins and teachers who audit access logs can distinguish 403 from 404.

---

### 6d. Scope Cache Invalidation

Session-cached arrays (`enrolledCourseIds`, `childStudentIds`) are set at login and held for the session lifetime (8 hours). This means:

| Change | When student/parent sees it |
|---|---|
| Student enrolled in a new course | Next login |
| Guardian link added for a parent | Next login |
| Guardian link removed | Next login |
| Student unenrolled from a course | Next login |

For immediate propagation, the admin can terminate the affected user's session via user deactivation + reactivation (which invalidates all sessions for that user).

---

## 7. Frontend Navigation Matrix by Role

### 7a. Sidebar Navigation Items

| Nav Item | Route | Admin | Teacher | Student | Parent | Guest |
|---|---|:---:|:---:|:---:|:---:|:---:|
| **Overview** (teacher dashboard) | `/` | ✅ | ✅ | ❌ | ❌ | ❌ |
| **My Dashboard** (student portal) | `/student` | ❌ | ❌ | ✅ | ❌ | ❌ |
| **My Children** (parent portal) | `/parent` | ❌ | ❌ | ❌ | ✅ | ❌ |
| **Students** | `/students` | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Courses** | `/courses` | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Assignments** | `/assignments` | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Notes** | `/notes` | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Assessments** | `/assessments` | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Progress Report** | `/reports/progress` | ✅ | ✅ | ❌ | ❌ | ❌ |
| **User Management** | `/admin/users` | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Settings** | `/settings` | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Browse Courses** | `/public/courses` | ✅ | ✅ | ✅ | ✅ | ✅ |

---

### 7b. Full Route Access Map (Frontend)

| Route | Admin | Teacher | Student | Parent | Guest |
|---|:---:|:---:|:---:|:---:|:---:|
| `/login` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `/` (teacher dashboard) | ✅ | ✅ | → redirect | → redirect | → login |
| `/student` | → redirect | → redirect | ✅ | → redirect | → login |
| `/student/subjects/:id` | → redirect | → redirect | ✅ | → redirect | → login |
| `/parent` | → redirect | → redirect | → redirect | ✅ | → login |
| `/students` | ✅ | ✅ | ❌ 403 | ❌ 403 | → login |
| `/students/:id` | ✅ | ✅ | 🔒 own | 🔒 children | → login |
| `/students/:id/ai` | ✅ | ✅ | 🔒 own | 🔒 children | → login |
| `/courses` | ✅ | ✅ | 🔒 enrolled | 🔒 enrolled | → login |
| `/courses/:id` | ✅ | ✅ | 🔒 enrolled | 🔒 enrolled | → login |
| `/assignments` | ✅ | ✅ | 🔒 own | 🔒 children | → login |
| `/notes` | ✅ | ✅ | 🔒 enrolled | 🔒 enrolled | → login |
| `/notes/:id` | ✅ | ✅ | 🔒 enrolled | 🔒 enrolled | → login |
| `/assessments` | ✅ | ✅ | 🔒 own | 🔒 children | → login |
| `/reports/progress` | ✅ | ✅ | ❌ 403 | 🔒 children | → login |
| `/admin/users` | ✅ | ❌ 403 | ❌ 403 | ❌ 403 | → login |
| `/admin/users/:id` | ✅ | ❌ 403 | ❌ 403 | ❌ 403 | → login |
| `/settings` | ✅ | ✅ | ❌ 403 | ❌ 403 | → login |
| `/public/courses` | ✅ | ✅ | ✅ | ✅ | ✅ |

**Redirect rules:**
- `→ redirect` — role is authenticated but this page is not for them; redirect to their home route
- `→ login` — unauthenticated; redirect to `/login`
- `❌ 403` — authenticated but forbidden; show "Not Authorized" page

---

### 7c. Home Route by Role

After successful login, each role lands on their appropriate home page:

| Role | Home Route | Page |
|---|---|---|
| `admin` | `/` | Teacher/admin dashboard (Overview) |
| `teacher` | `/` | Teacher dashboard (Overview) |
| `student` | `/student` | Student subject dashboard |
| `parent` | `/parent` | Parent — children overview |
| `guest` | `/public/courses` | Public course listing |

---

### 7d. Role-Aware Navigation (Implementation Guide for Frontend)

The sidebar `navItems` array is role-filtered using the `user.role` from `useAuth()`:

```
navConfig = {
  admin: [
    Overview, Students, Courses, Assignments,
    Notes, Assessments, Reports, UserManagement, Settings
  ],
  teacher: [
    Overview, Students, Courses, Assignments,
    Notes, Assessments, Reports, Settings
  ],
  student: [
    MyDashboard, BrowseCourses
  ],
  parent: [
    MyChildren, BrowseCourses
  ],
  guest: [
    BrowseCourses
  ]
}
```

The `Layout` component selects the nav list by `user.role`. Routes not in the nav list are still accessible by direct URL (subject to route guards) so that deep links work correctly.

---

### 7e. Route Guard Strategy (Frontend)

Three guard types, composed in `App.tsx`:

**1. `AuthGuard`** — redirects unauthenticated users to `/login`  
Applied to: all routes except `/login` and `/public/courses`

**2. `RoleGuard`** — redirects authenticated users who lack the required role to their home route  
Applied to: `/admin/users`, `/student/*`, `/parent/*`

**3. `PermissionGuard`** — hides or disables UI elements based on `user.permissions[]`  
Applied to: inline UI controls (e.g., delete buttons, grade input fields, "Create" buttons)

```
Guard layering in App.tsx:

<AuthGuard>                          ← outer: must be logged in
  <RoleGuard roles={['admin']}>      ← middle: must have the right role
    <AdminUsers />                   ← inner: component renders
  </RoleGuard>
</AuthGuard>
```

---

## 8. Guest Access Model

Guest is the only role that does not require authentication. It has access to exactly one resource.

### What Guest can access

| Resource | Endpoint | Fields exposed |
|---|---|---|
| Public course listing | GET `/api/public/courses` | `id`, `name`, `subject`, `description`, `teacher_name`, `student_count` |

### What Guest cannot access

Everything else. Attempting to access any authenticated endpoint without a session returns `401 Unauthorized`.

### Guest implementation path

Two options; the simpler is preferred for Phase 2:

**Option A — No login (anonymous):**  
`/api/public/courses` sits outside the `requireAuth` middleware wall, exactly like `/api/healthz`. No session required. The frontend renders `/public/courses` without calling `/api/auth/me`.

**Option B — Guest account:**  
A real `users` row with `role = 'guest'` and `is_active = true` exists. Guest logs in with shared credentials (or a magic link) and receives a session. Permissions resolve to the empty set except for `courses:read` (public only).

> **Recommendation:** Use Option A. Guest access is read-only and public by nature. Creating a session for it adds complexity with no security benefit.

---

## 9. Error Response Conventions

All RBAC-related errors from the API follow a consistent JSON envelope to allow the frontend to route users appropriately.

| HTTP Status | Condition | Response Body | Frontend Action |
|---|---|---|---|
| `401 Unauthorized` | No session / session expired | `{ "error": "Unauthorized" }` | Redirect to `/login` |
| `401 Unauthorized` | Account deactivated (`is_active = false`) | `{ "error": "Account is inactive" }` | Show deactivated message, clear local auth state |
| `403 Forbidden` | Session valid but permission missing | `{ "error": "Forbidden", "required": "students:read" }` | Show "Not Authorized" page or hide the triggering UI element |
| `403 Forbidden` | Session valid but row-level scope denied | `{ "error": "Forbidden" }` | Same as above — do not reveal that the resource exists under a different owner |
| `404 Not Found` | Resource genuinely does not exist | `{ "error": "Not found" }` | Show not-found page |

> **Consistency rule:** The `required` field in 403 responses is optional and should only be included in non-sensitive contexts (admin UI, developer tooling). Do not expose required permission keys to student or parent clients — this reveals the permission model to potential attackers.

---

*This document is the authoritative authorization design for Classmate Connect. It extends Architecture v1.0 and RBAC Design v1.0. Implementation follows this specification.*
