# Classmate Connect — Architecture Review Report

> **Review basis:** Architecture v1.0 · RBAC Design v1.0 · Authorization Design v1.0  
> **Review version:** 1.0  
> **Date:** June 2026  
> **Reviewer perspective:** Senior PostgreSQL + Production Backend Architect  
> **Stack preserved:** Node.js 24 · Express 5 · TypeScript 5.9 · Drizzle ORM · PostgreSQL 18  

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Severity Classification](#2-severity-classification)
3. [Design Review Findings](#3-design-review-findings)
4. [Required Schema Corrections](#4-required-schema-corrections)
5. [Recommended Additional Tables](#5-recommended-additional-tables)
6. [API Design Improvements](#6-api-design-improvements)
7. [Session & Auth Improvements](#7-session--auth-improvements)
8. [Final Production-Ready RBAC Architecture](#8-final-production-ready-rbac-architecture)

---

## 1. Executive Summary

The three design documents (Architecture v1.0, RBAC Design v1.0, Authorization Design v1.0) establish a solid conceptual foundation. The RBAC normalisation into `roles`, `permissions`, `role_permissions`, and `user_roles` is correct. The permission matrix is complete. The middleware stack order is sound.

However, **seven critical schema defects** must be corrected before implementation begins. Left unresolved, they will either cause incorrect row-level scoping at runtime, silent data corruption, or blocking performance failures at production data volumes. Four additional high-severity findings require resolution for AI recommendation readiness and frontend performance.

The good news: all corrections are additive. No existing table needs to be dropped. The `users` table remains fully compatible.

---

## 2. Severity Classification

| Severity | Meaning | Count |
|---|---|---|
| **P0 — Critical** | Incorrect behaviour, security hole, or will block a designed feature | 7 |
| **P1 — High** | Will cause performance failure or data inconsistency at production volume | 6 |
| **P2 — Medium** | Correctness or maintainability gap; blocks future AI features | 7 |
| **P3 — Low** | Production polish; not blocking for initial release | 4 |

---

## 3. Design Review Findings

---

### F-01 · `enrolled_course_ids` JSON array — CRITICAL (P0)

**Location:** `students` table, `enrolled_course_ids JSON DEFAULT '[]'`

**Problem:**  
The student–course enrolment relationship is modelled as a JSON array of integers inside the `students` row. This is the single most damaging design decision in the schema.

**Consequences:**
- No referential integrity. Enrolment can reference a deleted course ID forever.
- The authorization scope query in Authorization Design v1.0 (`WHERE course_id = ANY(session.enrolledCourseIds)`) requires the array to be read into the session at login and re-queried at every scope check. A student enrolled in 20 courses carries a 20-element array in their session.
- For Parent scope — `WHERE course_id = ANY(SELECT DISTINCT unnest(enrolled_course_ids) FROM students WHERE id = ANY(...))` — this is an unnest of a JSON array inside a subquery with no index support. It will full-scan `students` on every scoped course request.
- No way to query "which students are enrolled in course X" without a full table scan and JSON unnesting.
- PostgreSQL cannot create a B-tree index on a JSON array element.
- AI recommendation features need JOIN-able enrolment history with dates. A JSON array has no `enrolled_at` metadata.

**Required correction:** Replace with a `course_enrollments` join table. See Section 4.

---

### F-02 · `courses.teacher_name TEXT` — CRITICAL (P0)

**Location:** `courses` table, `teacher_name TEXT NOT NULL`

**Problem:**  
The teacher is stored as a free-text string, not as a foreign key to `users.id`. This severs the relationship between a course and its owning teacher account.

**Consequences:**
- Teachers cannot be scoped to their own courses. The RBAC design grants teachers `courses:update` globally — the design intent was presumably that teachers can only edit their own courses, but this is impossible without a `teacher_id` FK.
- If a teacher's `display_name` changes, all their course records show the old name.
- The AI recommendation feature (notes, lessons, assessment patterns by teacher) cannot be implemented.
- The Admin user management module (Phase 2) cannot show "courses owned by this teacher" without a full text-match scan.

**Required correction:** Add `teacher_id INTEGER NOT NULL REFERENCES users(id)`. Keep `teacher_name` as a display-cache column (updated by trigger or application layer). See Section 4.

---

### F-03 · Missing FK constraints on `assignments` and `assessments` — CRITICAL (P0)

**Location:** `assignments.course_id`, `assignments.student_id`, `assessments.course_id`, `assessments.student_id`

**Problem:**  
Architecture v1.0 explicitly documents: *"FK → courses.id (not enforced)"* and *"FK → students.id (not enforced)"*. These are soft references — no database-level constraint exists.

**Consequences:**
- Deleting a course or student leaves orphan assignments and assessments. Progress calculations, dashboard aggregations, and AI suggestions will operate on stale data referencing deleted records.
- Drizzle ORM's JOIN operations will silently return NULL or mismatched rows.
- The row-level access filter `WHERE assignments.student_id = session.studentId` has no guarantee that `student_id` points to a valid, active student.

**Required correction:** Add FK constraints with `ON DELETE RESTRICT` (prevent deletion if children exist) or `ON DELETE CASCADE` (delete children with parent). Educational data should default to `RESTRICT`. See Section 4.

---

### F-04 · `assignments.due_date` stored as `TEXT` — CRITICAL (P0)

**Location:** `assignments` table, `due_date TEXT NOT NULL`

**Problem:**  
Due dates stored as text strings cannot be sorted, filtered, or compared correctly by PostgreSQL. "2026-12-01" > "2026-9-15" fails under lexicographic comparison unless the format is strictly ISO 8601 (which is not enforced by a TEXT column).

**Consequences:**
- Sorting assignments by due date at the DB level is unreliable.
- Range queries ("assignments due this week") require application-layer filtering.
- The AI feature needs to reason about time — days until due, overdue pattern detection, submission timing — none of which work on a TEXT column.
- Student dashboard "upcoming assignments" will sort incorrectly.

**Required correction:** Change to `TIMESTAMPTZ NOT NULL`. See Section 4.

---

### F-05 · `TIMESTAMP` / `TIMESTAMPTZ` inconsistency — HIGH (P1)

**Location:** `users.created_at`, `users.updated_at` — `TIMESTAMP WITHOUT TIME ZONE`; all other tables — `TIMESTAMPTZ`

**Problem:**  
The `users` table uses timezone-naive timestamps while every other table uses `TIMESTAMPTZ`. In a Windows Server deployment with a non-UTC system clock, `NOW()` inserts will differ between the two formats. Comparisons between `users.created_at` and `activity.timestamp` will produce incorrect results.

**Required correction:** Standardize all timestamp columns to `TIMESTAMPTZ NOT NULL DEFAULT NOW()`.

---

### F-06 · `session.sess` column is `JSON` not `JSONB` — HIGH (P1)

**Location:** `session` table, `sess JSON NOT NULL`

**Problem:**  
`connect-pg-simple` defaults to `JSON`, but PostgreSQL stores `JSON` as raw text that must be re-parsed on every read. `JSONB` stores a binary-parsed representation that is faster to read, smaller on disk (deduplicates keys), and supports GIN indexing.

The session row is read on **every authenticated request** (Express rehydrates the session from the store). Using `JSON` adds unnecessary parse overhead at the most critical hot path in the application.

**Required correction:** Change `sess` to `JSONB`. See Section 4.

---

### F-07 · `activity` table — fully denormalised, no FK — HIGH (P1)

**Location:** `activity` table, `student_name TEXT`, `course_name TEXT`

**Problem:**  
The activity feed stores only text names with no `student_id` or `course_id` columns. This is appropriate for an append-only event log (names are correct at write time), but the current design has no student/course ID reference at all.

**Consequences:**
- Cannot filter activity by student or course without a full text scan.
- The dashboard's "recent activity" query cannot be scoped for Parents (show only activity for my children). Authorization Design v1.0 does not address this gap.
- When a student account is deleted, their activity entries cannot be purged or anonymised (FERPA/GDPR compliance concern).
- AI recommendation features need structured event data — "student X submitted assignment Y in course Z on date D" — not a text description.

**Required correction:** Add `student_id` and `course_id` integer columns (nullable, no FK for an event log) alongside the existing text columns. See Section 4.

---

### F-08 · `assessments.strengths` and `assessments.weaknesses` as JSON string arrays — MEDIUM (P2)

**Location:** `assessments` table, `strengths JSON`, `weaknesses JSON`

**Problem:**  
Strengths and weaknesses stored as `["Algebra", "Geometry"]` string arrays cannot be:
- Aggregated across students ("what are the most common weaknesses in Course X?")
- Normalised into a skill taxonomy for AI recommendation
- Indexed for search
- Used for trend analysis ("has this student's weakness in Calculus improved over 3 assessments?")

This is the primary blocker for the "AI recommendation features" requirement. The AI suggestion endpoint currently calls OpenAI with the raw strengths/weaknesses strings. Without a normalised skill taxonomy, the AI has no structured data to reason from — it can only summarise what the teacher typed.

**Required correction:** Add a `skill_tags` reference table and a `assessment_skills` join table. See Section 5.

---

### F-09 · Dashboard routes use in-memory aggregation — HIGH (P1)

**Location:** `artifacts/api-server/src/routes/dashboard.ts`

**Problem:**  
`GET /dashboard/summary`, `GET /dashboard/grade-breakdown`, and the student progress calculation (`GET /students/:id/progress`) load **all rows** from `students`, `courses`, `assignments`, and `assessments` into Node.js memory, then perform aggregation in JavaScript:

```
const students = await db.select().from(studentsTable);         // ALL rows
const courses  = await db.select().from(coursesTable);          // ALL rows
const assignments = await db.select().from(assignmentsTable);   // ALL rows
const assessments = await db.select().from(assessmentsTable);   // ALL rows
```

For a school with 500 students, 10 courses, 5,000 assignments, and 2,000 assessments, this loads ~50,000+ rows per dashboard request across 4 round-trips.

**Consequences:**
- Memory pressure on the NSSM Node.js process.
- Response time scales with data volume, not with the result set size.
- No benefit from PostgreSQL's query optimiser, indexes, or aggregation push-down.
- Cannot be cached with ETag headers because the data is recomputed from scratch on every request.

**Required correction:** Push all aggregations to PostgreSQL as single-query CTEs with GROUP BY. Use materialized views for the dashboard summary. See Section 6.

---

### F-10 · No pagination on list endpoints — HIGH (P1)

**Location:** `GET /api/students`, `GET /api/assignments`, `GET /api/notes`, `GET /api/assessments`, `GET /api/admin/users` (planned)

**Problem:**  
All list endpoints return the complete result set. No `?page`, `?limit`, `?cursor` parameters are defined anywhere in the three design documents.

A school with 300 students, 6,000 assignments across 5 years of records, and 3,000 assessments will:
- Transmit a 300-row JSON payload on every Students page load.
- Crash the Node.js process heap on a full assignments fetch if the school has been using the system for 3+ years.

**Required correction:** Design cursor-based pagination for all list endpoints. See Section 6.

---

### F-11 · Session-cached permissions become stale when role_permissions change — MEDIUM (P2)

**Location:** Authorization Design v1.0, Section 2a — `permissions: string[]` in session

**Problem:**  
Permissions are resolved at login and stored in the session for 8 hours. If an admin updates `role_permissions` (e.g., removes `assessments:delete` from the `teacher` role), all active teacher sessions retain the old permissions for up to 8 hours.

This is a correctness issue in a school environment — a teacher whose permissions are reduced mid-session can continue performing actions they should no longer be authorised to do.

**Required correction:** Add a `permissions_version` counter to the RBAC schema. The session stores the version at login. `requirePermission` middleware compares the stored version against the current DB version (read from an in-process cache, refreshed every 60 seconds). On mismatch, re-fetch permissions and update the session. See Section 7.

---

### F-12 · `courses.student_count` is a denormalised counter — MEDIUM (P2)

**Location:** `courses` table, `student_count INTEGER DEFAULT 0`

**Problem:**  
Once `enrolled_course_ids` is replaced with a proper `course_enrollments` join table (F-01 correction), the accurate student count is always `SELECT COUNT(*) FROM course_enrollments WHERE course_id = :id`. The denormalised `student_count` column will immediately drift out of sync unless a write trigger is maintained.

Maintaining a write trigger purely to cache a COUNT that is trivially computable adds complexity with no benefit at current data volumes.

**Required correction:** Remove `student_count` from `courses`. Compute it at query time via a join or a view. If read performance is critical, use a PostgreSQL materialized view. See Section 4.

---

### F-13 · `user_roles` PRIMARY KEY conflicts with role re-grant after expiry — MEDIUM (P2)

**Location:** RBAC Design v1.0, `user_roles` table

**Problem:**  
`PRIMARY KEY: (user_id, role_id)` with an `expires_at` column creates a logical contradiction: once a role expires (row has `expires_at < NOW()`), you cannot add a new grant for the same user–role pair without first deleting the expired row. A time-limited role grant (e.g., substitute teacher for 2 weeks) that is renewed cannot simply be re-inserted — it requires a DELETE + INSERT pattern, which is not described anywhere in the design.

The expired row is also never automatically removed — the design documents mention an index on `expires_at` for "efficient purge" but describe no purge process.

**Required correction:** Add a surrogate `id BIGSERIAL PRIMARY KEY`. Apply a partial unique index `UNIQUE (user_id, role_id) WHERE expires_at IS NULL OR expires_at > NOW()` to enforce only one active grant per user–role pair while allowing historical expired records. See Section 4.

---

### F-14 · No `created_by` tracking on academic content tables — MEDIUM (P2)

**Location:** `assignments`, `assessments`, `notes`, `courses` tables

**Problem:**  
None of the content tables record which user created the record. This means:
- A teacher cannot be scoped to only their own assignments/notes (a common future requirement: "Teacher A should not see Teacher B's notes").
- There is no audit capability for "who graded this assignment" or "who created this assessment".
- The RBAC design grants teachers `assignments:delete` globally — without a `created_by` check, any teacher can delete any other teacher's assignments.

**Required correction:** Add `created_by INTEGER NOT NULL REFERENCES users(id)` to `assignments`, `assessments`, `notes`, and `courses`. See Section 4.

---

### F-15 · `manage` permission does not imply sub-permissions — MEDIUM (P2)

**Location:** RBAC Design v1.0, Permission Catalogue

**Problem:**  
`users:manage` is described as "implies all four above" (read, create, update, delete). But `requirePermission('users:read')` checks `session.permissions.includes('users:read')` — if the admin was granted only `users:manage` and not explicitly `users:read`, this check fails.

The implication relationship is described in prose but not enforced in the schema or the session payload design. A developer implementing `requirePermission('users:read')` on a route will accidentally block admins who hold `users:manage` but not the individual `users:read` key.

**Required correction:** During permission resolution at login, expand any `manage` permission into its constituent `read + create + update + delete` keys. The session permissions array for an admin with `users:manage` must also include `users:read`, `users:create`, `users:update`, and `users:delete`. Document this expansion rule explicitly. See Section 7.

---

### F-16 · No soft-delete pattern — MEDIUM (P2)

**Location:** All content tables — `students`, `courses`, `assignments`, `assessments`, `notes`

**Problem:**  
Hard deletes on `students` cause orphaned assignments, assessments, and activity records. Hard deletes on `courses` orphan all enrolled students' assignment history. In an educational platform, deletion of academic records has legal and compliance implications (FERPA in the US).

**Required correction:** Add `deleted_at TIMESTAMPTZ NULL DEFAULT NULL` to `students`, `courses`, `assignments`, `assessments`, and `notes`. Pair each with a partial unique index `WHERE deleted_at IS NULL` on unique constraints, and a partial index on PKs. All queries filter `WHERE deleted_at IS NULL`. See Section 4.

---

### F-17 · No rate limiting or brute-force protection on auth endpoints — LOW (P3)

**Location:** `POST /api/auth/login`

**Problem:**  
The login endpoint has no rate limiting. Student passwords are typically weak (school-assigned). An attacker with knowledge of a student's username can perform unlimited password-guessing attempts.

**Required correction:** Design a `login_attempts` table (or in-memory rate limiter) that locks the account after N failures within a time window. See Section 7.

---

### F-18 · React Query has no server-side cache directives — LOW (P3)

**Location:** Frontend data fetching, `@workspace/api-client-react` hooks

**Problem:**  
No `ETag`, `Last-Modified`, or `Cache-Control` headers are defined in any of the three design documents. React Query's `staleTime` is set to `0` (default — refetch on every mount). This means:
- Every tab switch triggers a new API request.
- Navigating from Students list to Student detail and back re-fetches the full student list.
- The dashboard fetches 4 aggregations on every navigation to `/`.

**Required correction:** Define `Cache-Control: no-cache` + `ETag` on read endpoints. React Query's default `refetchOnWindowFocus: false` is already set (good). Document recommended `staleTime` values per resource type. See Section 6.

---

### F-19 · No `UNIQUE` constraint on `students.user_id` — LOW (P3)

**Location:** RBAC Design v1.0, `students` table modification

**Problem:**  
The design adds `user_id INTEGER NULL REFERENCES users(id)` but does not specify a `UNIQUE` constraint. Without it, two student roster records can link to the same login account — which would cause the Student's scoped queries to return data for two students simultaneously.

**Required correction:** Add `UNIQUE (user_id) WHERE user_id IS NOT NULL` (partial unique index — allows multiple NULLs, enforces uniqueness only when set). See Section 4.

---

## 4. Required Schema Corrections

The following corrections address all P0, P1, and P2 findings. No existing column is removed. All changes are additive unless explicitly stated.

---

### 4a. Replace `students.enrolled_course_ids` with `course_enrollments` table

**Action:** Deprecate the JSON column. Add a proper join table.

```
course_enrollments                         (NEW TABLE — replaces enrolled_course_ids JSON)
─────────────────────────────────────────────────────────────────────────────
Column           Type           Constraints
─────────────────────────────────────────────────────────────────────────────
id               BIGSERIAL      PRIMARY KEY
student_id       INTEGER        NOT NULL  FK → students.id  ON DELETE CASCADE
course_id        INTEGER        NOT NULL  FK → courses.id   ON DELETE RESTRICT
enrolled_at      TIMESTAMPTZ    NOT NULL  DEFAULT NOW()
enrolled_by      INTEGER        NOT NULL  FK → users.id     (teacher or admin who enrolled)
is_active        BOOLEAN        NOT NULL  DEFAULT TRUE
dropped_at       TIMESTAMPTZ    NULL      DEFAULT NULL
─────────────────────────────────────────────────────────────────────────────
UNIQUE CONSTRAINT: (student_id, course_id) WHERE is_active = TRUE
INDEX: (student_id)  WHERE is_active = TRUE     — student scope lookups
INDEX: (course_id)   WHERE is_active = TRUE     — course roster queries
```

**Migration:** The JSON array values from `students.enrolled_course_ids` are inserted as rows into `course_enrollments`. The JSON column is kept (not dropped) for one release cycle, then dropped.

---

### 4b. Add `teacher_id` FK to `courses`

**Action:** Add a FK column. Keep `teacher_name` as a display cache.

```
courses  (MODIFY)
─────────────────────────────────────────────────────────────────────────────
Column           Change     Definition
─────────────────────────────────────────────────────────────────────────────
teacher_id       ADD        INTEGER  NOT NULL  FK → users.id  ON DELETE RESTRICT
                            INDEX: (teacher_id)
teacher_name     KEEP       TEXT — retained as display cache, set on write
─────────────────────────────────────────────────────────────────────────────
```

**Scope impact:** When `teacher` role scope is implemented, `courses:read` for teachers is bounded by `WHERE courses.teacher_id = session.userId`.

---

### 4c. Add FK constraints to `assignments` and `assessments`

```
assignments  (MODIFY)
─────────────────────────────────────────────────────────────────────────────
course_id    ADD CONSTRAINT  FK → courses.id   ON DELETE RESTRICT
student_id   ADD CONSTRAINT  FK → students.id  ON DELETE RESTRICT

assessments  (MODIFY)
─────────────────────────────────────────────────────────────────────────────
course_id    ADD CONSTRAINT  FK → courses.id   ON DELETE RESTRICT
student_id   ADD CONSTRAINT  FK → students.id  ON DELETE RESTRICT
```

`RESTRICT` is correct for educational records — course and student deletion should be blocked if records exist, forcing a soft-delete or explicit cascade decision.

---

### 4d. Change `assignments.due_date` from `TEXT` to `TIMESTAMPTZ`

```
assignments  (MODIFY)
─────────────────────────────────────────────────────────────────────────────
due_date     TEXT → TIMESTAMPTZ  NOT NULL
─────────────────────────────────────────────────────────────────────────────
```

Existing text values must be cast to timestamps during migration. ISO 8601 formatted strings (`2026-12-01`) cast cleanly to `DATE`; if time is not needed, use `DATE` instead of `TIMESTAMPTZ`.

---

### 4e. Standardize all timestamps to `TIMESTAMPTZ`

```
users  (MODIFY)
─────────────────────────────────────────────────────────────────────────────
created_at   TIMESTAMP → TIMESTAMPTZ  NOT NULL  DEFAULT NOW()
updated_at   TIMESTAMP → TIMESTAMPTZ  NOT NULL  DEFAULT NOW()
─────────────────────────────────────────────────────────────────────────────
```

---

### 4f. Change `session.sess` from `JSON` to `JSONB`

```
session  (MODIFY)
─────────────────────────────────────────────────────────────────────────────
sess     JSON → JSONB  NOT NULL
─────────────────────────────────────────────────────────────────────────────
```

PostgreSQL allows an in-place `ALTER COLUMN` cast for `JSON → JSONB`. The `IDX_session_expire` index is kept unchanged.

---

### 4g. Add `student_id` and `course_id` to `activity`

```
activity  (MODIFY — additive only)
─────────────────────────────────────────────────────────────────────────────
student_id   ADD  INTEGER  NULL   (no FK constraint — event log semantics)
course_id    ADD  INTEGER  NULL   (no FK constraint — event log semantics)
─────────────────────────────────────────────────────────────────────────────
INDEX: (student_id)  WHERE student_id IS NOT NULL
INDEX: (course_id)   WHERE course_id  IS NOT NULL
```

No FK is added intentionally — an event log should not be blocked by referential integrity; it records what happened even if the referenced entity is later deleted.

---

### 4h. Add `deleted_at` soft-delete to content tables

```
ADD COLUMN deleted_at TIMESTAMPTZ NULL DEFAULT NULL
to: students, courses, assignments, assessments, notes
─────────────────────────────────────────────────────────────────────────────
Each table: PARTIAL INDEX  idx_{table}_active  ON {table}(id) WHERE deleted_at IS NULL
```

All existing application queries must add `WHERE deleted_at IS NULL`. The UNIQUE constraint on `students.email` and `users.username` becomes a partial unique index `WHERE deleted_at IS NULL`.

---

### 4i. Add `created_by` to content tables

```
ADD COLUMN created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT
to: assignments, assessments, notes, courses
─────────────────────────────────────────────────────────────────────────────
```

For existing rows (migration), set `created_by = 1` (the admin user) as a placeholder. For future rows, the API route handler sets this from `req.session.userId`.

---

### 4j. Fix `user_roles` primary key for re-grantable expiry

```
user_roles  (MODIFY)
─────────────────────────────────────────────────────────────────────────────
Remove:  PRIMARY KEY (user_id, role_id)
Add:     id          BIGSERIAL  PRIMARY KEY
Add:     UNIQUE INDEX  idx_user_roles_active
         ON user_roles(user_id, role_id)
         WHERE (expires_at IS NULL OR expires_at > NOW())
─────────────────────────────────────────────────────────────────────────────
```

This allows a historical audit of all grants while enforcing that only one active grant exists per user–role pair.

---

### 4k. Add partial UNIQUE constraint on `students.user_id`

```
students  (MODIFY — additive to the ADD COLUMN from RBAC Design v1.0)
─────────────────────────────────────────────────────────────────────────────
ADD: UNIQUE INDEX idx_students_user_id_unique
     ON students(user_id)
     WHERE user_id IS NOT NULL
─────────────────────────────────────────────────────────────────────────────
```

---

### 4l. Remove `courses.student_count`

```
courses  (DEPRECATE COLUMN)
─────────────────────────────────────────────────────────────────────────────
student_count   INTEGER — retain for one release, then DROP COLUMN
                          Replaced by: SELECT COUNT(*) FROM course_enrollments
                          WHERE course_id = :id AND is_active = TRUE
─────────────────────────────────────────────────────────────────────────────
```

---

## 5. Recommended Additional Tables

These tables are not corrections — they are new tables required for AI recommendation readiness and production audit compliance.

---

### 5a. `skill_tags` — Normalised skill/topic taxonomy

**Purpose:** Replaces the ad-hoc string arrays in `assessments.strengths` and `assessments.weaknesses`. Enables structured AI recommendation and aggregate weakness analysis.

```
skill_tags
─────────────────────────────────────────────────────────────────────────────
Column           Type           Constraints
─────────────────────────────────────────────────────────────────────────────
id               BIGSERIAL      PRIMARY KEY
name             TEXT           NOT NULL  UNIQUE
category         TEXT           NOT NULL  DEFAULT 'general'
                                -- 'cognitive' | 'subject' | 'behavioural' | 'general'
subject          TEXT           NULL
                                -- 'Mathematics' | 'English' | NULL (cross-subject)
parent_id        BIGINT         NULL  FK → skill_tags.id
                                -- supports skill hierarchy (Algebra → Mathematics)
created_at       TIMESTAMPTZ    NOT NULL  DEFAULT NOW()
─────────────────────────────────────────────────────────────────────────────
INDEX: (category)
INDEX: (subject)  WHERE subject IS NOT NULL
```

---

### 5b. `assessment_skills` — Normalised assessment → skill join

**Purpose:** Replaces the JSON string arrays in `assessments`. Enables aggregate queries and AI input.

```
assessment_skills
─────────────────────────────────────────────────────────────────────────────
Column           Type           Constraints
─────────────────────────────────────────────────────────────────────────────
id               BIGSERIAL      PRIMARY KEY
assessment_id    INTEGER        NOT NULL  FK → assessments.id  ON DELETE CASCADE
skill_tag_id     BIGINT         NOT NULL  FK → skill_tags.id   ON DELETE RESTRICT
signal           TEXT           NOT NULL
                                -- 'strength' | 'weakness' | 'neutral'
confidence       REAL           NULL
                                -- 0.0–1.0, set by AI model when AI-derived
source           TEXT           NOT NULL  DEFAULT 'teacher'
                                -- 'teacher' | 'ai' | 'auto'
created_at       TIMESTAMPTZ    NOT NULL  DEFAULT NOW()
─────────────────────────────────────────────────────────────────────────────
UNIQUE CONSTRAINT: (assessment_id, skill_tag_id, signal)
INDEX: (skill_tag_id, signal)   — aggregate "top weaknesses for course X"
INDEX: (assessment_id)
```

---

### 5c. `ai_suggestions` — Persisted AI recommendation records

**Purpose:** Stores AI-generated suggestions with feedback tracking. Currently, AI suggestions are generated on-demand and not persisted. Without persistence, there is no feedback loop — the AI cannot learn which suggestions are acted on.

```
ai_suggestions
─────────────────────────────────────────────────────────────────────────────
Column           Type           Constraints
─────────────────────────────────────────────────────────────────────────────
id               BIGSERIAL      PRIMARY KEY
student_id       INTEGER        NOT NULL  FK → students.id   ON DELETE CASCADE
generated_by     INTEGER        NOT NULL  FK → users.id      ON DELETE RESTRICT
                                -- the teacher or admin who triggered generation
model            TEXT           NOT NULL  DEFAULT 'gpt-4o'
prompt_version   INTEGER        NOT NULL  DEFAULT 1
                                -- version of the prompt template used
suggestion_text  TEXT           NOT NULL  -- full AI-generated text
status           TEXT           NOT NULL  DEFAULT 'pending'
                                -- 'pending' | 'accepted' | 'dismissed' | 'acted_on'
teacher_notes    TEXT           NULL      -- teacher annotation on the suggestion
created_at       TIMESTAMPTZ    NOT NULL  DEFAULT NOW()
reviewed_at      TIMESTAMPTZ    NULL
─────────────────────────────────────────────────────────────────────────────
INDEX: (student_id, created_at DESC)   — student timeline
INDEX: (status)  WHERE status = 'pending'
```

---

### 5d. `audit_log` — Immutable change history

**Purpose:** Compliance and accountability. Required for FERPA (US) compliance — educational records must have a traceable history of access and modification.

```
audit_log
─────────────────────────────────────────────────────────────────────────────
Column           Type           Constraints
─────────────────────────────────────────────────────────────────────────────
id               BIGSERIAL      PRIMARY KEY
actor_id         INTEGER        NULL  FK → users.id  ON DELETE SET NULL
                                -- NULL for system-initiated events
action           TEXT           NOT NULL
                                -- 'user.login' | 'user.deactivated' |
                                   'role.granted' | 'grade.updated' |
                                   'student.deleted' | ...
resource_type    TEXT           NOT NULL  -- 'user' | 'student' | 'assignment' | ...
resource_id      INTEGER        NOT NULL
old_value        JSONB          NULL
new_value        JSONB          NULL
ip_address       TEXT           NULL
user_agent       TEXT           NULL
created_at       TIMESTAMPTZ    NOT NULL  DEFAULT NOW()
─────────────────────────────────────────────────────────────────────────────
INDEX: (actor_id, created_at DESC)
INDEX: (resource_type, resource_id, created_at DESC)
INDEX: (created_at DESC)   — for time-range audit queries
```

> **Design note:** `audit_log` is append-only. No UPDATE or DELETE is ever performed on this table. Row-level security (PostgreSQL RLS) can be used to enforce this if required.

---

### 5e. `rbac_version` — Permission cache invalidation signal

**Purpose:** Resolves F-11 (stale session permissions). A single-row table that increments a version counter whenever `role_permissions` is modified.

```
rbac_version
─────────────────────────────────────────────────────────────────────────────
Column           Type           Constraints
─────────────────────────────────────────────────────────────────────────────
id               INTEGER        PRIMARY KEY  DEFAULT 1
                                CHECK (id = 1)   -- enforces single row
version          INTEGER        NOT NULL  DEFAULT 1
updated_at       TIMESTAMPTZ    NOT NULL  DEFAULT NOW()
─────────────────────────────────────────────────────────────────────────────
```

When `role_permissions` is modified, `UPDATE rbac_version SET version = version + 1`. The session stores `permissionsVersion: number`. On each authenticated request, the middleware compares `req.session.permissionsVersion` against a cached (60-second TTL) read of `rbac_version.version`. On mismatch, re-resolve permissions from DB and update the session.

---

## 6. API Design Improvements

---

### 6a. Push dashboard aggregations to PostgreSQL

**Current design (incorrect):** Load all rows, aggregate in JavaScript.

**Corrected design:** Single CTE query returning the complete dashboard summary in one round-trip. PostgreSQL 18's parallel query execution makes this dramatically faster than four sequential SELECT * queries.

**Dashboard summary — one query shape:**

```
WITH
  student_stats AS (
    SELECT COUNT(*) AS total_students,
           COUNT(*) FILTER (WHERE ...) AS at_risk_count
    FROM students WHERE deleted_at IS NULL
  ),
  course_stats AS (
    SELECT COUNT(*) AS total_courses FROM courses WHERE deleted_at IS NULL
  ),
  assignment_stats AS (
    SELECT
      COUNT(*)                                          AS total_assignments,
      COUNT(*) FILTER (WHERE status IN ('pending','late')) AS pending_assignments,
      AVG((score / max_score) * 100)
        FILTER (WHERE status = 'graded' AND score IS NOT NULL) AS avg_score,
      COUNT(*) FILTER (WHERE status IN ('graded','submitted'))
        / NULLIF(COUNT(*), 0)::REAL                    AS completion_rate
    FROM assignments WHERE deleted_at IS NULL
  )
SELECT * FROM student_stats, course_stats, assignment_stats;
```

The same principle applies to `grade-breakdown` (GROUP BY course_id) and student progress (`GROUP BY assignment.student_id`).

---

### 6b. Pagination design — cursor-based for all list endpoints

**Standard query parameters for all list endpoints:**

```
?limit=50           — page size, default 50, max 200
?cursor=<opaque>    — base64-encoded (id + created_at) for keyset pagination
?sort=created_at    — sort field
?order=desc         — sort direction
```

**Cursor pagination** (preferred over offset for production):
- Stable across concurrent inserts — no "row drift" when new records are inserted between pages
- Consistent O(log n) performance regardless of page number
- Opaque cursor encodes `{ id, created_at }` — prevents clients from constructing arbitrary cursors

**Offset pagination** (acceptable for admin-only lists with low row counts):
```
?page=1&limit=50
```

**Response envelope for paginated endpoints:**

```
{
  "data": [...],
  "pagination": {
    "limit": 50,
    "hasNextPage": true,
    "nextCursor": "eyJpZCI6MTAwLCJjcmVhdGVkQXQiOiIyMDI2..."}
  }
}
```

---

### 6c. ETag / Cache-Control strategy for React Query performance

**Design per endpoint type:**

| Endpoint Type | Cache-Control | ETag | React Query staleTime |
|---|---|---|---|
| Dashboard summary | `no-cache` | SHA-256 of result JSON | 30 seconds |
| Student list | `no-cache` | SHA-256 of list + latest `updated_at` | 60 seconds |
| Student detail | `no-cache` | SHA-256 of row | 120 seconds |
| Course list | `no-cache` | SHA-256 of list | 120 seconds |
| Notes list | `no-cache` | SHA-256 of list | 300 seconds |
| Auth/me | `no-store` | — | 0 (always fresh) |

`no-cache` instructs the browser to revalidate but allows 304 Not Modified responses when ETag matches — saving response body transfer for unchanged data.

---

### 6d. Standardised error response envelope

Authorization Design v1.0 covers auth errors (401, 403, 404). Extend this to all errors:

```
{
  "error": {
    "code":    "VALIDATION_ERROR",         — machine-readable constant
    "message": "due_date must be a date",  — human-readable
    "field":   "due_date",                 — optional, for validation errors
    "status":  422
  }
}
```

**Defined error codes:**

| Code | HTTP Status | Meaning |
|---|---|---|
| `UNAUTHORIZED` | 401 | No session / expired |
| `ACCOUNT_INACTIVE` | 401 | User is deactivated |
| `FORBIDDEN` | 403 | Authenticated but permission denied |
| `OWNERSHIP_DENIED` | 403 | Authenticated but row-level scope denied |
| `NOT_FOUND` | 404 | Resource does not exist |
| `VALIDATION_ERROR` | 422 | Zod / input validation failure |
| `CONFLICT` | 409 | Unique constraint violation |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

---

### 6e. Missing endpoints identified in review

| # | Method | Path | Purpose | Missing from |
|---|---|---|---|---|
| E1 | DELETE | `/api/students/:id` | Soft-delete a student | Architecture v1.0 marks as 🔲 — must include `deleted_at` set |
| E2 | GET | `/api/courses/:id/students` | List enrolled students for a course | Needed for teacher course detail view |
| E3 | POST | `/api/courses/:id/enrol` | Enrol a student in a course | Replaces JSON array mutation |
| E4 | DELETE | `/api/courses/:id/enrol/:studentId` | Drop a student from a course | Replaces JSON array mutation |
| E5 | GET | `/api/audit-log` | Admin audit trail | New — required for compliance |
| E6 | GET | `/api/students/:id/skill-profile` | Aggregated strengths/weaknesses by skill tag | New — AI readiness |
| E7 | POST | `/api/auth/login` | Rate-limit login attempts | Existing — needs guard |

---

## 7. Session & Auth Improvements

---

### 7a. Permission expansion — `manage` implies sub-permissions

**Current gap (F-15):** `users:manage` does not automatically include `users:read`.

**Corrected resolution algorithm at login:**

```
PERMISSION EXPANSION RULES (applied during login, before session write)
─────────────────────────────────────────────────────────────────────────────
If resolved set contains "users:manage"    → also add: users:read, users:create,
                                                        users:update, users:delete
If resolved set contains "students:manage" → also add: students:read, students:create,
                                                        students:update, students:delete
(... same pattern for each resource with a :manage permission)
─────────────────────────────────────────────────────────────────────────────
```

This expansion is applied in the login handler after fetching `role_permissions`. The expanded set is what gets stored in `session.permissions[]`.

---

### 7b. RBAC version check — solving stale session permissions (F-11)

**Corrected session lifecycle:**

```
LOGIN
  1. Resolve permissions from user_roles + role_permissions
  2. Apply manage expansion (7a)
  3. Read rbac_version.version from DB
  4. Store in session: { ..., permissions: [...], permissionsVersion: N }

PER-REQUEST (requirePermission middleware)
  1. Read cached rbac_version (in-process cache, 60-second TTL)
  2. Compare req.session.permissionsVersion against cached version
  3. If MATCH      → use req.session.permissions[] (no DB hit)
  4. If MISMATCH   → re-fetch user_roles + role_permissions for this user
                    → update req.session.permissions[] and permissionsVersion
                    → call req.session.save() to persist update
                    → continue with fresh permissions
```

The `rbac_version` table read is served from an in-process variable refreshed by a `setInterval` (60 seconds) — one DB query per minute instead of one per request.

---

### 7c. User deactivation — immediate enforcement

**Current design (gap):** Authorization Design v1.0 says: *"checks is_active at request time by comparing against a short-lived in-memory flag OR by re-querying users table once per session."* This is vague and the "once per session" option is insecure — a deactivated user can remain active for up to 8 hours.

**Corrected design:**

```
ON USER DEACTIVATION (admin action):
  1. Set users.is_active = FALSE
  2. DELETE FROM session WHERE sess->>'userId' = :userId::text
     (supported by connect-pg-simple — session table is queryable)
  3. Insert audit_log row: action='user.deactivated'

requireAuth MIDDLEWARE:
  1. Check req.session.userId exists → else 401
  2. Check req.session.isActive (cached in session) → if FALSE → 401
  3. Note: isActive in session is always TRUE (a deactivated user's session
     was deleted in step 2). This check is a safety net only.
```

Deleting the session row at deactivation time is the correct approach — it does not require per-request DB lookups and provides immediate enforcement.

---

### 7d. Login brute-force protection

**Design (not implementation):**

```
login_attempts
─────────────────────────────────────────────────────────────────────────────
Column           Type           Constraints
─────────────────────────────────────────────────────────────────────────────
id               BIGSERIAL      PRIMARY KEY
username         TEXT           NOT NULL
ip_address       TEXT           NOT NULL
attempted_at     TIMESTAMPTZ    NOT NULL  DEFAULT NOW()
success          BOOLEAN        NOT NULL
─────────────────────────────────────────────────────────────────────────────
INDEX: (username, attempted_at DESC)
INDEX: (ip_address, attempted_at DESC)
```

**Lock policy:**
- 5 consecutive failures on the same username within 15 minutes → lock account for 30 minutes
- 20 failures from the same IP within 15 minutes → rate-limit IP for 60 minutes
- Lock state is derived from a COUNT query on `login_attempts` — no separate lock column needed (avoids race condition)
- Successful login inserts a success row (resets the consecutive failure count)
- Rows older than 24 hours are purged by a scheduled task

---

### 7e. Session cookie hardening for IIS deployment

Current: `secure: false` (required for HTTP-only IIS deployment).

**Production checklist for IIS:**

| Setting | Current | Recommended |
|---|---|---|
| `secure` | false | false (HTTP-only IIS — acceptable, document explicitly) |
| `httpOnly` | true | true ✅ |
| `sameSite` | not set | `'lax'` — prevents CSRF on same-origin navigation |
| `maxAge` | 8h | 8h for teacher/admin; 4h for student/parent (shorter for minors) |
| `domain` | not set | Set to the IIS hostname to prevent subdomain leakage |

---

## 8. Final Production-Ready RBAC Architecture

This section consolidates the corrected design as a single reference, superseding the corresponding sections of RBAC Design v1.0 and Authorization Design v1.0.

---

### 8a. Complete table inventory

**Existing tables (retained, some modified):**

| Table | Status | Changes |
|---|---|---|
| `users` | Kept | `created_at`/`updated_at` → TIMESTAMPTZ |
| `session` | Kept | `sess` → JSONB |
| `students` | Modified | Add `user_id` (nullable FK), `created_by`, `deleted_at` |
| `courses` | Modified | Add `teacher_id` (FK), `created_by`, `deleted_at`. Deprecate `student_count` |
| `assignments` | Modified | Add FK constraints, `created_by`, `deleted_at`. `due_date` → TIMESTAMPTZ |
| `assessments` | Modified | Add FK constraints, `created_by`, `deleted_at` |
| `notes` | Modified | Add `created_by`, `deleted_at` |
| `activity` | Modified | Add `student_id`, `course_id` (nullable, no FK) |

**New RBAC tables:**

| Table | Purpose |
|---|---|
| `roles` | Role catalogue (admin, teacher, student, parent, guest) |
| `permissions` | 27+ permission keys |
| `role_permissions` | M:M role → permission grants |
| `user_roles` | M:M user → role grants with audit and expiry |
| `student_guardians` | M:M parent → student relationship |
| `rbac_version` | Single-row version counter for permission cache invalidation |

**New replacement table:**

| Table | Purpose |
|---|---|
| `course_enrollments` | Replaces `students.enrolled_course_ids` JSON array |

**New content/compliance tables:**

| Table | Purpose |
|---|---|
| `skill_tags` | Normalised skill taxonomy for AI |
| `assessment_skills` | M:M assessment → skill (replaces JSON strength/weakness arrays) |
| `ai_suggestions` | Persisted AI recommendations with feedback tracking |
| `audit_log` | Immutable compliance and change history |
| `login_attempts` | Brute-force detection |

**Total tables: 22** (8 existing + 12 new/replacement)

---

### 8b. Corrected session payload

```
Session (req.session) — production-ready
─────────────────────────────────────────────────────────────────────────────
Field                 Type        Notes
─────────────────────────────────────────────────────────────────────────────
userId                number      users.id — always present
username              string      For logging only
displayName           string      For UI header display
role                  string      Primary role shortcut (admin|teacher|student|parent|guest)
permissions           string[]    Fully expanded permission keys (manage→sub-perms included)
permissionsVersion    number      From rbac_version.version at login time
isActive              boolean     Always TRUE (deactivated users have no session)

[student only]
studentId             number      students.id linked to this user — NULL if unlinked
enrolledCourseIds     number[]    Loaded from course_enrollments at login

[parent only]
childStudentIds       number[]    Loaded from student_guardians at login
─────────────────────────────────────────────────────────────────────────────
```

---

### 8c. Corrected middleware stack

```
Request
   │
   ▼
[1]  pinoHttp                    — structured request logging
[2]  cors                        — CORS (origin: true, credentials: true)
[3]  express.json({ limit:'2mb'})— body parsing with explicit size cap
[4]  session()                   — restore session from PostgreSQL (JSONB)
   │
   ▼  Router
   │
   ├── PUBLIC (no auth)
   │     GET  /healthz
   │     POST /auth/login         ← loginRateLimiter applied here
   │     POST /auth/logout
   │     GET  /downloads/upgrade
   │     GET  /public/courses
   │
   ├── [5] requireAuth            ← userId present + isActive = TRUE
   │         │
   │         ├── [6] checkRbacVersion    ← compare permissionsVersion; re-fetch if stale
   │         │         │
   │         ├── [7] requirePermission() ← check permissions[] array
   │         │         │
   │         └── [8] requireOwnership() ← row-level scope for student/parent
   │                   │
   │                   └── Route handler
   │
   └── 404 → { error: { code: 'NOT_FOUND', ... } }
```

---

### 8d. AI recommendation data flow

For the AI feature to improve beyond today's "call OpenAI with a text blob" pattern, the data pipeline must be structured:

```
Teacher records assessment
         │
         ▼
Teacher tags strengths/weaknesses
with skill_tags vocabulary
         │
         ▼
assessment_skills rows created
(student_id, skill_tag_id, signal='weakness')
         │
         ▼
GET /api/students/:id/skill-profile
aggregates: skill_tag → weakness_count, improvement_trend
         │
         ▼
POST /api/students/:id/ai-suggestions
sends structured skill profile to OpenAI (not raw text)
         │
         ▼
AI response persisted to ai_suggestions
with prompt_version, model
         │
         ▼
Teacher marks suggestion as 'accepted' or 'dismissed'
         │
         ▼
Feedback stored in ai_suggestions.status
→ future: fine-tune prompt or model weighting
```

---

### 8e. Summary of design document corrections

| Document | Section | Correction Required |
|---|---|---|
| Architecture v1.0 | §5 — DB Schema | `enrolled_course_ids` replaced; FKs added; `teacher_name` → `teacher_id`; `due_date` type fix; `student_count` deprecated; `deleted_at` added; `created_by` added |
| Architecture v1.0 | §5 — DB Schema | `users` timestamps → TIMESTAMPTZ; `session.sess` → JSONB |
| Architecture v1.0 | §5 — DB Schema | `activity` table gets `student_id`, `course_id` columns |
| RBAC Design v1.0 | §5a — `user_roles` | Surrogate PK; partial unique index for active grants |
| RBAC Design v1.0 | §5b — `students` | Partial UNIQUE index on `user_id WHERE NOT NULL` |
| Authorization v1.0 | §2a — Session | Add `permissionsVersion`; document manage→sub-perm expansion |
| Authorization v1.0 | §2c — Lifecycle | Deactivation deletes session rows immediately |
| Authorization v1.0 | §3 — Middleware | Add `checkRbacVersion` layer; add `loginRateLimiter` |
| Authorization v1.0 | §6 — Row-Level | Scope queries now use `course_enrollments` (not JSON unnest) |

---

*This Architecture Review Report supersedes and extends the three v1.0 design documents. All Phase 2 implementation work should use this document as the authoritative reference for schema, auth, and API design.*
