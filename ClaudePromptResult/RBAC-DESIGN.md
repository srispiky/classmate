# Classmate Connect — RBAC Design

> **Source of truth:** Architecture v1.0  
> **Version:** 1.0  
> **Date:** June 2026  
> **Scope:** Database schema changes + ER diagram. No code.  

---

## Table of Contents

1. [Design Goals](#1-design-goals)
2. [Role Definitions](#2-role-definitions)
3. [Permission Catalogue](#3-permission-catalogue)
4. [Permission Matrix — Role vs Permission](#4-permission-matrix--role-vs-permission)
5. [Database Schema Changes](#5-database-schema-changes)
6. [ER Diagram](#6-er-diagram)
7. [Backward Compatibility](#7-backward-compatibility)
8. [Scoping Rules — Row-Level Access](#8-scoping-rules--row-level-access)
9. [Design Decisions](#9-design-decisions)

---

## 1. Design Goals

| Goal | Rationale |
|---|---|
| **Future-proof permission model** | Roles alone are too coarse. A separate `permissions` table allows granting individual permissions to roles — or directly to users — without schema changes. |
| **Multi-role support** | A user may hold more than one role (e.g., a teacher who is also a parent of a student). The join table `user_roles` handles this. |
| **Existing `users` table stays compatible** | The `role` TEXT column is kept as the *primary role shortcut*. Authoritative role data lives in `user_roles`. |
| **Parent–Student relationship** | Parents need read access scoped to their own children. A dedicated `student_guardians` join table makes this relationship explicit and queryable. |
| **Student self-service** | A `students.user_id` FK links a student roster record to a login account, enabling the student portal. |
| **Audit trail** | `user_roles` records who granted a role and when. `expires_at` supports time-limited access. |

---

## 2. Role Definitions

| Role | `name` | Description |
|---|---|---|
| Administrator | `admin` | Full system access. Manages users, roles, and all academic content. |
| Teacher | `teacher` | Class-level access. Manages students, assignments, assessments, notes, and views progress reports. |
| Student | `student` | Self-service portal. Views own subjects, assignments, assessments, and AI suggestions. |
| Parent / Guardian | `parent` | Scoped read-only access to their linked children's academic records. |

> **Note:** The Architecture v1.0 specified "Guest" — this design replaces Guest with **Parent**, which is a named, purposeful role with defined scope. If a true anonymous read-only role is needed in future, it can be added as a fifth row in the `roles` table without schema changes.

---

## 3. Permission Catalogue

Permissions follow the convention **`resource:action`**.

### Resources

| Resource | Covers |
|---|---|
| `users` | Login accounts in the `users` table |
| `roles` | Role and permission management |
| `students` | Student roster records |
| `courses` | Course catalogue |
| `assignments` | Assignment records |
| `assessments` | Assessment records |
| `notes` | Lesson notes / topics |
| `reports` | Aggregate progress reports |
| `dashboard` | Dashboard summary views |
| `ai` | AI suggestion generation |
| `system` | DB status, upgrade operations |

### Actions

| Action | Meaning |
|---|---|
| `read` | View / list records |
| `create` | Insert new records |
| `update` | Modify existing records |
| `delete` | Remove records |
| `manage` | Full CRUD + administrative operations (implies all four above) |

### Full Permission List

| # | Permission Key | Description |
|---|---|---|
| 1 | `users:manage` | Create, update, deactivate, and reset passwords for any user |
| 2 | `users:read` | View user list and profiles |
| 3 | `roles:manage` | Assign / revoke roles; edit permission grants |
| 4 | `students:create` | Add a new student to the roster |
| 5 | `students:read` | View student profiles and roster |
| 6 | `students:update` | Edit student details |
| 7 | `students:delete` | Remove a student from the roster |
| 8 | `courses:create` | Create a new course |
| 9 | `courses:read` | View course details |
| 10 | `courses:update` | Edit course details |
| 11 | `courses:delete` | Delete a course |
| 12 | `assignments:create` | Create assignments |
| 13 | `assignments:read` | View assignments |
| 14 | `assignments:update` | Grade / edit assignments |
| 15 | `assignments:delete` | Delete assignments |
| 16 | `assessments:create` | Record an assessment |
| 17 | `assessments:read` | View assessments |
| 18 | `assessments:update` | Edit assessment scores / notes |
| 19 | `assessments:delete` | Delete assessments |
| 20 | `notes:create` | Create lesson notes |
| 21 | `notes:read` | View lesson notes |
| 22 | `notes:update` | Edit lesson notes |
| 23 | `notes:delete` | Delete lesson notes |
| 24 | `reports:view` | View class-wide progress reports |
| 25 | `dashboard:view` | View the dashboard summary |
| 26 | `ai:suggestions` | Trigger and view AI improvement suggestions |
| 27 | `system:admin` | DB status, test-connection, download upgrade bundle |

---

## 4. Permission Matrix — Role vs Permission

> **Key:**  
> ✅ Full access  
> 🔒 Scoped (own records / linked children only — enforced at application layer)  
> — No access  

| Permission | Admin | Teacher | Student | Parent |
|---|:---:|:---:|:---:|:---:|
| `users:manage` | ✅ | — | — | — |
| `users:read` | ✅ | — | — | — |
| `roles:manage` | ✅ | — | — | — |
| `students:create` | ✅ | ✅ | — | — |
| `students:read` | ✅ | ✅ | 🔒 own | 🔒 children |
| `students:update` | ✅ | ✅ | — | — |
| `students:delete` | ✅ | — | — | — |
| `courses:create` | ✅ | ✅ | — | — |
| `courses:read` | ✅ | ✅ | 🔒 enrolled | 🔒 child enrolled |
| `courses:update` | ✅ | ✅ | — | — |
| `courses:delete` | ✅ | — | — | — |
| `assignments:create` | ✅ | ✅ | — | — |
| `assignments:read` | ✅ | ✅ | 🔒 own | 🔒 children |
| `assignments:update` | ✅ | ✅ | — | — |
| `assignments:delete` | ✅ | ✅ | — | — |
| `assessments:create` | ✅ | ✅ | — | — |
| `assessments:read` | ✅ | ✅ | 🔒 own | 🔒 children |
| `assessments:update` | ✅ | ✅ | — | — |
| `assessments:delete` | ✅ | — | — | — |
| `notes:create` | ✅ | ✅ | — | — |
| `notes:read` | ✅ | ✅ | 🔒 enrolled | 🔒 child enrolled |
| `notes:update` | ✅ | ✅ | — | — |
| `notes:delete` | ✅ | ✅ | — | — |
| `reports:view` | ✅ | ✅ | — | 🔒 children |
| `dashboard:view` | ✅ | ✅ | 🔒 own | 🔒 children |
| `ai:suggestions` | ✅ | ✅ | 🔒 own | 🔒 children |
| `system:admin` | ✅ | — | — | — |

---

## 5. Database Schema Changes

### 5a. New Tables

---

#### `roles` — Role catalogue

```
roles
─────────────────────────────────────────────────────────────
Column           Type                  Constraints
─────────────────────────────────────────────────────────────
id               SERIAL                PRIMARY KEY
name             TEXT                  NOT NULL  UNIQUE
                                       -- 'admin' | 'teacher' | 'student' | 'parent'
display_name     TEXT                  NOT NULL
description      TEXT                  NOT NULL  DEFAULT ''
is_system        BOOLEAN               NOT NULL  DEFAULT TRUE
                                       -- TRUE = shipped with app, cannot be deleted
created_at       TIMESTAMPTZ           NOT NULL  DEFAULT NOW()
─────────────────────────────────────────────────────────────
```

**Seed rows:**

| id | name | display_name | description | is_system |
|---|---|---|---|---|
| 1 | admin | Administrator | Full system access | true |
| 2 | teacher | Teacher | Class management access | true |
| 3 | student | Student | Student self-service portal | true |
| 4 | parent | Parent / Guardian | Read-only access to linked children | true |

---

#### `permissions` — Permission catalogue

```
permissions
─────────────────────────────────────────────────────────────
Column           Type                  Constraints
─────────────────────────────────────────────────────────────
id               SERIAL                PRIMARY KEY
resource         TEXT                  NOT NULL
                                       -- 'users' | 'roles' | 'students' | ...
action           TEXT                  NOT NULL
                                       -- 'read' | 'create' | 'update' | 'delete' | 'manage'
key              TEXT                  NOT NULL  UNIQUE
                                       -- computed: resource || ':' || action
description      TEXT                  NOT NULL  DEFAULT ''
created_at       TIMESTAMPTZ           NOT NULL  DEFAULT NOW()
─────────────────────────────────────────────────────────────
UNIQUE CONSTRAINT: (resource, action)
```

**27 seed rows** as defined in Section 3 (e.g., `key = 'students:read'`).

---

#### `role_permissions` — Which permissions each role holds

```
role_permissions
─────────────────────────────────────────────────────────────
Column           Type                  Constraints
─────────────────────────────────────────────────────────────
role_id          INTEGER               NOT NULL  FK → roles.id
permission_id    INTEGER               NOT NULL  FK → permissions.id
─────────────────────────────────────────────────────────────
PRIMARY KEY: (role_id, permission_id)
```

Seeded from the permission matrix in Section 4.

---

#### `user_roles` — Which roles each user holds (M:M with audit)

```
user_roles
─────────────────────────────────────────────────────────────
Column           Type                  Constraints
─────────────────────────────────────────────────────────────
user_id          INTEGER               NOT NULL  FK → users.id  ON DELETE CASCADE
role_id          INTEGER               NOT NULL  FK → roles.id  ON DELETE RESTRICT
granted_by       INTEGER               NULL      FK → users.id  (admin who granted)
granted_at       TIMESTAMPTZ           NOT NULL  DEFAULT NOW()
expires_at       TIMESTAMPTZ           NULL      -- NULL = permanent
─────────────────────────────────────────────────────────────
PRIMARY KEY: (user_id, role_id)
INDEX: (user_id)      -- fast lookup of a user's roles
INDEX: (expires_at)   -- efficient purge of expired grants
```

> **Why a join table instead of a single column?**  
> Supports multiple roles per user (e.g., a teacher who is also a parent), audit trail, and time-limited role grants — none of which are possible with a single `role` column.

---

#### `student_guardians` — Parent–Student relationship

```
student_guardians
─────────────────────────────────────────────────────────────
Column           Type                  Constraints
─────────────────────────────────────────────────────────────
id               SERIAL                PRIMARY KEY
student_id       INTEGER               NOT NULL  FK → students.id  ON DELETE CASCADE
user_id          INTEGER               NOT NULL  FK → users.id     ON DELETE CASCADE
                                       -- must have role 'parent' (enforced at app layer)
relationship     TEXT                  NOT NULL  DEFAULT 'parent'
                                       -- 'parent' | 'guardian' | 'emergency_contact'
is_primary       BOOLEAN               NOT NULL  DEFAULT FALSE
created_at       TIMESTAMPTZ           NOT NULL  DEFAULT NOW()
─────────────────────────────────────────────────────────────
UNIQUE CONSTRAINT: (student_id, user_id)
INDEX: (user_id)      -- look up all children of a parent
INDEX: (student_id)   -- look up all parents of a student
```

---

### 5b. Modified Tables

---

#### `users` — Add no columns, keep fully compatible

The existing `role` TEXT column is **retained** and re-classified as the *primary role shortcut*.

```
users  (EXISTING — no DDL changes required)
─────────────────────────────────────────────────────────────
Column           Change    Notes
─────────────────────────────────────────────────────────────
id               —         Unchanged — referenced by user_roles and student_guardians
username         —         Unchanged
password_hash    —         Unchanged
display_name     —         Unchanged
role             —         Kept. Semantics shift: this column now reflects the user's
                           PRIMARY role (the single most-important role). It is synced
                           from user_roles at write time by the application layer.
                           Authoritative role data = user_roles table.
is_active        —         Unchanged — still the global account enable/disable switch
created_at       —         Unchanged
updated_at       —         Unchanged
─────────────────────────────────────────────────────────────
```

> **Migration note:** After seeding `user_roles` from the existing `users.role` values, both sources are in sync. Future reads prefer `user_roles`; the column acts as a cached shortcut for fast single-role checks (e.g., the sidebar navigation).

---

#### `students` — Add `user_id` FK (nullable)

```
students  (ADD ONE COLUMN)
─────────────────────────────────────────────────────────────
Column           Change    Definition
─────────────────────────────────────────────────────────────
user_id          ADD       INTEGER  NULL
                           FK → users.id  ON DELETE SET NULL
                           INDEX: (user_id)
─────────────────────────────────────────────────────────────
```

This column is NULL for students who do not (yet) have a login account.  
When a student account is created, `user_id` is set, linking their roster record to their login.

---

### 5c. Migration Steps (DDL order)

```
Step 1  CREATE TABLE roles
Step 2  CREATE TABLE permissions
Step 3  CREATE TABLE role_permissions
Step 4  CREATE TABLE user_roles
Step 5  CREATE TABLE student_guardians
Step 6  ALTER TABLE students ADD COLUMN user_id INTEGER NULL REFERENCES users(id)
Step 7  CREATE INDEX idx_students_user_id ON students(user_id)
Step 8  INSERT seed rows into roles
Step 9  INSERT seed rows into permissions
Step 10 INSERT seed rows into role_permissions  (from permission matrix)
Step 11 INSERT INTO user_roles SELECT id, role_id FROM users  (sync existing role column)
```

Steps 1–10 are non-destructive (add-only).  
Step 11 is a data migration that back-fills `user_roles` from the current `users.role` values.  
No existing column or row is dropped or altered.

---

## 6. ER Diagram

```
╔══════════════════════════════════════════════════════════════════════════════════╗
║                       CLASSMATE CONNECT — ER DIAGRAM (RBAC v1.0)               ║
╚══════════════════════════════════════════════════════════════════════════════════╝

  ┌─────────────────────────┐         ┌─────────────────────────┐
  │         USERS           │         │         ROLES           │
  │─────────────────────────│         │─────────────────────────│
  │ PK  id                  │         │ PK  id                  │
  │     username            │         │     name           (UQ) │
  │     password_hash       │         │     display_name        │
  │     display_name        │         │     description         │
  │     role  ──────────────┼────┐    │     is_system           │
  │         (shortcut/cache)│    │    │     created_at          │
  │     is_active           │    │    └────────────┬────────────┘
  │     created_at          │    │                 │
  │     updated_at          │    └── synced from   │
  └───────────┬─────────────┘         user_roles   │
              │                                    │
              │ 1                                  │ 1
              │                                    │
              │   ┌─────────────────────────┐      │
              │   │       USER_ROLES        │      │
              │   │─────────────────────────│      │
              └───┤ FK  user_id   ──────────┘      │
                  │ FK  role_id   ──────────────────┘
                  │     granted_by (FK → users.id)
                  │     granted_at                  
                  │     expires_at   (NULL = no exp)
                  └─────────────────────────┐
                                            │ M
                                            │
              ┌─────────────────────────────┘
              │
              │
              │ M
              ▼
  ┌─────────────────────────┐         ┌─────────────────────────┐
  │    ROLE_PERMISSIONS     │         │      PERMISSIONS        │
  │─────────────────────────│         │─────────────────────────│
  │ FK  role_id             │         │ PK  id                  │
  │ FK  permission_id ──────┼─────────│     resource            │
  │                         │         │     action              │
  │ PK  (role_id,           │         │     key            (UQ) │
  │      permission_id)     │         │         resource:action │
  └─────────────────────────┘         │     description         │
                                      │     created_at          │
                                      └─────────────────────────┘


  ┌─────────────────────────┐
  │         USERS           │
  │  (parent role subset)   │
  └────────────┬────────────┘
               │ 1
               │
               │   ┌─────────────────────────┐
               │   │    STUDENT_GUARDIANS    │
               │   │─────────────────────────│
               └───┤ FK  user_id             │
                   │ FK  student_id ─────────┼──────────┐
                   │     relationship        │          │
                   │     is_primary          │          │
                   │     created_at          │          │
                   └─────────────────────────┘          │
                                                        │ M
                                                        ▼
  ┌─────────────────────────┐         ┌─────────────────────────┐
  │         USERS           │         │        STUDENTS         │
  │  (student role subset)  │         │─────────────────────────│
  └────────────┬────────────┘         │ PK  id                  │
               │ 1                    │     name                │
               │                      │     email          (UQ) │
               └──────── user_id ─────┤ FK  user_id    (NULL)   │
                                 0..1 │     grade               │
                                      │     avatar_url          │
                                      │     enrolled_course_ids │
                                      │     created_at          │
                                      └────────────┬────────────┘
                                                   │
                    ┌──────────────────────────────┼──────────────────────────────┐
                    │ student_id                   │ student_id                   │ student_id
                    ▼                              ▼                              ▼
  ┌─────────────────────────┐  ┌─────────────────────────┐  ┌─────────────────────────┐
  │      ASSIGNMENTS        │  │      ASSESSMENTS        │  │     (enrolled_course_   │
  │─────────────────────────│  │─────────────────────────│  │      ids JSON array)    │
  │ PK  id                  │  │ PK  id                  │  │          │              │
  │     title               │  │     title               │  │          ▼              │
  │ FK  student_id          │  │ FK  student_id          │  ┌─────────────────────────┐
  │ FK  course_id           │  │ FK  course_id           │  │        COURSES          │
  │     due_date            │  │     score               │  │─────────────────────────│
  │     status              │  │     max_score           │  │ PK  id                  │
  │     score               │  │     strengths  (JSON)   │  │     name                │
  │     max_score           │  │     weaknesses (JSON)   │  │     description         │
  │     feedback            │  │     created_at          │  │     teacher_name        │
  │     created_at          │  └─────────────────────────┘  │     subject             │
  └─────────────────────────┘                               │     student_count       │
                                                            │     created_at          │
                                                            └────────────┬────────────┘
                                                                         │ course_id
                                                                         ▼
                                                            ┌─────────────────────────┐
                                                            │          NOTES          │
                                                            │─────────────────────────│
                                                            │ PK  id                  │
                                                            │     title               │
                                                            │ FK  course_id           │
                                                            │     content             │
                                                            │     topic               │
                                                            │     video_url           │
                                                            │     created_at          │
                                                            └─────────────────────────┘


  ┌─────────────────────────┐
  │        ACTIVITY         │
  │─────────────────────────│  (denormalised event log — no FK constraints by design)
  │ PK  id                  │
  │     type                │
  │     description         │
  │     student_name        │
  │     course_name         │
  │     timestamp           │
  └─────────────────────────┘

  ┌─────────────────────────┐
  │        SESSION          │
  │─────────────────────────│  (express-session store — managed by connect-pg-simple)
  │ PK  sid                 │
  │     sess    (JSON)      │
  │     expire              │
  └─────────────────────────┘
```

---

### Cardinality Summary

| Relationship | Cardinality | Table |
|---|---|---|
| User → Roles | M:M | `user_roles` |
| Role → Permissions | M:M | `role_permissions` |
| Parent (user) → Students | M:M | `student_guardians` |
| Student → User (login) | 1:0..1 | `students.user_id` |
| Student → Assignments | 1:M | `assignments.student_id` |
| Student → Assessments | 1:M | `assessments.student_id` |
| Course → Assignments | 1:M | `assignments.course_id` |
| Course → Assessments | 1:M | `assessments.course_id` |
| Course → Notes | 1:M | `notes.course_id` |
| Student → Courses | M:M | `students.enrolled_course_ids` (JSON, no FK constraint) |

---

## 7. Backward Compatibility

| Concern | Impact | Resolution |
|---|---|---|
| `users.role` column removed | **Would break** existing API, session payload, and frontend | Column is **kept**. Semantics shift to "primary role cache". |
| Existing `admin` user (id=1, role='admin') | Safe | Step 11 migration inserts `(user_id=1, role_id=1)` into `user_roles`. Both sources agree. |
| `requireAuth` middleware | No change needed | Still checks `req.session.userId`. RBAC adds a new `requireRole()` / `requirePermission()` layer on top. |
| Session payload | No change needed | Session stores `userId`, `username`, `displayName`, `role`. The `role` field remains valid as the primary role. Permissions can be resolved server-side from `user_roles` + `role_permissions` on demand. |
| `students` table | Additive only | `user_id` column is nullable — all existing rows get `NULL`. No existing queries break. |
| API response shapes | No change | No existing response body is altered. |

---

## 8. Scoping Rules — Row-Level Access

The `permissions` table records *what* a role can do. **Where** (which rows) is governed by three scope types, enforced at the **application layer** (API route handlers), not by database constraints.

| Scope | Symbol | Who | Applied to |
|---|---|---|---|
| **Global** | ✅ | Admin, Teacher (most resources) | All rows in the table |
| **Own** | 🔒 own | Student | Only rows where `student_id = session.studentId` |
| **Children** | 🔒 children | Parent | Only rows where `student_id IN (SELECT student_id FROM student_guardians WHERE user_id = session.userId)` |
| **Enrolled** | 🔒 enrolled | Student | Only courses where `course_id IN student.enrolled_course_ids` |

### Scope Resolution Pattern (Application Layer)

```
1. Check: does the user have the required permission?  → resolved from user_roles + role_permissions
2. If YES + scope = Global  → proceed
3. If YES + scope = Own     → append WHERE student_id = :myStudentId
4. If YES + scope = Children→ append WHERE student_id IN (SELECT ... FROM student_guardians ...)
5. If NO                    → 403 Forbidden
```

This pattern requires no additional database tables. The scope is determined by the role, and the application applies the appropriate SQL filter.

---

## 9. Design Decisions

### D1 — Normalised RBAC over a Simple Role Enum

A plain `CHECK (role IN ('admin','teacher','student','parent'))` would work for today's four roles but cannot support:
- Per-user permission overrides (e.g., a teacher given temporary `users:read`)
- Time-limited roles (substitute teacher for 2 weeks)
- Multiple roles per user (teacher + parent)
- Future roles added without DDL changes

The `roles` + `permissions` + `role_permissions` + `user_roles` structure supports all of these.

### D2 — `users.role` as a Cache, Not the Authority

Removing `users.role` would require changes to the session payload, the `requireAuth` middleware, the auth route (`/api/auth/me`), and every frontend component that reads `user.role`. Keeping it as a denormalised cache eliminates all that churn while the RBAC tables become authoritative. The two are kept in sync by the application layer on role assignment.

### D3 — `student_guardians` as a First-Class Table

Storing parent–child relationships in a join table (rather than a JSON column on `students`) makes it queryable with standard SQL, supports multiple guardians per student, and cleanly enforces referential integrity via foreign keys.

### D4 — `students.user_id` is Nullable

Not every student on the roster needs a login. Teachers add students to the roster first; a login account is created separately when the school grants self-service access. The nullable FK supports both states without requiring two separate tables.

### D5 — Permissions Are Seeded, Not Dynamic

Permissions are defined by the development team and seeded into the database. They are not user-configurable strings. This prevents privilege escalation through typos or manual DB edits, and keeps permission checks in code as named constants (`PERMISSIONS.STUDENTS_READ`) rather than magic strings.

### D6 — Parent Replaces Guest

"Guest" in Architecture v1.0 was undefined. "Parent / Guardian" is a purposeful role with clear scope (own children's records). If an unauthenticated or limited observer role is needed in future, it can be added as a fifth row in `roles` without any schema changes.

---

*This document is the authoritative RBAC design for Classmate Connect. Implementation follows in Phase 2.*
