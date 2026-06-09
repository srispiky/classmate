# Classmate Connect — Phase 2 Sprint 3: Row-Level Security

> **Source of truth:** Architecture v1.0 · RBAC Design v1.0 · API Auth Design v1.0 · Architecture Review v1.0 · Sprint 1 (approved) · Sprint 2 (approved)
> **Sprint:** Phase 2 · Sprint 3
> **Version:** 1.0
> **Date:** June 2026
> **Architect role:** Senior .NET Solution Architect (patterns mapped to Node.js 24 + Express 5 + TypeScript 5.9)
> **Pre-requisite:** Sprint 1 and Sprint 2 complete and verified
> **Status:** AWAITING APPROVAL — do not begin code generation until this document is signed off

---

## Table of Contents

1. [Sprint Scope & Exit Criteria](#1-sprint-scope--exit-criteria)
2. [Row-Level Security Model](#2-row-level-security-model)
3. [Data Access Design](#3-data-access-design)
4. [Ownership & Scope Rules](#4-ownership--scope-rules)
5. [Sequence Diagrams](#5-sequence-diagrams)
6. [Query Patterns](#6-query-patterns)
7. [course_enrollments Migration](#7-course_enrollments-migration)
8. [Security Review](#8-security-review)
9. [Performance Considerations](#9-performance-considerations)
10. [Risks & Mitigations](#10-risks--mitigations)
11. [Sprint 3 Completion Criteria](#11-sprint-3-completion-criteria)

---

## 1. Sprint Scope & Exit Criteria

### What Sprint 3 delivers

Sprint 3 delivers the **row-level data isolation layer** — the query-side enforcement that ensures each role can only read the rows they are authorised for. It also delivers the `course_enrollments` table migration (Architecture Review F-01) and the student/parent portal API routes.

| Deliverable | Description |
|---|---|
| `ScopeContext` type | Extracted from `req.session` at route entry. Passed to query-builder functions. Replaces direct session reads inside queries. |
| `ScopeFilter` query strategy | Per-resource, per-role WHERE clause patterns for all list and detail endpoints |
| Updated list handlers | All list routes apply scope-aware WHERE filters based on `ScopeContext` |
| Updated detail handlers | All `GET /:id` routes confirm ownership after fetch (defence layer 2) |
| `course_enrollments` migration | Replaces `students.enrolled_course_ids` JSON array. One migration step, no DDL on existing columns. |
| Updated `SessionEnricherService` | Reads enrolled course IDs from `course_enrollments` instead of JSON array |
| Student portal routes | `GET /api/student/dashboard`, `/api/student/subjects`, `/api/student/subjects/:courseId`, `/api/student/assignments`, `/api/student/assessments` |
| Parent portal routes | `GET /api/parent/dashboard`, `/api/parent/children`, `/api/parent/children/:studentId`, `/api/parent/children/:studentId/assignments`, `/api/parent/children/:studentId/assessments` |

### What Sprint 3 does NOT deliver

- No admin user management UI routes (Sprint 4)
- No `audit_log` writes (Sprint 4)
- No `skill_tags` / `assessment_skills` tables (Sprint 4 — AI readiness)
- No frontend route guards (Sprint 4 — frontend work)
- No teacher-scoped course filtering by `teacher_id` (Sprint 4 — requires teacher login accounts)

### Exit criteria

1. A student authenticated with `studentId = 5` receives only their own assignments from `GET /api/assignments`
2. A parent with `childStudentIds = [7, 12]` receives only assignments for students 7 and 12 from `GET /api/assignments`
3. A student cannot access `GET /api/students` (403)
4. A parent cannot write to any endpoint (403 on all POST/PATCH/DELETE)
5. `GET /api/student/subjects` returns only enrolled courses for the authenticated student
6. `course_enrollments` table exists and `SessionEnricher` reads from it
7. `students.enrolled_course_ids` JSON column still present (deprecated, not dropped)
8. All existing admin and teacher tests from Sprint 2 continue to pass
9. `pnpm run typecheck` passes with zero errors

---

## 2. Row-Level Security Model

### 2a. Defence-in-depth architecture

Row-level security is enforced at **three independent layers**. A bypass at any one layer is caught by the next.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    THREE-LAYER DEFENCE MODEL                                 │
│                                                                              │
│  LAYER 1 — HTTP Gate (Sprint 2)                                             │
│  ──────────────────────────────────────────────────────────────────────     │
│  requireAuth + requirePermission + requireOwnership (middleware)             │
│  → Blocks the request before any DB query runs                              │
│  → Enforces: does this user have the permission for this resource?           │
│  → For /:id routes: does the resource's student_id match the session?       │
│  → Responds 401 or 403 — no data leakage                                   │
│                                                                              │
│  LAYER 2 — Query Filter (Sprint 3)                                          │
│  ──────────────────────────────────────────────────────────────────────     │
│  ScopeFilter applied to every SELECT in list and detail handlers            │
│  → Adds WHERE clauses derived from ScopeContext (session values)            │
│  → Even if Layer 1 is bypassed, the query returns only authorised rows      │
│  → Admin/Teacher: no filter added (global scope)                            │
│  → Student: WHERE student_id = :studentId                                   │
│  → Parent:  WHERE student_id = ANY(:childStudentIds)                        │
│                                                                              │
│  LAYER 3 — Post-Fetch Ownership Check (Sprint 3)                           │
│  ──────────────────────────────────────────────────────────────────────     │
│  After fetching a single resource by :id, verify ownership before return   │
│  → Final safety net: if DB query somehow returns a non-authorised row,     │
│    ownership check catches it before serialisation                          │
│  → Responds 403 OWNERSHIP_DENIED — no data returned                        │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2b. Scope classification per role

| Role | Scope type | SQL strategy |
|---|---|---|
| `admin` | **Global** | No WHERE filter added |
| `teacher` | **Global** | No WHERE filter added (Sprint 4: optionally scoped to `teacher_id`) |
| `student` | **Identity-scoped** | `WHERE student_id = :session.studentId` |
| `parent` | **Relationship-scoped** | `WHERE student_id = ANY(:session.childStudentIds)` |
| `guest` | **Public-only** | Only `/api/public/courses` accessible — all others blocked at Layer 1 |

### 2c. Resource classification by scope mechanism

Not all resources scope the same way. The table below classifies every resource by how its scope is applied:

| Resource | Scope mechanism | Scope field |
|---|---|---|
| `students` (detail) | Direct ID match | `students.id` vs `session.studentId` |
| `students` (list) | Identity or relationship | `id = :studentId` or `id = ANY(:childStudentIds)` |
| `assignments` | Student FK | `assignments.student_id` |
| `assessments` | Student FK | `assessments.student_id` |
| `notes` | Course FK | `notes.course_id` — scope via enrolled courses |
| `courses` (detail) | Enrollment check | `course_enrollments.student_id` join |
| `courses` (list) | Enrollment join | JOIN `course_enrollments` WHERE `student_id = ...` |
| `activity` | Student ID column | `activity.student_id` (added Sprint 1) |
| `dashboard` | Role gate only | Not scoped — teacher dashboard; student/parent use portal routes |

---

## 3. Data Access Design

### 3a. `ScopeContext` — the authorisation contract for queries

`ScopeContext` is a typed object extracted from `req.session` at the start of each route handler. It is the **only** way query-building functions receive authorisation data. Route handlers must not read `req.session` directly inside query logic.

**Why a `ScopeContext` object instead of passing session directly:**
- Testable: query-builder functions can be unit-tested by passing a `ScopeContext` without a real request
- Auditable: the scope boundary is explicit and typed — no hidden session field reads buried in query logic
- Future-proof: switching from session to JWT requires only changing `ScopeContext` construction, not every query function

```
ScopeContext (TypeScript type — not code)
─────────────────────────────────────────────────────────────────────────────
Field                Type              Description
─────────────────────────────────────────────────────────────────────────────
role                 RoleKey           'admin' | 'teacher' | 'student' | 'parent'
isGlobal             boolean           true for admin and teacher — skip all filters
studentId            number | null     set for student role only; null if unlinked
enrolledCourseIds    number[]          set for student role only; [] if none
childStudentIds      number[]          set for parent role only; [] if no children
userId               number            always set — the authenticated user's ID
─────────────────────────────────────────────────────────────────────────────
```

**`ScopeContext` construction logic (from session):**

```
buildScopeContext(session: ClassmateSession): ScopeContext
  isGlobal = session.role === 'admin' || session.role === 'teacher'

  return {
    role:             session.role,
    isGlobal,
    studentId:        session.role === 'student' ? session.studentId ?? null : null,
    enrolledCourseIds:session.role === 'student' ? session.enrolledCourseIds ?? [] : [],
    childStudentIds:  session.role === 'parent'  ? session.childStudentIds ?? [] : [],
    userId:           session.userId,
  }
```

`buildScopeContext` is a pure function — no DB access, no side effects. Called once per request at route handler entry.

---

### 3b. Query-builder function design

Each resource module exposes a set of query-builder functions that accept a `ScopeContext` and return a Drizzle query with the correct WHERE clauses applied. Route handlers call these functions, not raw Drizzle queries.

**Design contract:**

```
// Pattern — list query
listAssignments(scope: ScopeContext, filters: AssignmentFilters): Promise<Assignment[]>
  if scope.isGlobal: return all matching filters
  if scope.role === 'student':
    add WHERE assignments.student_id = scope.studentId
  if scope.role === 'parent':
    add WHERE assignments.student_id = ANY(scope.childStudentIds)

// Pattern — detail query
getAssignment(id: number, scope: ScopeContext): Promise<Assignment | null>
  fetch row by id
  if scope.isGlobal: return row (or null if not found)
  apply ownership check (Layer 3):
    if row.student_id does not match scope → return null (caller 404s or 403s)
```

The choice between returning `null` (→ 404) vs throwing an authorisation error (→ 403) for detail queries is discussed in Security Review Section 8b.

---

### 3c. Handler structure — consistent pattern

Every route handler follows this structure:

```
ROUTE HANDLER PATTERN (descriptive — not code)
─────────────────────────────────────────────────────────────────────────────
1. const scope = buildScopeContext(req.session)
   // Extracts ScopeContext once per request

2. Validate and parse request inputs (Zod)
   // Fail fast on malformed input — before any DB query

3. Call query-builder function with (scope, parsedInput)
   // Query-builder applies WHERE filters internally

4. [For POST/PATCH/DELETE] — verify the resource belongs to the requester's scope
   // Prevents teachers from accidentally modifying other institutions' data (future)
   // For now: admin and teacher are global — this check is a future-proofing hook

5. Serialize and return response
   // Never return raw DB rows — map to response DTO
─────────────────────────────────────────────────────────────────────────────
```

---

## 4. Ownership & Scope Rules

### 4a. Student ownership rules

A student may access a resource if and only if:

```
STUDENT OWNERSHIP RULES
─────────────────────────────────────────────────────────────────────────────
Resource         Access condition
─────────────────────────────────────────────────────────────────────────────
students         record.id === session.studentId
                 (can only view own profile)

assignments      record.student_id === session.studentId

assessments      record.student_id === session.studentId

notes            notes.course_id ∈ session.enrolledCourseIds
                 (can read notes for enrolled courses only)

courses          courses.id ∈ session.enrolledCourseIds
                 (can view enrolled courses only)

ai-suggestions   student_id === session.studentId

activity         activity.student_id === session.studentId
                 (student sees only their own activity)
─────────────────────────────────────────────────────────────────────────────
```

**Edge case — unlinked student account:**

If `session.studentId` is `null` (a login account exists but has not been linked to a student record by an admin):

| Endpoint | Behaviour |
|---|---|
| `GET /api/students/:id` | 403 OWNERSHIP_DENIED (no studentId means no match) |
| `GET /api/assignments` | Returns empty list (no student_id to filter on) |
| `GET /api/student/dashboard` | Returns a "not yet enrolled" state (zero data, explicit message) |
| All write endpoints | 403 — students have no write permissions regardless |

**Edge case — student enrolled in zero courses:**

If `session.enrolledCourseIds` is `[]`:

| Endpoint | Behaviour |
|---|---|
| `GET /api/courses` | Returns empty list |
| `GET /api/notes` | Returns empty list |
| `GET /api/student/subjects` | Returns empty list |

---

### 4b. Parent-child access rules

A parent may access a resource if and only if:

```
PARENT ACCESS RULES
─────────────────────────────────────────────────────────────────────────────
Resource         Access condition
─────────────────────────────────────────────────────────────────────────────
students         record.id ∈ session.childStudentIds
                 (can view profiles of their children only)

assignments      record.student_id ∈ session.childStudentIds

assessments      record.student_id ∈ session.childStudentIds

notes            notes.course_id ∈ enrolled courses of ANY child
                 i.e. course_enrollments WHERE student_id = ANY(childStudentIds)

courses          course enrolled by ANY child
                 i.e. JOIN course_enrollments WHERE student_id = ANY(childStudentIds)

ai-suggestions   student_id ∈ session.childStudentIds

activity         activity.student_id ∈ session.childStudentIds
─────────────────────────────────────────────────────────────────────────────
```

**Parent write restrictions:**

Parents have NO write permissions in the permission matrix. All POST, PATCH, and DELETE requests from a parent session are blocked at Layer 1 (`requirePermission` returns 403 before any query runs). This is enforced by the permission matrix, not by query filters.

**Edge case — parent with no linked children:**

If `session.childStudentIds` is `[]` (guardian records not yet created by admin):

| Endpoint | Behaviour |
|---|---|
| `GET /api/assignments` | Returns empty list |
| `GET /api/parent/children` | Returns empty list with "no children linked" status |
| All scoped detail routes | 403 OWNERSHIP_DENIED (empty array never contains any ID) |

**Edge case — parent whose child is deactivated:**

The child's `student_id` remains in `childStudentIds` in the session. The query filter applies it. Routes continue to work if the student record has `deleted_at IS NULL`. If the student record is soft-deleted, the query returns no results — not an error.

---

### 4c. Teacher access rules

Teachers have **global read/write access** to all academic content. No row-level filtering is applied to teacher queries.

```
TEACHER ACCESS RULES
─────────────────────────────────────────────────────────────────────────────
Scope type:      Global
Filter applied:  None — scope.isGlobal = true
Write access:    Full CRUD on students, courses, assignments,
                 assessments, notes
Exceptions:      Cannot access /api/admin/* (no users:manage permission)
                 Cannot delete assessments (no assessments:delete permission)
                 Cannot delete courses (no courses:delete permission)
─────────────────────────────────────────────────────────────────────────────
```

**Sprint 4 note — teacher course ownership:**

The `courses.teacher_id` column (Architecture Review F-02) enables future scoping: *"a teacher can only edit courses they own"*. This is a Sprint 4 concern. In Sprint 3, all teachers have full course edit access. The `created_by` column (Architecture Review F-14) is similarly deferred.

---

### 4d. Admin access rules

Admins have **full global access** to all resources and all operations.

```
ADMIN ACCESS RULES
─────────────────────────────────────────────────────────────────────────────
Scope type:      Global + Administrative
Filter applied:  None — scope.isGlobal = true
Write access:    Full CRUD on all tables
Exclusive access:/api/admin/* routes (requireRole('admin'))
                 User management, role assignments, guardian links
─────────────────────────────────────────────────────────────────────────────
```

---

## 5. Sequence Diagrams

### 5a. Student — filtered assignment list

```
Client        requireOwnership   StudentsRouter     AssignmentsQueryBuilder    DB
  │                 │                 │                      │                  │
  │ GET /api/assignments              │                      │                  │
  │ session: { role:'student',        │                      │                  │
  │            studentId: 5,          │                      │                  │
  │            enrolledCourseIds:[1,3]}                       │                  │
  │─────────────────────────────────►│                      │                  │
  │                 │                 │                      │                  │
  │    [requireAuth ✅, checkRbacVersion ✅, requirePermission('assignments:read') ✅]
  │                 │                 │                      │                  │
  │                 │                 │ buildScopeContext(session)              │
  │                 │                 │ → { isGlobal: false,                   │
  │                 │                 │     role: 'student', studentId: 5 }    │
  │                 │                 │                      │                  │
  │                 │                 │ listAssignments(scope, filters)         │
  │                 │                 │─────────────────────►│                 │
  │                 │                 │                      │                  │
  │                 │                 │                      │ SELECT a.*       │
  │                 │                 │                      │ FROM assignments a│
  │                 │                 │                      │ WHERE a.student_id = 5
  │                 │                 │                      │ AND a.deleted_at IS NULL
  │                 │                 │                      │─────────────────►│
  │                 │                 │                      │◄─────────────────│
  │                 │                 │                      │ [{id:10,student_id:5,...}]
  │                 │                 │◄─────────────────────│                 │
  │◄─────────────────────────────────│                      │                 │
  │ 200 [{ id:10, title:..., ... }]   │                      │                  │
  │ (only student 5's assignments)    │                      │                  │
```

---

### 5b. Parent — accessing child's assessment detail

```
Client       requirePermission   requireOwnership   Handler          DB
  │               │                    │              │               │
  │ GET /api/assessments/88            │              │               │
  │ session: { role:'parent',          │              │               │
  │            childStudentIds:[7,12]} │              │               │
  │───────────────►│                  │              │               │
  │                │ ✅ assessments:read              │               │
  │                │───────────────────►              │               │
  │                │                   │ resolver(req)│               │
  │                │                   │ SELECT student_id            │
  │                │                   │ FROM assessments WHERE id=88 │
  │                │                   │─────────────────────────────►│
  │                │                   │◄─────────────────────────────│
  │                │                   │ {student_id: 7}              │
  │                │                   │              │               │
  │                │                   │ role='parent'│               │
  │                │                   │ 7 ∈ [7,12]? ✅               │
  │                │                   │──────────────►               │
  │                │                   │              │               │
  │                │                   │    Layer 2 (query filter):   │
  │                │                   │    buildScopeContext(session) │
  │                │                   │    scope = { isGlobal:false, │
  │                │                   │      childStudentIds:[7,12]} │
  │                │                   │              │               │
  │                │                   │    getAssessment(88, scope)  │
  │                │                   │              │               │
  │                │                   │              │ SELECT * FROM assessments
  │                │                   │              │ WHERE id = 88
  │                │                   │              │ AND deleted_at IS NULL
  │                │                   │              │──────────────►│
  │                │                   │              │◄──────────────│
  │                │                   │              │ {id:88,student_id:7,...}
  │                │                   │              │               │
  │                │                   │    Layer 3 (post-fetch check):
  │                │                   │    7 ∈ [7,12]? ✅            │
  │◄──────────────────────────────────────────────────│               │
  │ 200 {assessment...}                │              │               │
```

---

### 5c. IDOR attack — student attempting to access another student's assessment

```
Client       requirePermission   requireOwnership   Handler
  │               │                    │              │
  │ GET /api/assessments/99            │              │
  │ session: { role:'student',         │              │
  │            studentId: 5 }          │              │
  │───────────────►│                  │              │
  │                │ ✅ assessments:read              │
  │                │───────────────────►              │
  │                │                   │ resolver(req)│
  │                │                   │ → student_id = 9
  │                │                   │ (assessment 99 belongs to student 9)
  │                │                   │              │
  │                │                   │ role='student'│
  │                │                   │ 9 === 5?  ❌  │
  │◄──────────────────────────────────│              │
  │ 403 { error: { code: 'OWNERSHIP_DENIED', status: 403 } }
  │ (no DB query runs for the assessment data — stopped at Layer 1)
```

---

### 5d. Parent — accessing child's course notes (course-scoped resource)

```
Client       requirePermission   NotesRouter    NotesQueryBuilder     DB
  │               │                 │                  │               │
  │ GET /api/notes                  │                  │               │
  │ session: { role:'parent',       │                  │               │
  │            childStudentIds:[7,12] }                │               │
  │───────────────►│                │                  │               │
  │                │ ✅ notes:read   │                  │               │
  │                │────────────────►                  │               │
  │                │                │ buildScopeContext(session)       │
  │                │                │ scope = {         │               │
  │                │                │   isGlobal: false,│               │
  │                │                │   role: 'parent', │               │
  │                │                │   childStudentIds: [7,12] }       │
  │                │                │                  │               │
  │                │                │ listNotes(scope)  │               │
  │                │                │─────────────────►│               │
  │                │                │                  │               │
  │                │                │                  │ SELECT DISTINCT ce.course_id
  │                │                │                  │ FROM course_enrollments ce
  │                │                │                  │ WHERE ce.student_id = ANY([7,12])
  │                │                │                  │ AND ce.is_active = TRUE
  │                │                │                  │──────────────►│
  │                │                │                  │◄──────────────│
  │                │                │                  │ [course_id: 3, course_id: 5]
  │                │                │                  │               │
  │                │                │                  │ SELECT n.* FROM notes n
  │                │                │                  │ WHERE n.course_id = ANY([3,5])
  │                │                │                  │ AND n.deleted_at IS NULL
  │                │                │                  │──────────────►│
  │                │                │                  │◄──────────────│
  │◄─────────────────────────────────────────────────────────────────────
  │ 200 [{notes for courses 3 and 5...}]               │               │
```

---

### 5e. Student portal — `/api/student/subjects`

```
Client         requireRole      StudentPortalRouter   CourseQueryBuilder     DB
  │                │                   │                    │                 │
  │ GET /api/student/subjects          │                    │                 │
  │ session: { role:'student',         │                    │                 │
  │            studentId: 5,           │                    │                 │
  │            enrolledCourseIds: [1,3]}                     │                 │
  │───────────────►│                  │                    │                 │
  │                │ role='student' ✅  │                    │                 │
  │                │───────────────────►                    │                 │
  │                │                   │ buildScopeContext  │                 │
  │                │                   │ scope = {          │                 │
  │                │                   │   isGlobal: false, │                 │
  │                │                   │   studentId: 5,    │                 │
  │                │                   │   enrolledCourseIds:[1,3] }          │
  │                │                   │                    │                 │
  │                │                   │ getStudentSubjects(scope)            │
  │                │                   │────────────────────►                │
  │                │                   │                    │                 │
  │                │                   │                    │ SELECT c.*,     │
  │                │                   │                    │   ce.enrolled_at,
  │                │                   │                    │   COUNT(DISTINCT a.id) FILTER (WHERE a.status='graded') AS graded_count,
  │                │                   │                    │   COUNT(DISTINCT a.id) AS total_assignments,
  │                │                   │                    │   ROUND(AVG(a.score / a.max_score * 100) FILTER (WHERE a.status='graded'), 1) AS avg_score
  │                │                   │                    │ FROM courses c
  │                │                   │                    │ JOIN course_enrollments ce ON ce.course_id = c.id
  │                │                   │                    │   AND ce.student_id = 5
  │                │                   │                    │   AND ce.is_active = TRUE
  │                │                   │                    │ LEFT JOIN assignments a ON a.course_id = c.id
  │                │                   │                    │   AND a.student_id = 5
  │                │                   │                    │   AND a.deleted_at IS NULL
  │                │                   │                    │ WHERE c.deleted_at IS NULL
  │                │                   │                    │ GROUP BY c.id, ce.enrolled_at
  │                │                   │                    │──────────────►  │
  │                │                   │                    │◄──────────────  │
  │◄──────────────────────────────────────────────────────────────────────────│
  │ 200 [{ id, name, subject, enrolledAt, avgScore, gradedCount, totalAssignments }]
```

---

### 5f. Teacher — unrestricted global list (no scope filter)

```
Client       requirePermission   AssignmentsRouter   AssignmentsQueryBuilder    DB
  │               │                    │                      │                  │
  │ GET /api/assignments               │                      │                  │
  │ session: { role:'teacher' }        │                      │                  │
  │───────────────►│                  │                      │                  │
  │                │ ✅ assignments:read                       │                  │
  │                │────────────────────►                     │                 │
  │                │                    │ buildScopeContext    │                 │
  │                │                    │ scope = { isGlobal: true }             │
  │                │                    │                      │                 │
  │                │                    │ listAssignments(scope, {})             │
  │                │                    │──────────────────────►                │
  │                │                    │                      │                 │
  │                │                    │         scope.isGlobal = true         │
  │                │                    │         → NO WHERE added on student_id │
  │                │                    │                      │                 │
  │                │                    │                      │ SELECT a.*      │
  │                │                    │                      │ FROM assignments a
  │                │                    │                      │ WHERE a.deleted_at IS NULL
  │                │                    │                      │ [+ pagination]  │
  │                │                    │                      │────────────────►│
  │                │                    │                      │◄────────────────│
  │◄──────────────────────────────────────────────────────────────────────────── │
  │ 200 [{all assignments, paginated}]  │                      │                 │
```

---

## 6. Query Patterns

### 6a. Pattern notation

```
GLOBAL      = scope.isGlobal === true — no scope filter added
STUDENT_ID  = WHERE resource.student_id = :scope.studentId
PARENT_IDS  = WHERE resource.student_id = ANY(:scope.childStudentIds)
ENROLLED    = WHERE resource.course_id = ANY(:scope.enrolledCourseIds)
CHILD_ENROLLED = WHERE resource.course_id IN (
                   SELECT DISTINCT course_id FROM course_enrollments
                   WHERE student_id = ANY(:scope.childStudentIds)
                   AND is_active = TRUE
                 )
SOFT_DELETE = AND resource.deleted_at IS NULL   (always applied)
```

---

### 6b. `students` table queries

#### List: `GET /api/students`

| Role | Applied filter | Notes |
|---|---|---|
| admin | `GLOBAL` | All students returned |
| teacher | `GLOBAL` | All students returned |
| student | `WHERE id = :scope.studentId` | Returns array of 0 or 1 student |
| parent | `WHERE id = ANY(:scope.childStudentIds)` | Returns only linked children |

**Full query shape (student role):**
```sql
SELECT s.*
FROM students s
WHERE s.id = :studentId
  AND s.deleted_at IS NULL
ORDER BY s.name ASC
LIMIT :limit OFFSET :offset;
```

**Full query shape (parent role):**
```sql
SELECT s.*
FROM students s
WHERE s.id = ANY(:childStudentIds)
  AND s.deleted_at IS NULL
ORDER BY s.name ASC;
-- No pagination needed — parent has at most a handful of children
```

#### Detail: `GET /api/students/:id`

```sql
-- Fetch
SELECT s.*
FROM students s
WHERE s.id = :id
  AND s.deleted_at IS NULL;

-- Layer 3 post-fetch ownership check (application layer):
-- admin/teacher: skip
-- student: row.id === scope.studentId ? proceed : 403
-- parent:  scope.childStudentIds.includes(row.id) ? proceed : 403
```

---

### 6c. `assignments` table queries

#### List: `GET /api/assignments`

```sql
-- admin / teacher (GLOBAL):
SELECT a.*, s.name AS student_name, c.name AS course_name
FROM assignments a
JOIN students s ON s.id = a.student_id AND s.deleted_at IS NULL
JOIN courses c  ON c.id = a.course_id  AND c.deleted_at IS NULL
WHERE a.deleted_at IS NULL
  [AND a.status = :statusFilter]       -- optional filter
  [AND a.course_id = :courseIdFilter]  -- optional filter
ORDER BY a.created_at DESC
LIMIT :limit OFFSET :offset;

-- student (STUDENT_ID):
SELECT a.*, s.name AS student_name, c.name AS course_name
FROM assignments a
JOIN students s ON s.id = a.student_id AND s.deleted_at IS NULL
JOIN courses c  ON c.id = a.course_id  AND c.deleted_at IS NULL
WHERE a.student_id = :scope.studentId     -- ← scope filter
  AND a.deleted_at IS NULL
  [AND a.status = :statusFilter]
ORDER BY a.due_date ASC                   -- student view: sort by due date
LIMIT :limit OFFSET :offset;

-- parent (PARENT_IDS):
SELECT a.*, s.name AS student_name, c.name AS course_name
FROM assignments a
JOIN students s ON s.id = a.student_id AND s.deleted_at IS NULL
JOIN courses c  ON c.id = a.course_id  AND c.deleted_at IS NULL
WHERE a.student_id = ANY(:scope.childStudentIds)  -- ← scope filter
  AND a.deleted_at IS NULL
  [AND a.student_id = :childFilter]   -- parent may filter to one child
  [AND a.status = :statusFilter]
ORDER BY a.due_date ASC, s.name ASC
LIMIT :limit OFFSET :offset;
```

#### Detail: `GET /api/assignments/:id`

```sql
SELECT a.*, s.name AS student_name, c.name AS course_name
FROM assignments a
JOIN students s ON s.id = a.student_id
JOIN courses c  ON c.id = a.course_id
WHERE a.id = :id
  AND a.deleted_at IS NULL;

-- Post-fetch ownership (Layer 3):
-- student: row.student_id === scope.studentId
-- parent:  scope.childStudentIds.includes(row.student_id)
```

---

### 6d. `assessments` table queries

#### List: `GET /api/assessments`

```sql
-- admin / teacher (GLOBAL):
SELECT ae.*, s.name AS student_name, c.name AS course_name
FROM assessments ae
JOIN students s ON s.id = ae.student_id AND s.deleted_at IS NULL
JOIN courses c  ON c.id = ae.course_id  AND c.deleted_at IS NULL
WHERE ae.deleted_at IS NULL
  [AND ae.student_id = :studentFilter]
  [AND ae.course_id  = :courseFilter]
ORDER BY ae.created_at DESC
LIMIT :limit OFFSET :offset;

-- student (STUDENT_ID):
SELECT ae.*, c.name AS course_name
FROM assessments ae
JOIN courses c ON c.id = ae.course_id AND c.deleted_at IS NULL
WHERE ae.student_id = :scope.studentId
  AND ae.deleted_at IS NULL
ORDER BY ae.created_at DESC
LIMIT :limit OFFSET :offset;

-- parent (PARENT_IDS):
SELECT ae.*, s.name AS student_name, c.name AS course_name
FROM assessments ae
JOIN students s ON s.id = ae.student_id AND s.deleted_at IS NULL
JOIN courses c  ON c.id = ae.course_id  AND c.deleted_at IS NULL
WHERE ae.student_id = ANY(:scope.childStudentIds)
  AND ae.deleted_at IS NULL
  [AND ae.student_id = :childFilter]
ORDER BY ae.created_at DESC, s.name ASC
LIMIT :limit OFFSET :offset;
```

---

### 6e. `notes` table queries

Notes are course-scoped, not student-scoped. The scope filter operates on `course_id` via enrollment.

#### List: `GET /api/notes`

```sql
-- admin / teacher (GLOBAL):
SELECT n.*, c.name AS course_name
FROM notes n
JOIN courses c ON c.id = n.course_id AND c.deleted_at IS NULL
WHERE n.deleted_at IS NULL
  [AND n.course_id = :courseFilter]
ORDER BY n.created_at DESC
LIMIT :limit OFFSET :offset;

-- student (ENROLLED):
SELECT n.*, c.name AS course_name
FROM notes n
JOIN courses c ON c.id = n.course_id AND c.deleted_at IS NULL
WHERE n.course_id = ANY(:scope.enrolledCourseIds)
  AND n.deleted_at IS NULL
ORDER BY n.created_at DESC
LIMIT :limit OFFSET :offset;

-- parent (CHILD_ENROLLED):
SELECT n.*, c.name AS course_name
FROM notes n
JOIN courses c ON c.id = n.course_id AND c.deleted_at IS NULL
WHERE n.course_id IN (
  SELECT DISTINCT ce.course_id
  FROM course_enrollments ce
  WHERE ce.student_id = ANY(:scope.childStudentIds)
    AND ce.is_active = TRUE
)
AND n.deleted_at IS NULL
ORDER BY n.created_at DESC
LIMIT :limit OFFSET :offset;
```

**Notes detail check (Layer 3):**  
For `GET /api/notes/:id` — after fetching, confirm `note.course_id ∈ scope.enrolledCourseIds` (student) or `note.course_id ∈ childrensCourseIds` (parent, requires one join).

---

### 6f. `courses` table queries

#### List: `GET /api/courses`

```sql
-- admin / teacher (GLOBAL):
SELECT c.*,
  COUNT(DISTINCT ce.student_id) FILTER (WHERE ce.is_active = TRUE) AS student_count
FROM courses c
LEFT JOIN course_enrollments ce ON ce.course_id = c.id
WHERE c.deleted_at IS NULL
GROUP BY c.id
ORDER BY c.name ASC
LIMIT :limit OFFSET :offset;

-- student (enrolled courses only):
SELECT c.*,
  ce.enrolled_at
FROM courses c
JOIN course_enrollments ce
  ON ce.course_id = c.id
  AND ce.student_id = :scope.studentId
  AND ce.is_active = TRUE
WHERE c.deleted_at IS NULL
ORDER BY c.name ASC;

-- parent (child-enrolled courses):
SELECT DISTINCT c.*
FROM courses c
JOIN course_enrollments ce
  ON ce.course_id = c.id
  AND ce.student_id = ANY(:scope.childStudentIds)
  AND ce.is_active = TRUE
WHERE c.deleted_at IS NULL
ORDER BY c.name ASC;
```

---

### 6g. Activity feed queries

```sql
-- admin / teacher (dashboard feed — global):
SELECT act.*
FROM activity act
WHERE act.timestamp > NOW() - INTERVAL '30 days'
ORDER BY act.timestamp DESC
LIMIT 20;

-- parent (child activity only):
SELECT act.*
FROM activity act
WHERE act.student_id = ANY(:scope.childStudentIds)
  AND act.timestamp > NOW() - INTERVAL '30 days'
ORDER BY act.timestamp DESC
LIMIT 20;
```

---

### 6h. Student portal queries — `/api/student/*`

#### `GET /api/student/dashboard`

Single CTE returning the student's complete overview:

```sql
WITH
  enrolled AS (
    SELECT c.id AS course_id, c.name AS course_name
    FROM course_enrollments ce
    JOIN courses c ON c.id = ce.course_id
    WHERE ce.student_id = :studentId
      AND ce.is_active = TRUE
      AND c.deleted_at IS NULL
  ),
  assignment_stats AS (
    SELECT
      COUNT(*) FILTER (WHERE status = 'graded')   AS graded,
      COUNT(*) FILTER (WHERE status = 'pending')   AS pending,
      COUNT(*) FILTER (WHERE status = 'late')      AS late,
      COUNT(*) FILTER (WHERE status = 'submitted') AS submitted,
      ROUND(AVG(score / max_score * 100) FILTER (WHERE status = 'graded'), 1) AS avg_score
    FROM assignments
    WHERE student_id = :studentId
      AND deleted_at IS NULL
  ),
  upcoming AS (
    SELECT id, title, due_date, course_id
    FROM assignments
    WHERE student_id = :studentId
      AND status IN ('pending', 'submitted')
      AND due_date >= NOW()
      AND deleted_at IS NULL
    ORDER BY due_date ASC
    LIMIT 5
  ),
  recent_assessments AS (
    SELECT ae.title, ae.score, ae.max_score, c.name AS course_name, ae.created_at
    FROM assessments ae
    JOIN courses c ON c.id = ae.course_id
    WHERE ae.student_id = :studentId
      AND ae.deleted_at IS NULL
    ORDER BY ae.created_at DESC
    LIMIT 5
  )
SELECT
  (SELECT COUNT(*) FROM enrolled)                         AS enrolled_course_count,
  (SELECT row_to_json(assignment_stats) FROM assignment_stats) AS assignments,
  (SELECT json_agg(upcoming) FROM upcoming)               AS upcoming_assignments,
  (SELECT json_agg(recent_assessments) FROM recent_assessments) AS recent_assessments;
```

---

### 6i. Parent portal queries — `/api/parent/*`

#### `GET /api/parent/children`

```sql
SELECT s.*,
  COUNT(DISTINCT ce.course_id) FILTER (WHERE ce.is_active = TRUE) AS enrolled_courses,
  ROUND(AVG(a.score / a.max_score * 100) FILTER (WHERE a.status = 'graded'), 1) AS avg_score,
  COUNT(a.id) FILTER (WHERE a.status IN ('pending', 'late')) AS pending_assignments
FROM students s
LEFT JOIN course_enrollments ce ON ce.student_id = s.id
LEFT JOIN assignments a ON a.student_id = s.id AND a.deleted_at IS NULL
WHERE s.id = ANY(:scope.childStudentIds)
  AND s.deleted_at IS NULL
GROUP BY s.id
ORDER BY s.name ASC;
```

#### `GET /api/parent/children/:studentId`

```sql
-- Pre-check: :studentId must be in scope.childStudentIds — enforced at handler level

SELECT s.*
FROM students s
WHERE s.id = :studentId
  AND s.deleted_at IS NULL;
```

Followed by separate queries for the child's recent assignments, assessments, and enrolled courses — or a CTE similar to the student dashboard pattern above.

---

## 7. course_enrollments Migration

Sprint 3 includes the migration from `students.enrolled_course_ids` JSON array to the `course_enrollments` join table (Architecture Review Report F-01).

### 7a. Why this sprint

The student and parent note/course scope queries in Section 6 (e.g., Section 6g, 6d for parent notes) require `course_enrollments` to be a real table with indexed rows. The `CHILD_ENROLLED` pattern cannot be efficiently implemented against a JSON array inside `students`.

The `SessionEnricherService` (Sprint 2) currently reads `students.enrolled_course_ids` as a JSON array to populate `session.enrolledCourseIds`. After this migration it reads from `course_enrollments`.

### 7b. Migration steps (Sprint 3, Group A)

```
CE-01  CREATE TABLE course_enrollments
       (Schema from Architecture Review Section 4a — see below)

CE-02  Populate course_enrollments from existing JSON data
       For each student WHERE enrolled_course_ids IS NOT NULL:
         For each course_id in enrolled_course_ids array:
           INSERT INTO course_enrollments
             (student_id, course_id, enrolled_at, enrolled_by, is_active)
           VALUES
             (students.id, course_id_value, students.created_at,
              1,   ← admin user (historical data)
              TRUE)
           ON CONFLICT (student_id, course_id) WHERE is_active = TRUE DO NOTHING

CE-03  Verify counts match
       SELECT COUNT(*) FROM course_enrollments   (should equal sum of all JSON array lengths)
       SELECT s.id, jsonb_array_length(s.enrolled_course_ids::jsonb),
              COUNT(ce.id) AS ce_count
       FROM students s
       LEFT JOIN course_enrollments ce ON ce.student_id = s.id AND ce.is_active = TRUE
       GROUP BY s.id
       HAVING jsonb_array_length(s.enrolled_course_ids::jsonb) != COUNT(ce.id);
       -- Expected: zero rows (all counts match)

CE-04  Update SessionEnricherService to read from course_enrollments
       (code change — no DDL)

CE-05  Deprecate students.enrolled_course_ids column
       -- Column is NOT dropped in Sprint 3
       -- COMMENT ON COLUMN students.enrolled_course_ids IS 'DEPRECATED: see course_enrollments table. Drop in Sprint 5.'
       -- New writes: also write to course_enrollments (application layer)
       -- Old reads: replaced by course_enrollments queries
```

### 7c. `course_enrollments` table schema

```
course_enrollments
─────────────────────────────────────────────────────────────────────────────
Column           Type           Constraints
─────────────────────────────────────────────────────────────────────────────
id               BIGSERIAL      PRIMARY KEY
student_id       INTEGER        NOT NULL  FK → students.id  ON DELETE CASCADE
course_id        INTEGER        NOT NULL  FK → courses.id   ON DELETE RESTRICT
enrolled_at      TIMESTAMPTZ    NOT NULL  DEFAULT NOW()
enrolled_by      INTEGER        NOT NULL  FK → users.id     (teacher or admin)
                                           ON DELETE RESTRICT
is_active        BOOLEAN        NOT NULL  DEFAULT TRUE
dropped_at       TIMESTAMPTZ    NULL      DEFAULT NULL
─────────────────────────────────────────────────────────────────────────────
UNIQUE INDEX: (student_id, course_id) WHERE is_active = TRUE
INDEX: (student_id)  WHERE is_active = TRUE
INDEX: (course_id)   WHERE is_active = TRUE
```

### 7d. New API endpoints for enrollment management

| Method | Path | Permission | Description |
|---|---|---|---|
| POST | `/api/courses/:id/enrol` | `courses:update` | Enrol a student in a course |
| DELETE | `/api/courses/:id/enrol/:studentId` | `courses:update` | Drop a student from a course |
| GET | `/api/courses/:id/students` | `courses:read` | List enrolled students |

These endpoints replace the current pattern of patching `students.enrolled_course_ids` directly.

---

## 8. Security Review

### 8a. IDOR (Insecure Direct Object Reference) protection

An IDOR vulnerability allows an authenticated user to access resources belonging to another user by guessing or iterating numeric IDs (e.g., incrementing `/api/assessments/88` to `/api/assessments/89`).

**Protection mechanism — three layers:**

| Layer | What it checks | When it fires |
|---|---|---|
| Layer 1 — `requireOwnership` | Queries resource `student_id` from DB before handler runs | `:id` routes (single resource) |
| Layer 2 — Query filter | `WHERE student_id = :studentId` / `WHERE student_id = ANY(...)` | List routes |
| Layer 3 — Post-fetch check | Validates `row.student_id` after fetch | `:id` detail routes (redundant safety net) |

**Attack scenario: student increments assignment IDs**
- Student ID 5 requests `GET /api/assignments/99`
- `requireOwnership` queries `assignments.student_id WHERE id = 99`
- Returns `student_id = 9` — mismatch with `session.studentId = 5`
- 403 returned before any data is read
- Layer 1 stops the attack. Layer 2 and 3 are never reached.

**Attack scenario: student manually calls list endpoint**
- Student ID 5 requests `GET /api/students` (list)
- `requirePermission('students:read')` passes (student has this permission)
- Query builder applies `WHERE id = :scope.studentId` (id = 5)
- Only student 5's own record returned — never other students

---

### 8b. 403 vs 404 for IDOR attempts

**Decision: `requireOwnership` returns 403, not 404.**

Rationale:

| Response | Information leaked | User experience |
|---|---|---|
| 404 | Implies the resource does not exist at all | Student confused when accessing a valid assignment that exists but isn't theirs |
| 403 | Confirms the resource exists but access is denied | Clear to student/parent; admins can distinguish 403 from 404 in logs |

IDs are sequential integers — they are not secrets. A student already knows assignment IDs from their own records. Returning 404 for an IDOR attempt provides no real security benefit and degrades legitimate UX (e.g., a parent sharing a link with their child who has a different role).

**Exception:** `GET /api/students/:id` — when a student requests another student's profile, returning 404 is acceptable here because student profile pages should not be shareable by ID. Document the exception explicitly in the route.

---

### 8c. Parent-child relationship forgery

**Attack scenario:** A parent modifies their session cookie to add a fake student ID to `childStudentIds`.

**Protection:** Session cookies are `httpOnly` (unreadable by JavaScript) and signed with `SESSION_SECRET`. Modifying the cookie contents without the secret produces an invalid signature that express-session rejects — the session is treated as unauthenticated.

**Additional protection:** `session.childStudentIds` is populated at login from `student_guardians WHERE user_id = session.userId`. Even if an attacker could forge the session, the back-end `student_guardians` table is the authoritative source. The `SessionEnricherService` re-reads from DB on every login.

---

### 8d. Permission escalation via role change mid-session

**Attack scenario:** An admin demotes a teacher to student role. The teacher's active session still has teacher permissions for up to 60 seconds (RBAC version cache TTL).

**Protection:** `checkRbacVersion` middleware detects the version change (when `rbac_version` is incremented by the demotion action) within one cache TTL cycle (60 seconds) and re-resolves the session's permissions from DB.

**For immediate enforcement** (e.g., disciplinary action): the admin deactivates the account (`is_active = false`), which deletes the session row immediately (Sprint 2, Section 7c). This is the correct emergency path — not waiting for the RBAC version cache to expire.

---

### 8e. Mass assignment / parameter pollution

**Attack scenario:** A student sends a PATCH request with `{ "student_id": 999 }` to change which student an assignment belongs to.

**Protection:** All write endpoints validate input with Zod schemas. The `student_id` field is:
- Not present in the `PatchAssignment` Zod schema (teacher updates only grade/feedback/status)
- Any extra fields not in the schema are stripped by Zod's `.strict()` or `.strip()` mode

The Drizzle ORM also enforces typed column writes — a route handler cannot accidentally write an unchecked field.

---

### 8f. Course scope bypass via direct note ID access

**Attack scenario:** A student enrolled in course 3 requests `GET /api/notes/55` where note 55 belongs to course 7 (not enrolled).

**Protection:**
- `requireOwnership` does not directly apply to notes (notes are course-scoped, not student-scoped)
- The `getNoteById` query builder checks: `WHERE notes.id = :id AND notes.course_id = ANY(:scope.enrolledCourseIds)`
- This is Layer 2 (query filter) applied to a detail endpoint
- If `note.course_id = 7` and `scope.enrolledCourseIds = [3]`, the query returns `null` → 404 (not 403 — course scope is less sensitive than student identity scope)

---

### 8g. Empty scope arrays — security implications

When a student's `enrolledCourseIds` is `[]` or a parent's `childStudentIds` is `[]`:

- `WHERE course_id = ANY(ARRAY[]::INT[])` — PostgreSQL evaluates `ANY(empty array)` as `FALSE` for every row
- This means zero rows are returned — the correct behaviour
- **Risk:** If the array is null (not empty), `ANY(NULL)` is `NULL` in PostgreSQL, which does not match any row — but this is also safe (returns zero rows)
- **Drizzle binding risk:** Verify that Drizzle ORM binds `undefined` or empty arrays as `ARRAY[]::INT[]`, not as `NULL`. If Drizzle passes `NULL`, the `ANY(NULL)` behaviour is safe but should be made explicit via a pre-check in the query builder

---

## 9. Performance Considerations

### 9a. Index coverage for scope queries

All scope-filtering WHERE clauses must be covered by existing indexes. The table below confirms index coverage:

| Query pattern | Table + column | Index from Sprint 1 | Covered? |
|---|---|---|---|
| `WHERE assignments.student_id = :id` | `assignments.student_id` | FK constraint (implicit index) | ✅ |
| `WHERE assessments.student_id = :id` | `assessments.student_id` | FK constraint (implicit index) | ✅ |
| `WHERE assignments.student_id = ANY(:ids)` | `assignments.student_id` | FK constraint | ✅ |
| `WHERE notes.course_id = ANY(:ids)` | `notes.course_id` | FK constraint | ✅ |
| `WHERE ce.student_id = :id AND is_active` | `course_enrollments.student_id` | `idx_ce_student_id WHERE is_active` | ✅ (Sprint 3 CE-01) |
| `WHERE ce.student_id = ANY(:ids)` | `course_enrollments.student_id` | Same index | ✅ |
| `WHERE students.id = ANY(:ids)` | `students.id` | PK | ✅ |
| `WHERE activity.student_id = ANY(:ids)` | `activity.student_id` | `idx_activity_student_id` (Sprint 1 M-07) | ✅ |

**Additional index recommended for Sprint 3:**

```
CREATE INDEX CONCURRENTLY idx_assignments_student_status
  ON assignments(student_id, status)
  WHERE deleted_at IS NULL;
-- Covers: student portal "pending assignments" and "overdue" queries
-- Avoids: full scan on assignments for status-filtered student queries

CREATE INDEX CONCURRENTLY idx_assessments_student_course
  ON assessments(student_id, course_id)
  WHERE deleted_at IS NULL;
-- Covers: per-course assessment history queries in student portal
```

---

### 9b. Avoiding N+1 queries in portal routes

The student portal and parent portal routes are particularly at risk of N+1 patterns.

**Anti-pattern (N+1):**
```
// Get 3 enrolled courses, then for each: fetch assignment count, fetch avg score
courses = SELECT * FROM courses WHERE id = ANY([1,3,5])  — 1 query
for each course:
  assignments = SELECT COUNT(*) FROM assignments WHERE course_id = :id AND student_id = :id  — N queries
```

**Correct pattern (single CTE or JOIN):**
```
-- All data in one query using GROUP BY + aggregates
-- See Section 6h for the student dashboard CTE pattern
-- See Section 6e for the student subjects query pattern
```

**Rule:** Every portal route must aggregate in **one query** using CTEs or JOINs. No loops over query results to fetch related data.

---

### 9c. Pagination with scope

List endpoints support cursor-based pagination (Sprint 2 design). Scope filters are applied before pagination — the `LIMIT/OFFSET` operates on the already-filtered result set.

**Correct pattern:**
```sql
-- Student assignments, paginated
SELECT a.*
FROM assignments a
WHERE a.student_id = :studentId          -- scope filter FIRST
  AND a.deleted_at IS NULL
ORDER BY a.due_date ASC
LIMIT :limit                             -- pagination SECOND
OFFSET :offset;
```

**Incorrect pattern (DO NOT DO):**
```sql
-- Fetch all, then filter in application — wrong at scale
SELECT a.* FROM assignments WHERE deleted_at IS NULL LIMIT 50 OFFSET 0;
-- Then filter in JS: results.filter(a => a.student_id === studentId)
-- Problem: returns the wrong page when combined with pagination
```

---

### 9d. Session array size limits

`session.enrolledCourseIds` and `session.childStudentIds` are serialised to JSONB in the session store. Array sizes:

| Array | Realistic max | Max safe size | Risk |
|---|---|---|---|
| `enrolledCourseIds` | 8–10 per student | 100 | ✅ No concern |
| `childStudentIds` | 2–4 per parent | 20 | ✅ No concern |
| `permissions` | 27 keys currently | 100 | ✅ No concern |

No session bloat risk at realistic educational institution scale. The `session.sess` JSONB column (Sprint 1 M-02) stores the complete payload with room to spare.

---

### 9e. `CHILD_ENROLLED` subquery — parent notes/courses performance

The parent course-scope pattern uses a subquery against `course_enrollments`:

```sql
WHERE n.course_id IN (
  SELECT DISTINCT ce.course_id
  FROM course_enrollments ce
  WHERE ce.student_id = ANY(:childStudentIds)
  AND ce.is_active = TRUE
)
```

**Performance analysis:**
- `childStudentIds` is typically 2–4 IDs
- `course_enrollments` indexed on `(student_id) WHERE is_active = TRUE`
- Inner query returns 5–20 distinct course IDs (2–4 children × 5 courses each)
- PostgreSQL plans this as an index scan + hash semi-join — extremely fast
- No materialized view or caching needed at current scale

**Alternative:** Pre-compute `childEnrolledCourseIds` in `SessionEnricherService` and cache in session — same pattern as `enrolledCourseIds` for students. Trade-off: simpler query (`ANY(:childEnrolledCourseIds)`) vs slightly larger session payload. Deferred to Sprint 5 if profiling shows the subquery is slow.

---

## 10. Risks & Mitigations

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R-01 | **N+1 query in a portal route** | Medium | High — response time degrades with data volume | Section 9b defines the rule: one query per portal endpoint. Code review checklist must verify. |
| R-02 | **`ANY(empty array)` behaves differently across PostgreSQL and Drizzle** | Low | Medium — returns all rows instead of zero | Confirm via integration test: student with no enrollments calls `/api/notes` → must return `[]`. If Drizzle serialises `[]` as `NULL`, add pre-check: `if scope.enrolledCourseIds.length === 0: return []` before query. |
| R-03 | **`course_enrollments` back-fill CE-02 misses students with null JSON** | Medium | Low — some students have no enrollment data | Pre-check query: `SELECT id FROM students WHERE enrolled_course_ids IS NULL OR enrolled_course_ids = '[]'`. These students get no rows in `course_enrollments` — correct. |
| R-04 | **Post-fetch Layer 3 check adds a second DB round-trip for /:id routes** | Low | Low — detail routes are already 1 query | Layer 3 operates on the in-memory row returned by Layer 2. No second DB query. It is a JavaScript comparison only. |
| R-05 | **Student portal routes accessible by admin/teacher** | Low | Low — not a security issue, just confusing UX | `requireRole('student')` on portal routes returns 403 for admin/teacher. Document: admins access student data via `/api/students/:id`, not `/api/student/`. |
| R-06 | **Parent portal returns empty list when guardian link not yet created** | High | Low — expected behaviour, but confusing UX | Parent dashboard explicitly returns `{ status: 'no_children_linked', children: [] }`. Frontend displays "Ask your administrator to link your children to your account." |
| R-07 | **course_enrollments migration CE-02 creates duplicate rows** | Low | None — `ON CONFLICT DO NOTHING` prevents duplicates | Idempotent insert. Verify with CE-03 count check. |
| R-08 | **`CHILD_ENROLLED` subquery not using index** | Low | Medium — full table scan on large course_enrollments | Use `EXPLAIN ANALYZE` on parent note queries during integration testing. The index `idx_ce_student_id WHERE is_active = TRUE` must be confirmed used. |
| R-09 | **`enrolled_course_ids` JSON still written to by old code paths** | Medium | Low — deprecated column drifts but course_enrollments is authoritative | Document: all enrolment writes after Sprint 3 must write to `course_enrollments`. Old direct-array mutations are a code smell and flagged in code review. The JSON column is read-only from Sprint 3 onwards. |

---

## 11. Sprint 3 Completion Criteria

Sprint 3 is complete and approved for code generation when **all** of the following are confirmed:

| # | Criterion | Confirmed by |
|---|---|---|
| SC-01 | `GET /api/assignments` for a student returns ONLY that student's assignments | Dev — integration test |
| SC-02 | `GET /api/assignments` for a parent returns ONLY their children's assignments | Dev — integration test |
| SC-03 | `GET /api/assignments` for a teacher returns ALL assignments (paginated) | Dev — integration test |
| SC-04 | Student receives 403 on `GET /api/students` (no list access) | Dev — integration test |
| SC-05 | Parent receives 403 on `POST /api/assignments` (no write access) | Dev — integration test |
| SC-06 | `GET /api/notes` for a student returns only notes from enrolled courses | Dev — integration test |
| SC-07 | `GET /api/notes` for a parent returns only notes from children's enrolled courses | Dev — integration test |
| SC-08 | IDOR test: student requesting another student's assessment receives 403 | Dev — integration test |
| SC-09 | Student with `enrolledCourseIds = []` receives `[]` from `GET /api/notes` | Dev — integration test |
| SC-10 | Parent with `childStudentIds = []` receives `[]` from `GET /api/assignments` | Dev — integration test |
| SC-11 | `course_enrollments` table exists and is populated from JSON migration | Dev + DBA — CE-03 verification query |
| SC-12 | `SessionEnricher` reads `enrolledCourseIds` from `course_enrollments` | Dev — code review |
| SC-13 | `GET /api/student/subjects` returns enrolled courses with aggregate stats | Dev — integration test |
| SC-14 | `GET /api/parent/children` returns linked children with summary data | Dev — integration test |
| SC-15 | All Sprint 2 admin and teacher tests still pass unchanged | Dev — regression test |
| SC-16 | `pnpm run typecheck` passes with zero errors | Dev — CI |
| SC-17 | `EXPLAIN ANALYZE` on parent notes query confirms index use | DBA — manual check |

---

*Sprint 3 scope is complete as specified. Code generation begins only after this document is approved. Sprint 4 (admin user management routes, audit log, teacher course ownership scoping, frontend route guards) will be designed separately.*
