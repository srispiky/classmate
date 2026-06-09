# Classmate Connect — Phase 2 Sprint 1: RBAC Database Foundation

> **Source of truth:** Architecture v1.0 · RBAC Design v1.0 · API Auth Design v1.0 · Architecture Review Report v1.0  
> **Sprint:** Phase 2 · Sprint 1  
> **Version:** 1.0  
> **Date:** June 2026  
> **Architect role:** Senior .NET Solution Architect (applied to Node.js + PostgreSQL stack)  
> **Scope:** Database migrations, RBAC tables, seed data, rollback strategy  
> **Status:** AWAITING APPROVAL — do not begin Sprint 2 until this document is signed off  

---

## Table of Contents

1. [Sprint Scope & Exit Criteria](#1-sprint-scope--exit-criteria)
2. [Pre-Migration Checklist](#2-pre-migration-checklist)
3. [Migration Plan](#3-migration-plan)
4. [Updated ER Diagram](#4-updated-er-diagram)
5. [Entity Model Design](#5-entity-model-design)
6. [Seed Data Specification](#6-seed-data-specification)
7. [Migration Execution Order](#7-migration-execution-order)
8. [Rollback Strategy](#8-rollback-strategy)
9. [Risks & Mitigation](#9-risks--mitigation)
10. [Sprint 1 Completion Criteria](#10-sprint-1-completion-criteria)

---

## 1. Sprint Scope & Exit Criteria

### What Sprint 1 delivers

Sprint 1 delivers the **database foundation layer only**. No API routes are changed. No frontend code is changed. The application continues to operate identically for all existing users during and after this sprint.

| Deliverable | Description |
|---|---|
| 5 new RBAC tables | `roles`, `permissions`, `role_permissions`, `user_roles`, `student_guardians` |
| 1 table modification | `students.user_id` column added (nullable FK → `users.id`) |
| 3 schema corrections | Per Architecture Review Report v1.0: `users` timestamps → TIMESTAMPTZ; `session.sess` → JSONB; `students.user_id` partial UNIQUE index |
| Full seed data | All 4 roles, 27 permissions, complete role-permission matrix seeded |
| Back-fill migration | Existing `users.role` values mirrored into `user_roles` for all current user accounts |
| Rollback scripts | Verified, tested rollback for every migration step |
| Updated Drizzle schema | New table schema files added to `lib/db/src/schema/` — no existing files modified |

### What Sprint 1 does NOT deliver

- No API route changes
- No session payload changes
- No frontend changes
- No `requirePermission` or `requireRole` middleware
- No `course_enrollments` table (Architecture Review F-01 — scheduled Sprint 2)
- No `audit_log`, `skill_tags`, `assessment_skills`, `ai_suggestions` tables (Sprint 3+)

### Exit criteria

Sprint 1 is complete when:

1. All 14 migration steps execute successfully on the development database with zero errors
2. All seed data is present and verifiable with the verification queries in Section 6
3. The existing `GET /api/auth/login` endpoint returns the same response it does today
4. The existing `GET /api/students` endpoint returns the same response it does today
5. Rollback from step 14 to step 0 executes with zero errors and leaves the database in its pre-sprint state
6. `pnpm run typecheck` passes with zero errors after schema file additions

---

## 2. Pre-Migration Checklist

Complete every item before executing any migration step.

| # | Check | Owner | Method |
|---|---|---|---|
| C-01 | Full database backup created | DBA | `pg_dump classmate_db > backup_pre_sprint1_$(date +%Y%m%d).sql` |
| C-02 | Backup integrity verified | DBA | Restore backup to a test instance; confirm table counts match |
| C-03 | Current row counts documented | DBA | See baseline queries below |
| C-04 | All active user sessions noted | DBA | `SELECT COUNT(*) FROM session WHERE expire > NOW()` |
| C-05 | Node.js service stopped (for schema changes) | Ops | `nssm stop ClassmateAPI` |
| C-06 | Maintenance window confirmed | PM | Application unavailable for approx. 5–10 minutes |
| C-07 | Rollback scripts reviewed and staged | Dev | Scripts present and readable at migration location |
| C-08 | PostgreSQL version confirmed | DBA | `SELECT version()` — must be PostgreSQL 18+ |
| C-09 | `classmate_user` permissions confirmed | DBA | User must have `CREATE TABLE`, `ALTER TABLE`, `CREATE INDEX` on `classmate_db` |

### Baseline row counts (record before migration)

```sql
SELECT 'users'       AS table_name, COUNT(*) AS rows FROM users
UNION ALL
SELECT 'students',   COUNT(*) FROM students
UNION ALL
SELECT 'courses',    COUNT(*) FROM courses
UNION ALL
SELECT 'assignments',COUNT(*) FROM assignments
UNION ALL
SELECT 'assessments',COUNT(*) FROM assessments
UNION ALL
SELECT 'notes',      COUNT(*) FROM notes
UNION ALL
SELECT 'activity',   COUNT(*) FROM activity
UNION ALL
SELECT 'session',    COUNT(*) FROM session;
```

Record output. These counts must be identical after rollback if rollback is performed.

---

## 3. Migration Plan

Migrations are numbered M-01 through M-14. Each migration is a single, atomic, idempotent operation. Every migration has a corresponding rollback step R-01 through R-14.

All migrations run under a single database user: `classmate_user`.  
All migrations are wrapped in explicit transactions (`BEGIN` / `COMMIT`) so a failure mid-step leaves no partial state.

---

### M-01: Fix `users` table timestamp types

**Why:** Architecture Review F-05. `users.created_at` and `users.updated_at` use `TIMESTAMP WITHOUT TIME ZONE`. All other tables use `TIMESTAMPTZ`. This inconsistency causes incorrect cross-table time comparisons on non-UTC Windows servers.

**Operation type:** ALTER COLUMN type cast  
**Downtime required:** No (instantaneous type cast in PostgreSQL 18 — no table rewrite for compatible types)  
**Backward compatibility:** ✅ — All existing timestamp values are preserved. The cast is lossless.

**DDL (descriptive):**
```
ALTER TABLE users
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';
```

**Verification:**
```sql
SELECT column_name, data_type, udt_name
FROM information_schema.columns
WHERE table_name = 'users'
  AND column_name IN ('created_at', 'updated_at');
-- Expected: udt_name = 'timestamptz' for both
```

---

### M-02: Fix `session` table — `sess` column JSON → JSONB

**Why:** Architecture Review F-06. The `sess JSON` column is re-parsed from raw text on every session read (every authenticated request). JSONB is stored as parsed binary — faster reads, smaller on-disk size.

**Operation type:** ALTER COLUMN type cast  
**Downtime required:** Yes (table rewrite — active sessions will be invalidated)  
**Impact:** All currently logged-in users will be logged out. Sessions cannot be preserved across a JSON→JSONB cast. This is acceptable — plan during off-hours or low-usage window.

**DDL (descriptive):**
```
ALTER TABLE session
  ALTER COLUMN sess TYPE JSONB USING sess::JSONB;
```

**Post-step action:** After migration, all active sessions are invalidated. Users will re-authenticate. This is expected and documented in the maintenance notice.

**Verification:**
```sql
SELECT column_name, udt_name
FROM information_schema.columns
WHERE table_name = 'session' AND column_name = 'sess';
-- Expected: udt_name = 'jsonb'
```

---

### M-03: Create `roles` table

**Why:** RBAC Design v1.0, Section 5a. Role catalogue for the permission system.

**Operation type:** CREATE TABLE (new — no impact on existing tables)  
**Downtime required:** No

**DDL (descriptive):**
```
CREATE TABLE IF NOT EXISTS roles (
  id           SERIAL          PRIMARY KEY,
  name         TEXT            NOT NULL  UNIQUE,
  display_name TEXT            NOT NULL,
  description  TEXT            NOT NULL  DEFAULT '',
  is_system    BOOLEAN         NOT NULL  DEFAULT TRUE,
  created_at   TIMESTAMPTZ     NOT NULL  DEFAULT NOW()
);

COMMENT ON TABLE roles IS 'Role catalogue. is_system=TRUE rows cannot be deleted.';
COMMENT ON COLUMN roles.name IS 'Machine-readable role key: admin|teacher|student|parent|guest';
```

---

### M-04: Create `permissions` table

**Why:** RBAC Design v1.0, Section 5a. Permission key catalogue.

**Operation type:** CREATE TABLE (new — no impact on existing tables)  
**Downtime required:** No

**DDL (descriptive):**
```
CREATE TABLE IF NOT EXISTS permissions (
  id          SERIAL       PRIMARY KEY,
  resource    TEXT         NOT NULL,
  action      TEXT         NOT NULL,
  key         TEXT         NOT NULL  UNIQUE,
              -- key = resource || ':' || action, e.g. 'students:read'
  description TEXT         NOT NULL  DEFAULT '',
  created_at  TIMESTAMPTZ  NOT NULL  DEFAULT NOW(),

  CONSTRAINT uq_permissions_resource_action UNIQUE (resource, action)
);

COMMENT ON COLUMN permissions.key IS 'Composite key in format resource:action';
```

---

### M-05: Create `role_permissions` table

**Why:** RBAC Design v1.0, Section 5a. Join table mapping which permissions belong to which role.

**Operation type:** CREATE TABLE (new — no impact on existing tables)  
**Downtime required:** No

**DDL (descriptive):**
```
CREATE TABLE IF NOT EXISTS role_permissions (
  role_id       INTEGER   NOT NULL  REFERENCES roles(id)       ON DELETE CASCADE,
  permission_id INTEGER   NOT NULL  REFERENCES permissions(id)  ON DELETE CASCADE,

  PRIMARY KEY (role_id, permission_id)
);

CREATE INDEX idx_role_permissions_role_id
  ON role_permissions(role_id);

CREATE INDEX idx_role_permissions_permission_id
  ON role_permissions(permission_id);
```

---

### M-06: Create `user_roles` table

**Why:** RBAC Design v1.0, Section 5a. M:M join table between users and roles with audit trail and time-limited grants.

**Note:** Architecture Review Report F-13 correction applied — surrogate BIGSERIAL primary key instead of composite (user_id, role_id). Partial UNIQUE index enforces one active grant per user-role pair while allowing historical expired records.

**Operation type:** CREATE TABLE (new — no impact on existing tables)  
**Downtime required:** No

**DDL (descriptive):**
```
CREATE TABLE IF NOT EXISTS user_roles (
  id          BIGSERIAL    PRIMARY KEY,
  user_id     INTEGER      NOT NULL  REFERENCES users(id)   ON DELETE CASCADE,
  role_id     INTEGER      NOT NULL  REFERENCES roles(id)   ON DELETE RESTRICT,
  granted_by  INTEGER      NULL      REFERENCES users(id)   ON DELETE SET NULL,
  granted_at  TIMESTAMPTZ  NOT NULL  DEFAULT NOW(),
  expires_at  TIMESTAMPTZ  NULL      DEFAULT NULL
              -- NULL = no expiry (permanent grant)
);

-- Enforces: one active grant per user-role pair
-- Allows: historical expired rows for audit purposes
CREATE UNIQUE INDEX idx_user_roles_active_grant
  ON user_roles(user_id, role_id)
  WHERE (expires_at IS NULL OR expires_at > NOW());

CREATE INDEX idx_user_roles_user_id   ON user_roles(user_id);
CREATE INDEX idx_user_roles_expires   ON user_roles(expires_at)
  WHERE expires_at IS NOT NULL;

COMMENT ON COLUMN user_roles.expires_at IS 'NULL = permanent. Future: time-limited substitute teacher grants';
COMMENT ON COLUMN user_roles.granted_by IS 'NULL for system seed data or self-registration';
```

---

### M-07: Create `student_guardians` table

**Why:** RBAC Design v1.0, Section 5a. Parent/guardian → student relationship for row-level access scoping.

**Operation type:** CREATE TABLE (new — no impact on existing tables)  
**Downtime required:** No

**DDL (descriptive):**
```
CREATE TABLE IF NOT EXISTS student_guardians (
  id            SERIAL       PRIMARY KEY,
  student_id    INTEGER      NOT NULL  REFERENCES students(id)  ON DELETE CASCADE,
  user_id       INTEGER      NOT NULL  REFERENCES users(id)     ON DELETE CASCADE,
              -- user_id must have role 'parent' — enforced at application layer
  relationship  TEXT         NOT NULL  DEFAULT 'parent',
              -- 'parent' | 'guardian' | 'emergency_contact'
  is_primary    BOOLEAN      NOT NULL  DEFAULT FALSE,
  created_at    TIMESTAMPTZ  NOT NULL  DEFAULT NOW(),

  CONSTRAINT uq_student_guardian UNIQUE (student_id, user_id)
);

CREATE INDEX idx_student_guardians_user_id
  ON student_guardians(user_id);
  -- Used for: SELECT student_id FROM student_guardians WHERE user_id = :parentUserId

CREATE INDEX idx_student_guardians_student_id
  ON student_guardians(student_id);
  -- Used for: SELECT user_id FROM student_guardians WHERE student_id = :studentId

COMMENT ON COLUMN student_guardians.relationship
  IS 'Relationship type: parent | guardian | emergency_contact';
COMMENT ON COLUMN student_guardians.is_primary
  IS 'TRUE for primary contact; only one primary per student enforced at app layer';
```

---

### M-08: Add `user_id` column to `students`

**Why:** RBAC Design v1.0, Section 5b. Links a student roster record to a login account, enabling the student self-service portal. Nullable — students who do not yet have a login account have NULL.

**Architecture Review F-19 correction applied:** Partial UNIQUE index on `user_id WHERE user_id IS NOT NULL` prevents two student records from pointing to the same login account.

**Operation type:** ALTER TABLE ADD COLUMN (additive — no existing data affected)  
**Downtime required:** No (adding a nullable column is non-blocking in PostgreSQL 18)

**DDL (descriptive):**
```
ALTER TABLE students
  ADD COLUMN IF NOT EXISTS user_id INTEGER NULL
    REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_students_user_id
  ON students(user_id)
  WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_students_user_id_unique
  ON students(user_id)
  WHERE user_id IS NOT NULL;
  -- Allows multiple NULLs; enforces uniqueness only when set

COMMENT ON COLUMN students.user_id
  IS 'FK to users.id. NULL = no login account yet. Set by admin when creating student login.';
```

---

### M-09: Seed `roles` table

**Why:** Populate the role catalogue with the 4 system roles plus the guest role.  
All 5 rows have `is_system = TRUE` — they cannot be deleted by the admin UI.

**Operation type:** INSERT with conflict handling (idempotent)  
**Downtime required:** No

**Rows to insert:**

| id | name | display_name | description | is_system |
|---|---|---|---|---|
| 1 | `admin` | Administrator | Full system access. Manages users, roles, and all academic content. | TRUE |
| 2 | `teacher` | Teacher | Class-level access. Manages students, assignments, assessments, notes, and reports. | TRUE |
| 3 | `student` | Student | Self-service portal. Views own subjects, assignments, assessments, and AI suggestions. | TRUE |
| 4 | `parent` | Parent / Guardian | Scoped read-only access to their linked children's academic records. | TRUE |
| 5 | `guest` | Guest | Unauthenticated read-only access to public course catalogue only. | TRUE |

**Idempotency:** `INSERT ... ON CONFLICT (name) DO NOTHING` — safe to re-run.

---

### M-10: Seed `permissions` table

**Why:** Populate the 27 permission keys from RBAC Design v1.0, Section 3.

**Operation type:** INSERT with conflict handling (idempotent)  
**Downtime required:** No

**Complete permissions list:**

| id | resource | action | key | description |
|---|---|---|---|---|
| 1 | users | manage | `users:manage` | Create, update, deactivate, reset passwords for any user |
| 2 | users | read | `users:read` | View user list and profiles |
| 3 | roles | manage | `roles:manage` | Assign/revoke roles; edit permission grants |
| 4 | students | create | `students:create` | Add a new student to the roster |
| 5 | students | read | `students:read` | View student profiles and roster |
| 6 | students | update | `students:update` | Edit student details |
| 7 | students | delete | `students:delete` | Remove a student from the roster |
| 8 | courses | create | `courses:create` | Create a new course |
| 9 | courses | read | `courses:read` | View course details |
| 10 | courses | update | `courses:update` | Edit course details |
| 11 | courses | delete | `courses:delete` | Delete a course |
| 12 | assignments | create | `assignments:create` | Create assignments |
| 13 | assignments | read | `assignments:read` | View assignments |
| 14 | assignments | update | `assignments:update` | Grade / edit assignments |
| 15 | assignments | delete | `assignments:delete` | Delete assignments |
| 16 | assessments | create | `assessments:create` | Record an assessment |
| 17 | assessments | read | `assessments:read` | View assessments |
| 18 | assessments | update | `assessments:update` | Edit assessment scores / notes |
| 19 | assessments | delete | `assessments:delete` | Delete assessments |
| 20 | notes | create | `notes:create` | Create lesson notes |
| 21 | notes | read | `notes:read` | View lesson notes |
| 22 | notes | update | `notes:update` | Edit lesson notes |
| 23 | notes | delete | `notes:delete` | Delete lesson notes |
| 24 | reports | view | `reports:view` | View class-wide progress reports |
| 25 | dashboard | view | `dashboard:view` | View the dashboard summary |
| 26 | ai | suggestions | `ai:suggestions` | Trigger and view AI improvement suggestions |
| 27 | system | admin | `system:admin` | DB status, test-connection, upgrade bundle download |

**Idempotency:** `INSERT ... ON CONFLICT (key) DO NOTHING` — safe to re-run.

---

### M-11: Seed `role_permissions` table

**Why:** Apply the permission matrix from RBAC Design v1.0, Section 4 to the `role_permissions` join table.

**Operation type:** INSERT with conflict handling (idempotent)  
**Downtime required:** No

**Complete matrix — permission assignments by role:**

| Role | Permissions granted |
|---|---|
| **admin** (role_id=1) | ALL 27 permissions |
| **teacher** (role_id=2) | `students:create`, `students:read`, `students:update`, `courses:create`, `courses:read`, `courses:update`, `assignments:create`, `assignments:read`, `assignments:update`, `assignments:delete`, `assessments:create`, `assessments:read`, `assessments:update`, `notes:create`, `notes:read`, `notes:update`, `notes:delete`, `reports:view`, `dashboard:view`, `ai:suggestions` |
| **student** (role_id=3) | `students:read` (scoped-own), `courses:read` (scoped-enrolled), `assignments:read` (scoped-own), `assessments:read` (scoped-own), `notes:read` (scoped-enrolled), `dashboard:view` (scoped-own), `ai:suggestions` (scoped-own) |
| **parent** (role_id=4) | `students:read` (scoped-children), `courses:read` (scoped-child-enrolled), `assignments:read` (scoped-children), `assessments:read` (scoped-children), `notes:read` (scoped-child-enrolled), `reports:view` (scoped-children), `dashboard:view` (scoped-children), `ai:suggestions` (scoped-children) |
| **guest** (role_id=5) | `courses:read` (public only — `/api/public/courses`) |

**Idempotency:** `INSERT ... ON CONFLICT (role_id, permission_id) DO NOTHING` — safe to re-run.

**Row count:** 20 (teacher) + 7 (student) + 8 (parent) + 27 (admin) + 1 (guest) = **63 rows**

---

### M-12: Back-fill `user_roles` from `users.role`

**Why:** All existing user accounts have a `role` column value. These must be mirrored into `user_roles` so that Sprint 2's `requirePermission` middleware works correctly for all existing accounts without requiring each user to be manually re-assigned.

**Operation type:** INSERT from SELECT (data migration — reads `users`, writes `user_roles`)  
**Downtime required:** No (non-blocking insert)  
**Idempotency:** Uses `INSERT ... ON CONFLICT ... DO NOTHING` via the partial unique index on `(user_id, role_id) WHERE expires_at IS NULL`.

**Logic (descriptive):**
```
For each row in users where is_active = TRUE:
  Look up roles.id WHERE roles.name = users.role
  Insert into user_roles (user_id, role_id, granted_by=NULL, expires_at=NULL)
  ON CONFLICT (via the partial unique index) DO NOTHING
```

**Handling unknown role values:**  
If any `users.role` value does not match a row in `roles.name` (e.g., a legacy value like `'superadmin'` or a typo), the back-fill skips that user and logs a warning. A post-migration query identifies affected users:

```sql
SELECT u.id, u.username, u.role
FROM users u
LEFT JOIN roles r ON r.name = u.role
WHERE r.id IS NULL AND u.is_active = TRUE;
-- Expected: zero rows. Any rows returned need manual role assignment.
```

---

### M-13: Add `CHECK` constraint to `users.role`

**Why:** Architecture Review (implicit) — `users.role TEXT` has no domain constraint. Any string can be written to it. Adding a CHECK constraint ensures the shortcut column stays in sync with the valid role names.

**Operation type:** ALTER TABLE ADD CONSTRAINT  
**Downtime required:** No (PostgreSQL validates existing rows, all pass given M-09 seeded valid names)

**DDL (descriptive):**
```
ALTER TABLE users
  ADD CONSTRAINT chk_users_role
  CHECK (role IN ('admin', 'teacher', 'student', 'parent', 'guest'));
```

**Pre-check:** Verify no non-conforming values exist before adding constraint:
```sql
SELECT DISTINCT role FROM users WHERE role NOT IN ('admin','teacher','student','parent','guest');
-- Expected: zero rows
```

---

### M-14: Add comments and finalize indexes

**Why:** Production databases require column-level comments for DBA understanding and tooling. This step also adds two composite covering indexes for the most common RBAC resolution query.

**Operation type:** COMMENT, CREATE INDEX  
**Downtime required:** No (`CREATE INDEX CONCURRENTLY` used — non-blocking)

**Indexes:**
```
-- Fast permission resolution at login:
-- SELECT p.key FROM user_roles ur
-- JOIN role_permissions rp ON rp.role_id = ur.role_id
-- JOIN permissions p ON p.id = rp.permission_id
-- WHERE ur.user_id = :userId AND (ur.expires_at IS NULL OR ur.expires_at > NOW())

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_roles_active_resolution
  ON user_roles(user_id, role_id)
  WHERE (expires_at IS NULL OR expires_at > NOW());
  -- This index duplicates the UNIQUE index from M-06 for clarity
  -- PostgreSQL will use the existing partial index; this step confirms it exists

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_role_permissions_covering
  ON role_permissions(role_id, permission_id)
  INCLUDE (permission_id);
  -- Covering index: satisfies the JOIN without a heap fetch
```

**Table-level comments:**
```
COMMENT ON TABLE roles             IS 'RBAC role catalogue. Sprint 1.';
COMMENT ON TABLE permissions       IS 'RBAC permission catalogue (resource:action). Sprint 1.';
COMMENT ON TABLE role_permissions  IS 'M:M role → permission grants. Sprint 1.';
COMMENT ON TABLE user_roles        IS 'M:M user → role grants with audit trail. Sprint 1.';
COMMENT ON TABLE student_guardians IS 'Parent/guardian → student relationship for row-level access. Sprint 1.';
```

---

## 4. Updated ER Diagram

```
╔══════════════════════════════════════════════════════════════════════════════════════════╗
║         CLASSMATE CONNECT — ER DIAGRAM (Phase 2 Sprint 1 — RBAC Foundation)             ║
║         New tables: ████  Modified tables: ▓▓▓▓  Existing (unchanged): ░░░░             ║
╚══════════════════════════════════════════════════════════════════════════════════════════╝

  ┌──────────────────────────┐         ┌──────────────────────────┐
  │  ░░░░   USERS    ░░░░    │         │  ████   ROLES    ████    │
  │──────────────────────────│         │──────────────────────────│
  │ PK  id  SERIAL           │         │ PK  id  SERIAL           │
  │     username  (UNIQUE)   │         │     name  TEXT  (UNIQUE) │
  │     password_hash        │         │     display_name         │
  │     display_name         │         │     description          │
  │▓▓▓▓ role  TEXT ──────────┼────┐    │     is_system  BOOLEAN   │
  │     [CHECK constraint    │    │    │     created_at TIMESTAMPTZ│
  │      added M-13]         │    │    └───────────┬──────────────┘
  │     is_active  BOOLEAN   │    │                │ 1
  │▓▓▓▓ created_at TIMESTAMPTZ    └──── synced      │
  │▓▓▓▓ updated_at TIMESTAMPTZ         from M-12    │
  └────────────┬─────────────┘                     │
               │ 1                                 │ 1
               │                                   │
               │ ┌──────────────────────────┐       │
               │ │  ████  USER_ROLES  ████  │       │
               │ │──────────────────────────│       │
               └─┤ PK  id  BIGSERIAL         │       │
                 │ FK  user_id  → users.id   │       │
                 │ FK  role_id  → roles.id ──┼───────┘
                 │ FK  granted_by → users.id │
                 │     granted_at TIMESTAMPTZ│
                 │     expires_at TIMESTAMPTZ│
                 │ [PARTIAL UNIQUE INDEX:    │
                 │  (user_id, role_id)       │
                 │   WHERE expires_at IS NULL│
                 │   OR expires_at > NOW()]  │
                 └──────────────┬────────────┘
                                │ M role_id
                                │
               ┌────────────────▼─────────────┐
               │  ████  ROLE_PERMISSIONS  ████ │
               │──────────────────────────────│
               │ PK (role_id, permission_id)  │
               │ FK  role_id → roles.id       │
               │ FK  permission_id → perms.id─┼──────┐
               └──────────────────────────────┘      │
                                                      │
               ┌──────────────────────────────────────▼──┐
               │       ████  PERMISSIONS  ████           │
               │────────────────────────────────────────│
               │ PK  id  SERIAL                          │
               │     resource  TEXT  (e.g. 'students')   │
               │     action    TEXT  (e.g. 'read')        │
               │     key       TEXT  UNIQUE               │
               │               (e.g. 'students:read')     │
               │     description                         │
               │     created_at TIMESTAMPTZ              │
               │ [UNIQUE (resource, action)]              │
               └─────────────────────────────────────────┘


  ┌──────────────────────────┐
  │  ░░░░   USERS    ░░░░    │
  │  (parent role subset)    │
  └────────────┬─────────────┘
               │ 1
               │
               │ ┌────────────────────────────────┐
               │ │  ████  STUDENT_GUARDIANS  ████ │
               │ │────────────────────────────────│
               └─┤ PK  id  SERIAL                  │
                 │ FK  user_id    → users.id        │
                 │ FK  student_id → students.id ───┼──┐
                 │     relationship  TEXT            │  │
                 │     is_primary    BOOLEAN         │  │
                 │     created_at    TIMESTAMPTZ     │  │
                 │ [UNIQUE (student_id, user_id)]    │  │
                 └────────────────────────────────┘  │
                                                      │ M
                                                      ▼
  ┌──────────────────────────┐      ┌────────────────────────────────┐
  │  ░░░░  USERS    ░░░░     │      │  ▓▓▓▓   STUDENTS   ▓▓▓▓       │
  │  (student role subset)   │      │────────────────────────────────│
  └────────────┬─────────────┘      │ PK  id  SERIAL                 │
               │ 1                  │     name                       │
               │                    │     email  (UNIQUE)            │
               └────── user_id ─────┤▓▓▓▓ user_id  INTEGER  NULL     │
                                0..1│     [FK → users.id]            │
                                    │     [UNIQUE WHERE NOT NULL]     │
                                    │     grade                      │
                                    │     avatar_url                  │
                                    │     enrolled_course_ids  JSON   │
                                    │     [⚠ deprecated Sprint 2]    │
                                    │     created_at  TIMESTAMPTZ    │
                                    └────────────┬───────────────────┘
                                                 │
                       ┌─────────────────────────┼──────────────────────────┐
                       │ student_id              │ student_id               │ student_id
                       ▼                         ▼                          ▼
  ┌──────────────────────┐  ┌──────────────────────────┐  ┌──────────────────────────┐
  │  ░░░░ ASSIGNMENTS ░░ │  │  ░░░░  ASSESSMENTS  ░░░░ │  │  ░░░░   COURSES    ░░░░  │
  │  (unchanged Sprint 1)│  │  (unchanged Sprint 1)     │  │  (unchanged Sprint 1)    │
  └──────────────────────┘  └──────────────────────────┘  └──────────────────────────┘


  LEGEND:
  ████  New table (Sprint 1)
  ▓▓▓▓  Existing table with column additions / modifications
  ░░░░  Existing table — no changes in Sprint 1
  ──┼─  Foreign key relationship
  [..]  Constraint or index annotation
```

---

## 5. Entity Model Design

Entity models describe the Drizzle schema structure for all 5 new tables. One file per table, added to `lib/db/src/schema/`. No existing schema files are modified.

---

### 5a. File structure additions

```
lib/db/src/schema/
├── users.ts          ← existing — no changes
├── students.ts       ← MODIFIED — add user_id column
├── courses.ts        ← existing — no changes
├── assignments.ts    ← existing — no changes
├── notes.ts          ← existing — no changes
├── assessments.ts    ← existing — no changes
├── activity.ts       ← existing — no changes
├── roles.ts          ← NEW (M-03)
├── permissions.ts    ← NEW (M-04)
├── rolePermissions.ts← NEW (M-05)
├── userRoles.ts      ← NEW (M-06)
└── studentGuardians.ts ← NEW (M-07)
```

The `lib/db/src/index.ts` barrel export is updated to export all new schema objects.

---

### 5b. `roles` entity

```
Table:       roles
Drizzle ref: rolesTable
─────────────────────────────────────────────────────────────────────────────
Column       Drizzle type     PG type      Constraints
─────────────────────────────────────────────────────────────────────────────
id           serial()         SERIAL       primaryKey()
name         text()           TEXT         notNull(), unique()
display_name text()           TEXT         notNull()
description  text()           TEXT         notNull(), default('')
is_system    boolean()        BOOLEAN      notNull(), default(true)
created_at   timestamp({      TIMESTAMPTZ  notNull(), defaultNow()
               withTimezone: true })
─────────────────────────────────────────────────────────────────────────────
TypeScript type name: Role
Insert type name:     NewRole
```

---

### 5c. `permissions` entity

```
Table:       permissions
Drizzle ref: permissionsTable
─────────────────────────────────────────────────────────────────────────────
Column       Drizzle type     PG type      Constraints
─────────────────────────────────────────────────────────────────────────────
id           serial()         SERIAL       primaryKey()
resource     text()           TEXT         notNull()
action       text()           TEXT         notNull()
key          text()           TEXT         notNull(), unique()
description  text()           TEXT         notNull(), default('')
created_at   timestamp({      TIMESTAMPTZ  notNull(), defaultNow()
               withTimezone: true })
─────────────────────────────────────────────────────────────────────────────
Composite unique:  uniqueConstraint('uq_permissions_resource_action',
                                    [resource, action])
TypeScript type name: Permission
Insert type name:     NewPermission
```

---

### 5d. `role_permissions` entity

```
Table:       role_permissions
Drizzle ref: rolePermissionsTable
─────────────────────────────────────────────────────────────────────────────
Column         Drizzle type   PG type   Constraints
─────────────────────────────────────────────────────────────────────────────
role_id        integer()      INTEGER   notNull(),
                                        references(() => rolesTable.id,
                                          { onDelete: 'cascade' })
permission_id  integer()      INTEGER   notNull(),
                                        references(() => permissionsTable.id,
                                          { onDelete: 'cascade' })
─────────────────────────────────────────────────────────────────────────────
Primary key:  primaryKey({ columns: [role_id, permission_id] })
Indexes:      index('idx_role_permissions_role_id').on(role_id)
              index('idx_role_permissions_permission_id').on(permission_id)
TypeScript type name: RolePermission
```

---

### 5e. `user_roles` entity

```
Table:       user_roles
Drizzle ref: userRolesTable
─────────────────────────────────────────────────────────────────────────────
Column       Drizzle type     PG type      Constraints
─────────────────────────────────────────────────────────────────────────────
id           bigserial()      BIGSERIAL    primaryKey()
user_id      integer()        INTEGER      notNull(),
                                           references(() => usersTable.id,
                                             { onDelete: 'cascade' })
role_id      integer()        INTEGER      notNull(),
                                           references(() => rolesTable.id,
                                             { onDelete: 'restrict' })
granted_by   integer()        INTEGER      references(() => usersTable.id,
                                             { onDelete: 'set null' })
             .nullable()
granted_at   timestamp({      TIMESTAMPTZ  notNull(), defaultNow()
               withTimezone: true })
expires_at   timestamp({      TIMESTAMPTZ  nullable()
               withTimezone: true })
─────────────────────────────────────────────────────────────────────────────
Indexes:
  index('idx_user_roles_user_id').on(user_id)
  index('idx_user_roles_expires').on(expires_at) — filtered WHERE NOT NULL
  — Partial UNIQUE index is created via raw SQL in the migration script
    (Drizzle does not natively support WHERE clauses on unique indexes;
     this index is maintained outside the schema definition)
TypeScript type name: UserRole
Insert type name:     NewUserRole
```

---

### 5f. `student_guardians` entity

```
Table:       student_guardians
Drizzle ref: studentGuardiansTable
─────────────────────────────────────────────────────────────────────────────
Column        Drizzle type    PG type      Constraints
─────────────────────────────────────────────────────────────────────────────
id            serial()        SERIAL       primaryKey()
student_id    integer()       INTEGER      notNull(),
                                           references(() => studentsTable.id,
                                             { onDelete: 'cascade' })
user_id       integer()       INTEGER      notNull(),
                                           references(() => usersTable.id,
                                             { onDelete: 'cascade' })
relationship  text()          TEXT         notNull(), default('parent')
is_primary    boolean()       BOOLEAN      notNull(), default(false)
created_at    timestamp({     TIMESTAMPTZ  notNull(), defaultNow()
                withTimezone: true })
─────────────────────────────────────────────────────────────────────────────
Composite unique:  uniqueConstraint('uq_student_guardian', [student_id, user_id])
Indexes:
  index('idx_student_guardians_user_id').on(user_id)
  index('idx_student_guardians_student_id').on(student_id)
TypeScript type name: StudentGuardian
Insert type name:     NewStudentGuardian
```

---

### 5g. `students` modification

```
Table:       students  (EXISTING — modified)
─────────────────────────────────────────────────────────────────────────────
New column   Drizzle type    PG type   Constraints
─────────────────────────────────────────────────────────────────────────────
user_id      integer()       INTEGER   nullable(),
                                       references(() => usersTable.id,
                                         { onDelete: 'set null' })
─────────────────────────────────────────────────────────────────────────────
New index (raw SQL migration):
  CREATE UNIQUE INDEX idx_students_user_id_unique
  ON students(user_id) WHERE user_id IS NOT NULL
```

---

## 6. Seed Data Specification

All seed data is idempotent — executing it twice produces the same result as executing it once. All inserts use `ON CONFLICT ... DO NOTHING`.

---

### 6a. Execution order for seed data

```
1. Seed roles           (M-09) — must precede M-10, M-11, M-12
2. Seed permissions     (M-10) — must precede M-11
3. Seed role_permissions(M-11) — depends on roles and permissions IDs
4. Back-fill user_roles (M-12) — depends on roles IDs and existing users
```

---

### 6b. Roles seed (5 rows)

```
id | name    | display_name        | is_system | description
───┼─────────┼─────────────────────┼───────────┼──────────────────────────────────
1  | admin   | Administrator       | TRUE      | Full system access. Manages users,
   |         |                     |           | roles, and all academic content.
2  | teacher | Teacher             | TRUE      | Class-level access. Manages students,
   |         |                     |           | assignments, assessments, and notes.
3  | student | Student             | TRUE      | Self-service portal. Views own
   |         |                     |           | subjects and academic records.
4  | parent  | Parent / Guardian   | TRUE      | Scoped read-only access to linked
   |         |                     |           | children's academic records.
5  | guest   | Guest               | TRUE      | Unauthenticated. Public course
   |         |                     |           | catalogue only.
```

---

### 6c. Permissions seed (27 rows)

See M-10 table above. Each row has:  
`id, resource, action, key = (resource || ':' || action), description`

---

### 6d. Role-permissions seed (63 rows)

Expressed as role name → permission keys for readability:

```
ADMIN (id=1)   — ALL 27 permissions
─────────────────────────────────────────────────────────────────────────────
users:manage, users:read, roles:manage,
students:create, students:read, students:update, students:delete,
courses:create, courses:read, courses:update, courses:delete,
assignments:create, assignments:read, assignments:update, assignments:delete,
assessments:create, assessments:read, assessments:update, assessments:delete,
notes:create, notes:read, notes:update, notes:delete,
reports:view, dashboard:view, ai:suggestions, system:admin


TEACHER (id=2) — 20 permissions
─────────────────────────────────────────────────────────────────────────────
students:create, students:read, students:update,
courses:create, courses:read, courses:update,
assignments:create, assignments:read, assignments:update, assignments:delete,
assessments:create, assessments:read, assessments:update,
notes:create, notes:read, notes:update, notes:delete,
reports:view, dashboard:view, ai:suggestions


STUDENT (id=3) — 7 permissions  [all scoped at application layer]
─────────────────────────────────────────────────────────────────────────────
students:read,
courses:read,
assignments:read,
assessments:read,
notes:read,
dashboard:view,
ai:suggestions


PARENT (id=4) — 8 permissions  [all scoped at application layer]
─────────────────────────────────────────────────────────────────────────────
students:read,
courses:read,
assignments:read,
assessments:read,
notes:read,
reports:view,
dashboard:view,
ai:suggestions


GUEST (id=5) — 1 permission
─────────────────────────────────────────────────────────────────────────────
courses:read  (served only from /api/public/courses — no session required)
```

---

### 6e. Post-seed verification queries

Run these queries after M-11 to confirm seed data is correct:

```sql
-- 1. Confirm role count
SELECT COUNT(*) FROM roles;
-- Expected: 5

-- 2. Confirm permission count
SELECT COUNT(*) FROM permissions;
-- Expected: 27

-- 3. Confirm role_permissions count
SELECT COUNT(*) FROM role_permissions;
-- Expected: 63

-- 4. Confirm admin has all 27 permissions
SELECT COUNT(*) FROM role_permissions rp
JOIN roles r ON r.id = rp.role_id
WHERE r.name = 'admin';
-- Expected: 27

-- 5. Confirm teacher permission count
SELECT COUNT(*) FROM role_permissions rp
JOIN roles r ON r.id = rp.role_id
WHERE r.name = 'teacher';
-- Expected: 20

-- 6. Confirm back-fill: every active user has at least one role
SELECT COUNT(*) FROM users u
LEFT JOIN user_roles ur ON ur.user_id = u.id
  AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
WHERE u.is_active = TRUE AND ur.id IS NULL;
-- Expected: 0 (all active users have a role assignment)

-- 7. Confirm permission resolution for admin user (id=1 typically)
SELECT p.key FROM user_roles ur
JOIN role_permissions rp ON rp.role_id = ur.role_id
JOIN permissions p ON p.id = rp.permission_id
WHERE ur.user_id = 1
  AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
ORDER BY p.key;
-- Expected: 27 rows, all permission keys
```

---

## 7. Migration Execution Order

### 7a. Sequential execution diagram

```
PRE-MIGRATION
  C-01  Backup database
  C-02  Verify backup
  C-03  Document baseline row counts
  C-04  Note active session count
  C-05  Stop ClassmateAPI NSSM service
  C-06  Confirm maintenance window
  C-07  Stage rollback scripts
        │
        ▼
GROUP A — Schema corrections (existing tables)
  M-01  Fix users.created_at / updated_at → TIMESTAMPTZ
  M-02  Fix session.sess → JSONB  ← active sessions invalidated here
        │
        ▼
GROUP B — Create RBAC tables (new tables, independent)
  M-03  CREATE TABLE roles
  M-04  CREATE TABLE permissions
  M-05  CREATE TABLE role_permissions   ← depends on M-03, M-04
  M-06  CREATE TABLE user_roles         ← depends on M-03
  M-07  CREATE TABLE student_guardians  ← depends on students (existing)
        │
        ▼
GROUP C — Modify existing tables
  M-08  ALTER TABLE students ADD COLUMN user_id
        │
        ▼
GROUP D — Seed data (must run after all tables exist)
  M-09  INSERT roles
  M-10  INSERT permissions
  M-11  INSERT role_permissions         ← depends on M-09, M-10
  M-12  Back-fill user_roles            ← depends on M-09, M-10, M-11
        │
        ▼
GROUP E — Finalize
  M-13  ADD CHECK constraint users.role
  M-14  Add comments and covering indexes (CONCURRENTLY — non-blocking)
        │
        ▼
POST-MIGRATION
  V-01  Run all verification queries from Section 6e
  V-02  Run baseline row count comparison (should match pre-migration)
  V-03  Start ClassmateAPI NSSM service
  V-04  Smoke test: POST /api/auth/login → expect 200 with role returned
  V-05  Smoke test: GET /api/students → expect same student list as before
  V-06  Smoke test: GET /api/dashboard/summary → expect same response as before
```

### 7b. Estimated execution time

| Group | Steps | Estimated time |
|---|---|---|
| A — Schema corrections | M-01, M-02 | 2–3 minutes (M-02 rewrites session table) |
| B — Create RBAC tables | M-03 to M-07 | < 1 minute |
| C — Modify existing | M-08 | < 1 minute (nullable ADD COLUMN is instant) |
| D — Seed data | M-09 to M-12 | < 1 minute (small data volume) |
| E — Finalize | M-13, M-14 | 1–2 minutes (CONCURRENTLY index build) |
| **Total** | **14 steps** | **~5–7 minutes** |

---

## 8. Rollback Strategy

### 8a. Rollback philosophy

Sprint 1 migrations are designed to be fully reversible. Each migration step has a corresponding rollback step. Rollback proceeds in **reverse order** (R-14 → R-01).

No data is destroyed by the forward migrations — all operations are additive. The riskiest step is M-02 (session table type change) which invalidates active sessions but does not delete session data.

### 8b. Rollback trigger criteria

Execute rollback if any of the following are observed post-migration:

| Trigger | Action |
|---|---|
| Verification query in Section 6e returns unexpected results | Full rollback |
| Smoke test V-04 (login) returns non-200 | Investigate; if caused by migration → rollback |
| Smoke test V-05 (students list) returns different data | Investigate; if caused by migration → rollback |
| `pnpm run typecheck` fails after schema file additions | Fix schema files; rollback only if DB inconsistency identified |
| NSSM service fails to start after M-02 | Rollback from R-02 |

### 8c. Rollback steps (reverse order)

```
R-14  DROP indexes added in M-14 (IF EXISTS)
      REMOVE COMMENTS (optional — cosmetic only)

R-13  ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_role

R-12  DELETE FROM user_roles WHERE granted_by IS NULL
      -- Removes back-filled rows; manually-granted rows must be handled separately
      -- If no manual grants have been made (Sprint 1 only) this removes all rows

R-11  DELETE FROM role_permissions  -- or: TRUNCATE role_permissions

R-10  DELETE FROM permissions       -- or: TRUNCATE permissions

R-09  DELETE FROM roles             -- or: TRUNCATE roles

R-08  ALTER TABLE students DROP COLUMN IF EXISTS user_id

R-07  DROP TABLE IF EXISTS student_guardians

R-06  DROP TABLE IF EXISTS user_roles

R-05  DROP TABLE IF EXISTS role_permissions

R-04  DROP TABLE IF EXISTS permissions

R-03  DROP TABLE IF EXISTS roles

R-02  ALTER TABLE session ALTER COLUMN sess TYPE JSON USING sess::TEXT::JSON
      -- Restores JSON type; active sessions remain invalidated (acceptable)

R-01  ALTER TABLE users
        ALTER COLUMN created_at TYPE TIMESTAMP WITHOUT TIME ZONE
                     USING created_at AT TIME ZONE 'UTC',
        ALTER COLUMN updated_at TYPE TIMESTAMP WITHOUT TIME ZONE
                     USING updated_at AT TIME ZONE 'UTC';
```

### 8d. Rollback verification

After rollback, re-run the baseline row count query from Section 2. All counts must match the pre-migration baseline. Verify `GET /api/auth/login` returns the same response as before the migration window.

---

## 9. Risks & Mitigation

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R-01 | **M-02 (JSON→JSONB cast) locks the session table during rewrite** | Medium | Medium — locks all requests for duration of cast | Execute during low-usage window. Table rewrite takes < 30 seconds for typical session volumes. NSSM service stopped before migration. |
| R-02 | **M-12 back-fill fails for users with unrecognised `role` values** | Low | Low — only affects non-standard role values | Pre-flight check query identifies affected users. Admin manually assigns roles post-migration. System continues operating. |
| R-03 | **M-13 CHECK constraint fails on existing `role` values** | Low | Low — blocks constraint addition only | Pre-flight query in M-13 specification identifies non-conforming values before DDL executes. Fix values first. |
| R-04 | **Partial UNIQUE index on `user_roles` not supported by Drizzle** | High | Low — schema compiles but index is missing | Partial unique indexes on `user_roles` are created via raw SQL in the migration script, not via Drizzle schema. Documented in entity model Section 5e. |
| R-05 | **Seed data executed twice (accidental re-run)** | Medium | None — all inserts use `ON CONFLICT ... DO NOTHING` | Idempotent inserts protect against this. |
| R-06 | **Back-fill M-12 double-inserts if run twice** | Medium | None — partial unique index prevents duplicate active grants | The partial UNIQUE index on `(user_id, role_id) WHERE expires_at IS NULL` prevents duplicate rows. |
| R-07 | **`pnpm run typecheck` fails after schema additions** | Medium | Low — compilation failure, no runtime impact | Drizzle schema files must export correct types. Run typecheck before starting NSSM service. Rollback is only needed if DB inconsistency is found. |
| R-08 | **Windows IIS / NSSM service reads stale session data after M-02** | Medium | Low — stale sessions are invalid post-JSONB cast, users re-login | Expected and acceptable. Document in release notes. Users are notified of maintenance window. |
| R-09 | **`students.user_id` partial UNIQUE index conflicts with Drizzle schema definition** | Low | Low — cosmetic only; index exists in DB | Index is created via raw SQL in migration (M-08). Drizzle schema includes the FK column definition without the partial unique constraint. DBA confirms index exists post-migration. |
| R-10 | **`classmate_user` lacks `CREATE INDEX CONCURRENTLY` permission** | Low | Low — M-14 CONCURRENTLY indexes fail, fallback to regular CREATE INDEX | Check permissions in C-09. Fallback: remove CONCURRENTLY keyword from M-14 (adds brief lock). |

---

## 10. Sprint 1 Completion Criteria

Sprint 1 is complete and approved for Sprint 2 when **all** of the following are confirmed:

| # | Criterion | Confirmed by |
|---|---|---|
| SC-01 | All 14 migration steps executed with zero errors | DBA — migration log |
| SC-02 | All 6 verification queries in Section 6e return expected results | DBA — query output |
| SC-03 | Baseline row counts match pre-migration values | DBA — count comparison |
| SC-04 | Smoke test: `POST /api/auth/login` returns 200 with correct payload | Dev — manual or automated test |
| SC-05 | Smoke test: `GET /api/students` returns identical data to pre-migration | Dev — manual or automated test |
| SC-06 | Smoke test: `GET /api/dashboard/summary` returns identical data | Dev — manual or automated test |
| SC-07 | `pnpm run typecheck` passes with zero errors | Dev — CI or local run |
| SC-08 | Rollback scripts staged, tested on a copy, and confirmed executable | Dev + DBA |
| SC-09 | Updated ER diagram matches actual database schema | Dev — confirm via `\d tablename` in psql |
| SC-10 | Sprint 2 scope document reviewed and approved by stakeholders | PM |

---

*Sprint 1 scope is complete as specified. Sprint 2 scope (middleware implementation, session payload changes, `requirePermission` / `requireOwnership`, and `course_enrollments` table) will not begin until this document is approved.*
