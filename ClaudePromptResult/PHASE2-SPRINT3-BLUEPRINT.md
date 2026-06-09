# Classmate Connect — Phase 2 Sprint 3: Implementation Blueprint

> **Document type:** Architecture & Implementation Planning — no source code, no pseudocode
> **Source of truth:** Sprint 3 Row-Level Security Design (PHASE2-SPRINT3.md, approved)
> **Pre-requisites:** Sprint 1 DB migrations complete · Sprint 2 middleware layer complete
> **Version:** 1.0
> **Date:** June 2026
> **Architect role:** Senior Solution Architect

---

## Table of Contents

1. [Deliverable Inventory](#1-deliverable-inventory)
2. [A — ScopeContext Implementation](#2-a--scopecontext-implementation)
3. [B — Query Builder Layer](#3-b--query-builder-layer)
4. [C — Assignments Scope Filtering](#4-c--assignments-scope-filtering)
5. [D — Assessments Scope Filtering](#5-d--assessments-scope-filtering)
6. [E — Notes Scope Filtering](#6-e--notes-scope-filtering)
7. [F — Courses Scope Filtering](#7-f--courses-scope-filtering)
8. [G — Student Portal Routes](#8-g--student-portal-routes)
9. [H — Parent Portal Routes](#9-h--parent-portal-routes)
10. [I — course_enrollments Migration](#10-i--course_enrollments-migration)
11. [J — SessionEnricher Migration](#11-j--sessionenricher-migration)
12. [K — Integration Tests](#12-k--integration-tests)
13. [L — Security Tests](#13-l--security-tests)
14. [Recommended Implementation Sequence](#14-recommended-implementation-sequence)
15. [Git Commit Plan](#15-git-commit-plan)
16. [Rollback Strategy](#16-rollback-strategy)
17. [Production Deployment Strategy](#17-production-deployment-strategy)

---

## 1. Deliverable Inventory

The table below provides the at-a-glance summary before detailed breakdown. Risk levels and effort estimates apply to implementation only; design is complete.

| # | Deliverable | Risk | Effort | Blocking | Blocked by |
|---|---|---|---|---|---|
| A | ScopeContext | Low | 0.5 day | B, C, D, E, F, G, H | — |
| B | Query Builder layer | Medium | 1 day | C, D, E, F | A |
| C | Assignments filtering | Low | 0.5 day | G, H, K | A, B, I |
| D | Assessments filtering | Low | 0.5 day | G, H, K | A, B |
| E | Notes filtering | Medium | 0.5 day | G, H, K | A, B, I |
| F | Courses filtering | Medium | 1 day | G, H, K | A, B, I |
| G | Student portal routes | Medium | 1.5 days | K, L | A, B, C, D, E, F, J |
| H | Parent portal routes | Medium | 1.5 days | K, L | A, B, C, D, E, F, J |
| I | course_enrollments migration | High | 1 day | E, F, G, H, J | Sprint 1 DB complete |
| J | SessionEnricher migration | Medium | 0.5 day | G, H | I |
| K | Integration tests | Medium | 1.5 days | — | C, D, E, F, G, H |
| L | Security tests | High | 1 day | — | C, D, E, F, G, H |
| **Total** | | | **~10 days** | | |

---

## 2. A — ScopeContext Implementation

### Purpose

Establish the typed contract that separates session data from query logic. Every query builder function and every portal route handler receives a `ScopeContext` object — never `req.session` directly. This creates a clean, testable boundary between the authorization layer and the data access layer.

### Inputs

- Approved `ClassmateSession` type (Sprint 2 `session.d.ts`)
- Role key literals: `'admin' | 'teacher' | 'student' | 'parent' | 'guest'`
- Session fields: `role`, `studentId`, `enrolledCourseIds`, `childStudentIds`, `userId`

### Outputs

- `ScopeContext` TypeScript interface
- `buildScopeContext(session)` pure function — no I/O, no side effects
- `isStudentScope(scope)` type guard
- `isParentScope(scope)` type guard
- `isGlobalScope(scope)` type guard

### Dependencies

- Sprint 2 `session.d.ts` must exist and export `ClassmateSession`
- No runtime dependencies — pure TypeScript types and a pure function

### Acceptance Criteria

1. `buildScopeContext` called with an admin session returns `{ isGlobal: true, studentId: null, enrolledCourseIds: [], childStudentIds: [] }`
2. `buildScopeContext` called with a student session with `studentId: 5` returns `{ isGlobal: false, role: 'student', studentId: 5 }`
3. `buildScopeContext` called with a parent session returns `{ isGlobal: false, role: 'parent', childStudentIds: [...] }`
4. `buildScopeContext` called with a student session where `studentId` is null returns `{ isGlobal: false, studentId: null, enrolledCourseIds: [] }`
5. TypeScript type guards narrow correctly — `isStudentScope(scope)` returns true only for student role
6. `pnpm run typecheck` passes with zero errors

### Folder structure changes

```
artifacts/api-server/src/
└── lib/                         ← NEW directory
    └── scopeContext.ts          ← NEW file
```

### New files to create

| File | Description |
|---|---|
| `artifacts/api-server/src/lib/scopeContext.ts` | `ScopeContext` interface, `buildScopeContext` factory, three type guards |

### Existing files to modify

None. ScopeContext is additive.

### Dependency graph

```
session.d.ts (Sprint 2)
    └── scopeContext.ts         ← depends on ClassmateSession
            └── [all query builders] (Deliverables C–H)
```

### Implementation order

1. Create `lib/` directory
2. Define `ScopeContext` interface
3. Implement `buildScopeContext`
4. Implement type guards
5. Export from `lib/index.ts`

### Risk level

**Low.** Pure TypeScript with no runtime I/O. All failure modes are compile-time type errors.

### Estimated effort

**0.5 day** — straightforward interface definition and pure function.

---

## 3. B — Query Builder Layer

### Purpose

Establish the architectural pattern that all resource query functions follow. This deliverable creates the *framework* — the shared types, the base interfaces, and the empty module stubs that deliverables C through F will fill. Doing this first ensures all five resource modules are consistent and that the `ScopeContext` contract is applied uniformly.

### Inputs

- `ScopeContext` (Deliverable A)
- `DrizzleDb` type from `@workspace/db`
- Existing route handler patterns in `routes/students.ts`, `routes/assignments.ts`, etc.

### Outputs

- `QueryBuilderOptions` base interface (pagination, soft-delete filter, sort)
- `ScopedListResult<T>` generic return type (data, total, hasMore)
- Module stubs for each resource query builder:
  - `lib/queryBuilders/assignments.ts`
  - `lib/queryBuilders/assessments.ts`
  - `lib/queryBuilders/notes.ts`
  - `lib/queryBuilders/courses.ts`
  - `lib/queryBuilders/students.ts`
- Barrel export `lib/queryBuilders/index.ts`

### Dependencies

- Deliverable A (`ScopeContext`)
- `@workspace/db` schema exports (tables, column types)
- `drizzle-orm` — `and`, `eq`, `inArray`, `isNull`, `sql` operators

### Acceptance Criteria

1. All five query builder modules compile with zero errors
2. Each module exports at minimum: `list[Resource]`, `get[Resource]ById`
3. `list[Resource]` signature accepts `(scope: ScopeContext, options: [Resource]ListOptions)` — no bare `db` param (db is injected via closure or DI)
4. `get[Resource]ById` signature accepts `(id: number, scope: ScopeContext)`
5. All function signatures are consistent — same option shape for `limit`, `offset`, `sortBy`
6. No route handler directly constructs a Drizzle `where` condition — all conditions go through query builders
7. `pnpm run typecheck` passes

### Folder structure changes

```
artifacts/api-server/src/
└── lib/
    ├── scopeContext.ts          ← from Deliverable A
    ├── index.ts                 ← NEW barrel
    └── queryBuilders/           ← NEW directory
        ├── index.ts             ← NEW barrel
        ├── assignments.ts       ← NEW stub (filled by Deliverable C)
        ├── assessments.ts       ← NEW stub (filled by Deliverable D)
        ├── notes.ts             ← NEW stub (filled by Deliverable E)
        ├── courses.ts           ← NEW stub (filled by Deliverable F)
        └── students.ts          ← NEW stub
```

### New files to create

| File | Description |
|---|---|
| `lib/index.ts` | Barrel — re-exports `scopeContext`, `queryBuilders` |
| `lib/queryBuilders/index.ts` | Barrel — re-exports all five resource builders |
| `lib/queryBuilders/assignments.ts` | Assignment query functions (stubbed, filled in C) |
| `lib/queryBuilders/assessments.ts` | Assessment query functions (stubbed, filled in D) |
| `lib/queryBuilders/notes.ts` | Note query functions (stubbed, filled in E) |
| `lib/queryBuilders/courses.ts` | Course query functions (stubbed, filled in F) |
| `lib/queryBuilders/students.ts` | Student query functions |

### Existing files to modify

None at this step.

### Dependency graph

```
@workspace/db
    └── queryBuilders/*.ts   ← import table definitions + column types
scopeContext.ts
    └── queryBuilders/*.ts   ← all builders accept ScopeContext
drizzle-orm
    └── queryBuilders/*.ts   ← use and(), eq(), inArray(), sql
```

### Implementation order

1. Define `QueryBuilderOptions` and `ScopedListResult<T>` in `lib/index.ts`
2. Create `lib/queryBuilders/` directory
3. Create one stub per resource with correct signatures
4. Wire barrel exports

### Risk level

**Medium.** The interfaces defined here lock in the contract for deliverables C–F and the portal routes G–H. A wrong interface shape here cascades. Careful review of `ScopeContext` before creating stubs.

### Estimated effort

**1 day** — interface design + five stubs + barrel wiring + typecheck pass.

---

## 4. C — Assignments Scope Filtering

### Purpose

Replace the existing bare Drizzle queries in `routes/assignments.ts` with scoped query builder calls. The list endpoint applies `WHERE student_id = :studentId` (student) or `WHERE student_id = ANY(:childStudentIds)` (parent). The detail endpoint adds a Layer 3 post-fetch ownership check.

### Inputs

- `ScopeContext` (A)
- Query builder stub `lib/queryBuilders/assignments.ts` (B)
- Current `routes/assignments.ts` (existing file to modify)
- `assignmentsTable` schema from `@workspace/db`
- Sprint 3 query patterns: Section 6b (PHASE2-SPRINT3.md)

### Outputs

- Completed `lib/queryBuilders/assignments.ts` with:
  - `listAssignments(scope, options)` — scoped list with status + courseId filter support
  - `getAssignmentById(id, scope)` — fetch + Layer 3 check
  - `createAssignment(data)` — write (no scope needed — teachers/admins only)
  - `updateAssignment(id, data)` — write
  - `deleteAssignment(id)` — write
- Updated `routes/assignments.ts` — all handlers delegate to query builder

### Dependencies

- Deliverable A (`ScopeContext`)
- Deliverable B (query builder pattern established)
- Deliverable I (`course_enrollments` migration complete — needed for correct student scope)
- `assignmentsTable`, `studentsTable`, `coursesTable` from `@workspace/db`

### Acceptance Criteria

1. `GET /api/assignments` — student session returns only that student's assignments
2. `GET /api/assignments` — parent session returns only children's assignments
3. `GET /api/assignments` — teacher session returns all assignments (no filter)
4. `GET /api/assignments?status=graded` — filter applied within scope
5. `GET /api/assignments?courseId=3` — filter applied within scope
6. `GET /api/assignments/:id` — student requesting another student's assignment → 403
7. `GET /api/assignments/:id` — parent requesting child's assignment → 200
8. `GET /api/assignments/:id` — non-existent ID → 404
9. No raw Drizzle WHERE condition in `routes/assignments.ts` — all delegated to query builder
10. `pnpm run typecheck` passes

### Folder structure changes

No new folders. Two files change.

### New files to create

None. Query builder stub promoted to full implementation.

### Existing files to modify

| File | Change |
|---|---|
| `lib/queryBuilders/assignments.ts` | Implement all five query functions |
| `routes/assignments.ts` | Replace inline queries with query builder calls; add `buildScopeContext` at handler entry |

### Dependency graph

```
ScopeContext (A)
    └── queryBuilders/assignments.ts
            ← assignmentsTable (@workspace/db)
            ← studentsTable (@workspace/db)
            ← coursesTable (@workspace/db)
            ← drizzle-orm operators

queryBuilders/assignments.ts
    └── routes/assignments.ts
```

### Implementation order

1. Implement `listAssignments` — global path first (isGlobal = true), then student filter, then parent filter
2. Implement `getAssignmentById` with Layer 3 ownership check
3. Implement write functions (scope-agnostic)
4. Update route handlers — add `buildScopeContext` call, delegate to builder
5. Integration test (Deliverable K checkpoint)

### Risk level

**Low.** Assignments have a direct `student_id` FK — the scope pattern is the simplest case. Regression risk is the only concern: existing teacher tests must still pass.

### Estimated effort

**0.5 day.**

---

## 5. D — Assessments Scope Filtering

### Purpose

Apply the same three-layer scope pattern to assessments. The structure mirrors assignments exactly — direct `student_id` FK, same scope logic, same Layer 3 ownership check pattern.

### Inputs

- `ScopeContext` (A), query builder pattern (B)
- Current `routes/assessments.ts`
- `assessmentsTable` schema
- Sprint 3 Section 6d patterns

### Outputs

- Completed `lib/queryBuilders/assessments.ts` with:
  - `listAssessments(scope, options)` — scoped list with student + course filter
  - `getAssessmentById(id, scope)` — fetch + Layer 3 check
  - `createAssessment(data)`, `updateAssessment(id, data)`, `deleteAssessment(id)` — writes
- Updated `routes/assessments.ts`

### Dependencies

- Deliverables A, B
- `assessmentsTable`, `studentsTable`, `coursesTable` from `@workspace/db`

### Acceptance Criteria

1. `GET /api/assessments` — student returns own assessments only
2. `GET /api/assessments` — parent returns children's assessments only
3. `GET /api/assessments` — teacher returns all
4. `GET /api/assessments/:id` — student requesting another's assessment → 403
5. `DELETE /api/assessments/:id` — teacher → 403 (teacher has no `assessments:delete` permission — enforced by Sprint 2 middleware, not here)
6. No raw Drizzle WHERE in route handler
7. `pnpm run typecheck` passes

### Folder structure changes

None.

### New files to create

None.

### Existing files to modify

| File | Change |
|---|---|
| `lib/queryBuilders/assessments.ts` | Implement all functions |
| `routes/assessments.ts` | Replace inline queries, add `buildScopeContext` |

### Dependency graph

```
ScopeContext (A) → queryBuilders/assessments.ts ← assessmentsTable
queryBuilders/assessments.ts → routes/assessments.ts
```

### Implementation order

Mirrors Deliverable C. Direct `student_id` FK makes this identical in structure.

### Risk level

**Low.** Same pattern as C.

### Estimated effort

**0.5 day.**

---

## 6. E — Notes Scope Filtering

### Purpose

Apply scope filtering to notes. Notes are *course-scoped*, not student-scoped — the scope filter operates on `course_id`, not `student_id`. For students, `WHERE course_id = ANY(:enrolledCourseIds)`. For parents, a subquery against `course_enrollments` resolves the child-enrolled course IDs dynamically.

This deliverable is more complex than C/D because it introduces the `CHILD_ENROLLED` subquery pattern and depends on `course_enrollments` being populated (Deliverable I).

### Inputs

- `ScopeContext` (A), query builder pattern (B)
- Deliverable I (`course_enrollments` table populated)
- Current `routes/notes.ts`
- `notesTable`, `courseEnrollmentsTable` from `@workspace/db`
- Sprint 3 Section 6c patterns

### Outputs

- Completed `lib/queryBuilders/notes.ts` with:
  - `listNotes(scope, options)` — course-scoped list
  - `getNoteById(id, scope)` — fetch + Layer 3 course membership check
  - `createNote(data)`, `updateNote(id, data)`, `deleteNote(id)` — writes
- Updated `routes/notes.ts`

### Dependencies

- Deliverables A, B
- Deliverable I (must be complete — `course_enrollments` must have data)
- `notesTable`, `courseEnrollmentsTable` from `@workspace/db`
- `drizzle-orm` `inArray` and subquery support

### Acceptance Criteria

1. `GET /api/notes` — student enrolled in courses [1, 3] returns notes for courses 1 and 3 only
2. `GET /api/notes` — student with `enrolledCourseIds = []` returns empty list
3. `GET /api/notes` — parent returns notes from all children's enrolled courses (union of children's course enrollments)
4. `GET /api/notes` — teacher returns all notes
5. `GET /api/notes/:id` — student requesting note from non-enrolled course → 404 (course scope, not identity scope — returns 404 per Sprint 3 Section 8f)
6. `GET /api/notes?courseId=3` — course filter respected within scope
7. No raw Drizzle WHERE in route handler
8. `pnpm run typecheck` passes

### Folder structure changes

None.

### New files to create

None.

### Existing files to modify

| File | Change |
|---|---|
| `lib/queryBuilders/notes.ts` | Implement all functions; include `CHILD_ENROLLED` subquery pattern |
| `routes/notes.ts` | Replace inline queries, add `buildScopeContext` |

### Dependency graph

```
ScopeContext (A)
course_enrollments table (I)
    └── queryBuilders/notes.ts
            ← notesTable
            ← courseEnrollmentsTable
            ← drizzle-orm subquery

queryBuilders/notes.ts → routes/notes.ts
```

### Implementation order

1. Implement `listNotes` — global first, then student (`ENROLLED` pattern), then parent (`CHILD_ENROLLED` subquery)
2. Implement `getNoteById` — include course membership check in the WHERE clause
3. Implement writes (scope-agnostic)
4. Update route handler
5. Verify with empty array edge case test

### Risk level

**Medium.** The parent notes scope requires a subquery against `course_enrollments`. Query planner behaviour must be verified with `EXPLAIN ANALYZE` (Sprint 3 SC-17). Also depends on Deliverable I being complete.

### Estimated effort

**0.5 day** (plus dependency on Deliverable I).

---

## 7. F — Courses Scope Filtering

### Purpose

Apply scope filtering to courses. Courses are many-to-many with students via `course_enrollments`. A student sees only enrolled courses; a parent sees courses that any of their children are enrolled in. This deliverable also introduces the three new enrollment management endpoints (`POST /enrol`, `DELETE /enrol/:studentId`, `GET /:id/students`).

### Inputs

- `ScopeContext` (A), query builder pattern (B)
- Deliverable I (`course_enrollments` populated)
- Current `routes/courses.ts`
- `coursesTable`, `courseEnrollmentsTable`, `studentsTable` from `@workspace/db`
- Sprint 3 Sections 6f, 7d patterns

### Outputs

- Completed `lib/queryBuilders/courses.ts` with:
  - `listCourses(scope, options)` — enrollment-aware scoped list with `student_count` aggregate
  - `getCourseById(id, scope)` — fetch + enrollment membership check for student/parent
  - `listEnrolledStudents(courseId)` — for admin/teacher `GET /api/courses/:id/students`
  - `enrollStudent(courseId, studentId, enrolledBy)` — insert into `course_enrollments`
  - `dropStudent(courseId, studentId)` — set `is_active = false` in `course_enrollments`
  - Standard writes: `createCourse`, `updateCourse`, `deleteCourse`
- Updated `routes/courses.ts` — all handlers delegated; three new route handlers added

### Dependencies

- Deliverables A, B
- Deliverable I (course_enrollments table and data required)
- `coursesTable`, `courseEnrollmentsTable`, `studentsTable`, `users` from `@workspace/db`

### Acceptance Criteria

1. `GET /api/courses` — student sees only enrolled courses
2. `GET /api/courses` — student with `enrolledCourseIds = []` returns empty list
3. `GET /api/courses` — parent sees courses for all linked children (union, no duplicates)
4. `GET /api/courses` — teacher sees all courses with `student_count` aggregate
5. `GET /api/courses/:id` — student not enrolled in this course → 404
6. `POST /api/courses/:id/enrol` — teacher enrols student → `course_enrollments` row inserted
7. `POST /api/courses/:id/enrol` — duplicate active enrolment → 409 CONFLICT (partial unique index)
8. `DELETE /api/courses/:id/enrol/:studentId` — teacher drops student → `is_active = false`, `dropped_at` set
9. `GET /api/courses/:id/students` — returns enrolled students with `enrolled_at`
10. No raw Drizzle JOIN/WHERE in route handler
11. `pnpm run typecheck` passes

### Folder structure changes

None. New endpoints added to existing router file.

### New files to create

None.

### Existing files to modify

| File | Change |
|---|---|
| `lib/queryBuilders/courses.ts` | Implement all functions |
| `routes/courses.ts` | Replace inline queries; add three new enrollment route handlers |

### Dependency graph

```
ScopeContext (A)
course_enrollments table (I)
    └── queryBuilders/courses.ts
            ← coursesTable
            ← courseEnrollmentsTable
            ← studentsTable

queryBuilders/courses.ts → routes/courses.ts
```

### Implementation order

1. `listCourses` — global path (with aggregate), student path (JOIN enrollment), parent path (DISTINCT JOIN)
2. `getCourseById` — fetch + enrollment membership check
3. `enrollStudent` / `dropStudent` — write operations
4. `listEnrolledStudents` — admin/teacher read
5. New route handlers for enrolment endpoints
6. OpenAPI spec update for new endpoints

### Risk level

**Medium.** The aggregate `COUNT(DISTINCT ce.student_id)` join changes the query shape from the existing simple `SELECT * FROM courses`. The existing `studentCount` column (denormalized integer on `coursesTable`) must be evaluated — it should be superseded by the live aggregate. Coordinate with team: either deprecate `student_count` column or keep it as a cache.

### Estimated effort

**1 day** — more complex than C/D due to enrollment management endpoints and aggregate queries.

---

## 8. G — Student Portal Routes

### Purpose

Create the student-facing API surface at `/api/student/*`. These routes are gated by `requireRole('student')` — they are not accessible by any other role including admin. They return student-specific aggregated views: dashboard summary, subject list with statistics, assignment feed, and assessment history.

### Inputs

- `ScopeContext` (A) — student scope with `studentId` and `enrolledCourseIds`
- All completed query builders (C, D, E, F) — portal routes call existing builders
- Deliverable J (SessionEnricher reads from `course_enrollments`)
- Sprint 3 Sections 6h, 5e (student portal sequence diagrams and query patterns)
- Sprint 2 middleware: `requireAuth`, `checkRbacVersion`, `requireRole`

### Outputs

**New router:** `routes/student/index.ts` with five handlers:

| Endpoint | Description |
|---|---|
| `GET /api/student/dashboard` | Single CTE — enrolled courses, assignment stats, upcoming assignments, recent assessments |
| `GET /api/student/subjects` | Enrolled courses with per-course aggregates (avg score, assignment counts) |
| `GET /api/student/subjects/:courseId` | Single course detail — notes, recent assignments, assessment scores |
| `GET /api/student/assignments` | Student's own assignments — sorted by due date, filterable by status |
| `GET /api/student/assessments` | Student's own assessments — sorted by date |

All five handlers:
- Call `buildScopeContext(req.session)` at entry
- Assert `scope.studentId !== null` (unlinked account returns structured "not enrolled" response)
- Delegate all DB access to query builders
- Return student-specific DTOs (not the same shape as teacher endpoints)

### Dependencies

- Deliverables A, B, C, D, E, F (all query builders must be complete)
- Deliverable J (SessionEnricher using course_enrollments — `enrolledCourseIds` must be accurate)
- Sprint 2 `requireRole` middleware
- Sprint 2 global `requireAuth` + `checkRbacVersion` registration in `app.ts`

### Acceptance Criteria

1. `GET /api/student/dashboard` — admin session → 403
2. `GET /api/student/dashboard` — teacher session → 403
3. `GET /api/student/dashboard` — student with `studentId = null` → 200 with `{ status: 'not_enrolled', data: null }`
4. `GET /api/student/dashboard` — student returns aggregated stats (assignment counts, upcoming list, recent assessments)
5. `GET /api/student/subjects` — returns only enrolled courses
6. `GET /api/student/subjects/:courseId` — course not enrolled → 404
7. `GET /api/student/assignments` — returns only own assignments, sorted by due date ascending
8. `GET /api/student/assessments` — returns only own assessments, sorted by date descending
9. All five endpoints respond within 500ms for a student with 5 enrolled courses and 200 assignments (no N+1)
10. `pnpm run typecheck` passes

### Folder structure changes

```
artifacts/api-server/src/routes/
└── student/                     ← NEW directory
    └── index.ts                 ← NEW file
```

### New files to create

| File | Description |
|---|---|
| `routes/student/index.ts` | Express router with 5 student portal handlers |

### Existing files to modify

| File | Change |
|---|---|
| `routes/index.ts` | Register `studentRouter` at `/api/student` |
| `app.ts` | Confirm `/api/student` is not in the public route exclusion list |

### Dependency graph

```
requireRole('student') [Sprint 2]
buildScopeContext (A)
queryBuilders/assignments (C)
queryBuilders/assessments (D)
queryBuilders/notes (E)
queryBuilders/courses (F)
sessionEnricher reads course_enrollments (J)
    └── routes/student/index.ts
```

### Implementation order

1. Create `routes/student/` directory and `index.ts`
2. Register in `routes/index.ts`
3. Implement `/dashboard` (most complex — CTE query)
4. Implement `/subjects` and `/subjects/:courseId`
5. Implement `/assignments` (delegates to `listAssignments` with student scope)
6. Implement `/assessments` (delegates to `listAssessments` with student scope)
7. Integration tests (K)

### Risk level

**Medium.** Dashboard CTE must not produce N+1. The `studentId = null` edge case must be explicitly handled and tested. Unlinked student accounts are a realistic scenario during system rollout.

### Estimated effort

**1.5 days.**

---

## 9. H — Parent Portal Routes

### Purpose

Create the parent-facing API surface at `/api/parent/*`. Gated by `requireRole('parent')`. Parents access aggregated views of their children's data. Unlike student routes which return first-person data, parent routes return a list-of-children structure — each child's data is keyed by `student_id`.

### Inputs

- `ScopeContext` (A) — parent scope with `childStudentIds`
- All completed query builders (C, D, E, F)
- Deliverable J (SessionEnricher uses `course_enrollments`)
- Sprint 3 Section 6i (parent portal query patterns)
- Sprint 2 `requireRole` middleware

### Outputs

**New router:** `routes/parent/index.ts` with five handlers:

| Endpoint | Description |
|---|---|
| `GET /api/parent/dashboard` | Overview for all children: enrolled courses count, avg scores, pending assignments |
| `GET /api/parent/children` | List of linked children with summary statistics |
| `GET /api/parent/children/:studentId` | Single child profile — full detail |
| `GET /api/parent/children/:studentId/assignments` | Child's assignments — filterable by status, sorted by due date |
| `GET /api/parent/children/:studentId/assessments` | Child's assessment history |

All five handlers:
- Call `buildScopeContext(req.session)` at entry
- For `/:studentId` routes: assert `scope.childStudentIds.includes(parseInt(req.params.studentId))` — 403 if not in list
- Delegate DB access to query builders
- Return parent-specific DTOs

### Dependencies

- Deliverables A, B, C, D, E, F (all query builders)
- Deliverable J (accurate `childStudentIds` in session)
- Sprint 2 `requireRole` middleware

### Acceptance Criteria

1. `GET /api/parent/dashboard` — student session → 403
2. `GET /api/parent/children` — parent with `childStudentIds = []` → 200 `{ status: 'no_children_linked', children: [] }`
3. `GET /api/parent/children` — parent returns all linked children with summary stats
4. `GET /api/parent/children/:studentId` — student ID not in `childStudentIds` → 403
5. `GET /api/parent/children/:studentId/assignments` — returns only that child's assignments
6. `GET /api/parent/children/:studentId/assignments?status=pending` — filter applied
7. `GET /api/parent/children/:studentId/assessments` — returns only that child's assessments
8. All responses within 500ms for parent with 3 children across 10 courses
9. `pnpm run typecheck` passes

### Folder structure changes

```
artifacts/api-server/src/routes/
└── parent/                      ← NEW directory
    └── index.ts                 ← NEW file
```

### New files to create

| File | Description |
|---|---|
| `routes/parent/index.ts` | Express router with 5 parent portal handlers |

### Existing files to modify

| File | Change |
|---|---|
| `routes/index.ts` | Register `parentRouter` at `/api/parent` |
| `app.ts` | Confirm `/api/parent` is not in public exclusion list |

### Dependency graph

```
requireRole('parent') [Sprint 2]
buildScopeContext (A)
queryBuilders/* (C, D, E, F)
sessionEnricher reads course_enrollments (J)
    └── routes/parent/index.ts
```

### Implementation order

1. Create `routes/parent/` directory
2. Register in `routes/index.ts`
3. Implement child ID validation helper (reused across `:studentId` routes)
4. Implement `/children` and `/dashboard`
5. Implement `/children/:studentId`
6. Implement `/children/:studentId/assignments` and `/assessments`
7. Integration tests (K)

### Risk level

**Medium.** The `childStudentIds` authorization check in routes G and H is a manual list membership test — it must be applied consistently on every `/:studentId` route. A helper function for this check is recommended to avoid repetition.

### Estimated effort

**1.5 days.**

---

## 10. I — course_enrollments Migration

### Purpose

Execute the data migration from `students.enrolled_course_ids` JSON array to the `course_enrollments` join table. This is the highest-risk deliverable because it modifies existing data and changes the behaviour of the `SessionEnricherService`. It must be executed and verified before deliverables E, F, G, and H are put into production.

### Inputs

- `course_enrollments` Drizzle schema (Sprint 3 `courseEnrollments.ts` — already created in code generation)
- Existing `students.enrolled_course_ids` JSON data
- Sprint 3 migration steps CE-01 through CE-05 (PHASE2-SPRINT3.md Section 7b)
- A nominated admin user ID to use as `enrolled_by` for historical back-fill records

### Outputs

- `course_enrollments` table populated from JSON data
- CE-03 verification query confirms zero mismatched counts
- `students.enrolled_course_ids` column deprecated (comment added, not dropped)
- New `POST /api/courses/:id/enrol` and `DELETE /api/courses/:id/enrol/:studentId` endpoints serve all future enrollment changes (Deliverable F)
- Drizzle push or migration script executed

### Dependencies

- Sprint 1 DB migrations complete (course_enrollments schema created by `pnpm --filter @workspace/db run push`)
- Admin user ID 1 exists (seeded in Sprint 1 M-12)
- DBA access for CE-03 verification query

### Acceptance Criteria

1. `SELECT COUNT(*) FROM course_enrollments` equals the sum of all JSON array lengths across all student rows
2. CE-03 verification query returns zero rows (no count mismatches)
3. Every student with a non-empty `enrolled_course_ids` JSON array has corresponding active rows in `course_enrollments`
4. `course_enrollments` partial unique index `uq_course_enrollments_active` exists and is valid
5. A student with `enrolled_course_ids = '[1, 3]'` has exactly two rows in `course_enrollments WHERE is_active = TRUE`
6. A student with `enrolled_course_ids = '[]'` has zero rows in `course_enrollments`
7. The `students.enrolled_course_ids` column carries the deprecation comment
8. `SessionEnricherService` reads enrolled course IDs from `course_enrollments` after Deliverable J

### Folder structure changes

No application code changes. Database-only.

### New files to create

| File | Description |
|---|---|
| `scripts/src/migrate-course-enrollments.ts` | One-time migration script — reads JSON array from `students`, inserts into `course_enrollments`, runs verification |

### Existing files to modify

| File | Change |
|---|---|
| `scripts/package.json` | Add `migrate:enrollments` npm script |

### Dependency graph

```
lib/db schema (course_enrollments table — from code gen sprint)
scripts/src/migrate-course-enrollments.ts
    ← studentsTable (read enrolled_course_ids)
    ← courseEnrollmentsTable (insert rows)
    ← drizzle-orm
```

### Implementation order

1. Write migration script (`scripts/src/migrate-course-enrollments.ts`)
2. Run in development: `pnpm --filter @workspace/scripts run migrate:enrollments`
3. Execute CE-03 verification — confirm zero mismatches
4. Document actual row counts for DBA sign-off
5. Schedule production run (see Section 17)

### Risk level

**High.** This is the only deliverable that modifies existing production data. Key risks:
- JSON array parsing failures (malformed data) — migration script must handle gracefully
- Partial migration if script interrupted — `ON CONFLICT DO NOTHING` makes re-run safe
- Students added after migration start — migration is point-in-time; any enrolment changes during migration window must be applied to both old and new columns
- `is_active = false` rows not representable in the old JSON format — not a concern for back-fill (all existing JSON entries are active enrolments)

### Estimated effort

**1 day** — script writing, testing on dev data, DBA coordination, production execution and verification.

---

## 11. J — SessionEnricher Migration

### Purpose

Update `SessionEnricherService.enrichStudent()` to read `enrolledCourseIds` from `course_enrollments` instead of `students.enrolled_course_ids`. This changes the data source for the student session field that feeds all course-scoped query filters.

### Inputs

- Deliverable I complete (`course_enrollments` populated)
- Sprint 2 `services/sessionEnricher.ts` — existing file to modify
- `courseEnrollmentsTable` from `@workspace/db`

### Outputs

- Updated `services/sessionEnricher.ts` — `enrichStudent` queries `course_enrollments WHERE student_id = :studentId AND is_active = TRUE`
- Session payload unchanged in shape — `enrolledCourseIds: number[]` is still populated, just from a different source
- All consumers of `session.enrolledCourseIds` continue to work without changes

### Dependencies

- Deliverable I (course_enrollments must be populated before deploying this change)
- Sprint 2 `SessionEnricherService` (existing)
- `courseEnrollmentsTable` from `@workspace/db`

**Critical deployment constraint:** Deliverable I (data migration) must be deployed and verified before Deliverable J goes to production. If J is deployed before the migration, students will have empty `enrolledCourseIds` sessions and lose access to their course data.

### Acceptance Criteria

1. Login as a student whose `students.enrolled_course_ids = [1, 3]` → `session.enrolledCourseIds = [1, 3]` (reads from new table)
2. Login as a student who was enrolled via the new `POST /api/courses/:id/enrol` endpoint → `session.enrolledCourseIds` reflects the new enrolment
3. Login as a student with no `course_enrollments` rows → `session.enrolledCourseIds = []`
4. Login as a student with `studentId = null` → `session.enrolledCourseIds = []` (no DB query — account not linked)
5. `pnpm run typecheck` passes

### Folder structure changes

None.

### New files to create

None.

### Existing files to modify

| File | Change |
|---|---|
| `services/sessionEnricher.ts` | `enrichStudent` — replace `students.enrolled_course_ids` read with `course_enrollments` query |

### Dependency graph

```
course_enrollments table (I — must be populated)
    └── services/sessionEnricher.ts
            → session.enrolledCourseIds
                → queryBuilders/notes.ts (E) — scope filter
                → queryBuilders/courses.ts (F) — scope filter
                → routes/student/index.ts (G) — context
```

### Implementation order

1. Update `enrichStudent` query
2. Verify unit test: student with known `course_enrollments` rows gets correct `enrolledCourseIds`
3. Deploy only after CE-03 verification (Deliverable I) confirms data integrity

### Risk level

**Medium.** The change is small (one query swap) but the deployment order constraint is absolute. A deployment checklist item must block this from going to production before Deliverable I is confirmed complete.

### Estimated effort

**0.5 day.**

---

## 12. K — Integration Tests

### Purpose

Provide end-to-end verification of the full scope filter chain per the Sprint 3 completion criteria (SC-01 through SC-17). Tests run against a real test database — not mocks. Each test validates the complete HTTP request through middleware, query builder, and DB, returning a real response.

### Inputs

- All deliverables A–J complete
- Test database seeded with known fixture data:
  - 1 admin, 2 teachers, 3 students (student IDs 1, 2, 3), 2 parents
  - Student 1 enrolled in courses [10, 20]; Student 2 enrolled in course [10]; Student 3 unenrolled
  - Parent A linked to students [1, 2]; Parent B linked to no students
  - Assignments: 3 for student 1, 2 for student 2, 1 for student 3
  - Notes for courses 10 and 20

### Outputs

- Test file: `tests/integration/scope-filtering.test.ts`
- Test file: `tests/integration/portal-routes.test.ts`
- Seed fixture script: `tests/fixtures/rbac-seed.ts`
- All Sprint 3 completion criteria SC-01 through SC-16 verified

### Dependencies

- All deliverables A–J complete
- Test framework already configured in workspace (check `vitest` or equivalent in root `package.json`)
- Test database (separate from development database — use a separate `TEST_DATABASE_URL`)

### Acceptance Criteria (mirrors Sprint 3 SC-01 through SC-16)

| Test | Assertion |
|---|---|
| SC-01 | Student 1 `GET /api/assignments` → only 3 rows (student_id = 1) |
| SC-02 | Parent A `GET /api/assignments` → only 5 rows (students 1 and 2) |
| SC-03 | Teacher `GET /api/assignments` → all 6 rows |
| SC-04 | Student `GET /api/students` → 403 |
| SC-05 | Parent `POST /api/assignments` → 403 |
| SC-06 | Student 1 `GET /api/notes` → notes for courses 10 and 20 only |
| SC-07 | Parent A `GET /api/notes` → notes for courses 10 and 20 (union of children) |
| SC-08 | Student 1 `GET /api/assessments/:id` where assessment belongs to student 2 → 403 |
| SC-09 | Student 3 (unenrolled) `GET /api/notes` → `[]` |
| SC-10 | Parent B (no children) `GET /api/assignments` → `[]` |
| SC-11 | `course_enrollments` populated from JSON migration |
| SC-12 | SessionEnricher reads from `course_enrollments` |
| SC-13 | Student 1 `GET /api/student/subjects` → courses 10 and 20 with aggregate stats |
| SC-14 | Parent A `GET /api/parent/children` → students 1 and 2 with summary |
| SC-15 | All Sprint 2 admin and teacher tests pass unchanged |

### Folder structure changes

```
artifacts/api-server/
└── tests/
    ├── integration/
    │   ├── scope-filtering.test.ts    ← NEW
    │   └── portal-routes.test.ts      ← NEW
    └── fixtures/
        └── rbac-seed.ts               ← NEW
```

### New files to create

| File | Description |
|---|---|
| `tests/integration/scope-filtering.test.ts` | SC-01 through SC-12, SC-15 |
| `tests/integration/portal-routes.test.ts` | SC-13, SC-14 |
| `tests/fixtures/rbac-seed.ts` | Test database fixture — known users, students, enrollments, assignments |

### Existing files to modify

| File | Change |
|---|---|
| `package.json` (api-server) | Add `test` and `test:integration` scripts if not present |
| `.env.test` (create if absent) | `TEST_DATABASE_URL` for isolated test DB |

### Implementation order

1. Create fixture seed script and verify it populates expected rows
2. Write `scope-filtering.test.ts` — SC-01 through SC-10 (query filter tests)
3. Write `portal-routes.test.ts` — SC-13, SC-14 (portal endpoint tests)
4. Add SC-11, SC-12 (migration verification tests)
5. Run and confirm all green

### Risk level

**Medium.** Test database isolation is critical — tests must not affect the development database. The fixture seed must be idempotent (safe to run multiple times).

### Estimated effort

**1.5 days** — fixture design, test writing, environment setup.

---

## 13. L — Security Tests

### Purpose

Explicitly test adversarial scenarios — IDOR attacks, cross-scope access attempts, parent-child forgery patterns, mass assignment. These are separate from integration tests (K) because they test failure paths, not success paths. They must all return 403 or 404 with no data leakage.

### Inputs

- All deliverables A–J complete
- Same fixture data as Deliverable K
- Sprint 3 Section 8 (security review — seven attack scenarios documented)

### Outputs

- Test file: `tests/security/idor.test.ts`
- Test file: `tests/security/scope-bypass.test.ts`

### Dependencies

- All deliverables A–J
- Deliverable K fixtures (reuse `rbac-seed.ts`)

### Acceptance Criteria

| Test | Assertion |
|---|---|
| IDOR-01 | Student 1 `GET /api/assessments/:id` (assessment belongs to student 2) → 403, response body contains NO assessment data |
| IDOR-02 | Student 1 `GET /api/assignments/:id` (assignment belongs to student 2) → 403 |
| IDOR-03 | Parent A `GET /api/assignments/:id` (assignment belongs to student 3, not a child) → 403 |
| SCOPE-01 | Student 1 `GET /api/students` (list all) → 403 (no `students:list` permission) |
| SCOPE-02 | Student 1 `GET /api/notes/:id` (note for non-enrolled course) → 404, response body contains NO note data |
| SCOPE-03 | Parent A `GET /api/parent/children/3` (student 3 not a child of parent A) → 403 |
| SCOPE-04 | Student 1 `GET /api/dashboard/summary` → 403 (teacher dashboard blocked) |
| SCOPE-05 | Parent A `POST /api/assignments` → 403 |
| SCOPE-06 | Parent A `PATCH /api/assessments/:id` → 403 |
| EMPTY-01 | Student 3 (unenrolled, no `course_enrollments` rows) `GET /api/notes` → `[]`, not all notes |
| EMPTY-02 | Parent B (no children) `GET /api/assignments` → `[]`, not all assignments |
| EMPTY-03 | Student with `studentId = null` `GET /api/student/dashboard` → `{ status: 'not_enrolled' }`, not 500 |

### Folder structure changes

```
artifacts/api-server/
└── tests/
    └── security/
        ├── idor.test.ts             ← NEW
        └── scope-bypass.test.ts     ← NEW
```

### New files to create

| File | Description |
|---|---|
| `tests/security/idor.test.ts` | IDOR-01 through IDOR-03 |
| `tests/security/scope-bypass.test.ts` | SCOPE-01 through SCOPE-06, EMPTY-01 through EMPTY-03 |

### Existing files to modify

None.

### Implementation order

1. IDOR tests (most critical — complete first)
2. Scope bypass tests
3. Empty array edge case tests (last — lower severity but real production risk)

### Risk level

**High.** These tests validate the security model. Any failure here is a production security defect, not a functionality issue. All must pass before production deployment.

### Estimated effort

**1 day.**

---

## 14. Recommended Implementation Sequence

The sequence respects all dependency constraints and groups related work to minimise context switching.

```
Week 1
───────────────────────────────────────────────────────────────
Day 1   [ I ]  course_enrollments migration script + dev execution
        [ I ]  CE-03 verification + DBA sign-off on row counts
Day 1   [ A ]  ScopeContext interface + buildScopeContext + type guards
        [ B ]  Query builder framework — interfaces + five stubs

Day 2   [ B ]  Complete query builder framework
        [ C ]  Assignments query builder + route update
        [ D ]  Assessments query builder + route update

Day 3   [ J ]  SessionEnricher migration (now that CE-03 is verified)
        [ E ]  Notes query builder + route update
        [ F ]  Courses query builder + route update + enrolment endpoints

Day 4   [ G ]  Student portal routes (/api/student/*)
        [ H ]  Parent portal routes (/api/parent/*)

Day 5   [ K ]  Integration tests — fixture seed + scope filtering tests

Week 2
───────────────────────────────────────────────────────────────
Day 6   [ K ]  Integration tests — portal route tests + run full suite
        [ L ]  Security tests — IDOR + scope bypass

Day 7   [ L ]  Security tests — empty array edge cases + full security suite
               Full typecheck pass
               EXPLAIN ANALYZE on parent notes query (SC-17)
               Sprint 3 completion criteria review
```

**Parallelisation opportunities:**

| Parallel pair | Can be done simultaneously |
|---|---|
| C + D | Identical pattern — two developers can work on them in parallel |
| G + H | Student and parent portals have no shared files |
| K + L | Can be split across two developers once A–J are complete |

---

## 15. Git Commit Plan

Each commit is independently deployable (does not break main) and maps to one deliverable. The commit message format is `feat(sprint3): <description>`.

| # | Commit message | Files changed | Deployable alone? |
|---|---|---|---|
| 1 | `feat(sprint3): add course_enrollments migration script` | `scripts/src/migrate-course-enrollments.ts`, `scripts/package.json` | ✅ Script only — no runtime change |
| 2 | `feat(sprint3): add ScopeContext type and buildScopeContext factory` | `src/lib/scopeContext.ts`, `src/lib/index.ts` | ✅ Additive only |
| 3 | `feat(sprint3): add query builder framework and stubs` | `src/lib/queryBuilders/*.ts` (5 stubs + barrel) | ✅ Stubs compile but have no behaviour |
| 4 | `feat(sprint3): implement assignments scope filtering` | `src/lib/queryBuilders/assignments.ts`, `src/routes/assignments.ts` | ✅ After session enricher confirmed |
| 5 | `feat(sprint3): implement assessments scope filtering` | `src/lib/queryBuilders/assessments.ts`, `src/routes/assessments.ts` | ✅ Independent |
| 6 | `feat(sprint3): migrate SessionEnricher to course_enrollments` | `src/services/sessionEnricher.ts` | ⚠️ Must deploy AFTER migration script runs in prod |
| 7 | `feat(sprint3): implement notes scope filtering` | `src/lib/queryBuilders/notes.ts`, `src/routes/notes.ts` | ✅ After commit 6 deployed |
| 8 | `feat(sprint3): implement courses scope filtering and enrolment endpoints` | `src/lib/queryBuilders/courses.ts`, `src/routes/courses.ts` | ✅ After commit 6 deployed |
| 9 | `feat(sprint3): add student portal routes` | `src/routes/student/index.ts`, `src/routes/index.ts` | ✅ After commits 4–8 |
| 10 | `feat(sprint3): add parent portal routes` | `src/routes/parent/index.ts`, `src/routes/index.ts` | ✅ After commits 4–8 |
| 11 | `test(sprint3): add integration test fixtures and scope filter tests` | `tests/fixtures/rbac-seed.ts`, `tests/integration/scope-filtering.test.ts` | ✅ Test-only |
| 12 | `test(sprint3): add portal route integration tests` | `tests/integration/portal-routes.test.ts` | ✅ Test-only |
| 13 | `test(sprint3): add IDOR and scope bypass security tests` | `tests/security/idor.test.ts`, `tests/security/scope-bypass.test.ts` | ✅ Test-only |

**Commit 6 is the only commit with a hard deployment ordering constraint.** See Section 17 for the production deployment gate.

---

## 16. Rollback Strategy

Rollback is defined per risk tier. Only Deliverable I (the data migration) requires a database rollback plan. All other deliverables are code-only and roll back via git revert.

### Code rollback (all deliverables except I)

| Trigger | Action |
|---|---|
| Typecheck failure | `git revert <commit-sha>` — revert the offending commit |
| Integration test regression | `git revert <commit-sha>` — production code unchanged |
| Security test failure | Block production deployment; `git revert` + re-implement |
| 500 errors in production | NSSM service restart with previous build artifact |

All new files (query builders, portal routes, `lib/scopeContext.ts`) are entirely new — reverting them cannot break pre-existing behaviour. Modified files (`routes/assignments.ts`, etc.) are the regression risk; the route handlers are the only change surface.

**Pre-deployment build artefact:** Before deploying commit 4–10 to production, save the current compiled `dist/` output. On rollback, redeploy the saved artefact without touching the database.

---

### Data rollback — Deliverable I (course_enrollments migration)

The migration script does NOT modify or delete any existing data. `students.enrolled_course_ids` is unchanged. Rollback is therefore:

```
Rollback steps for Deliverable I:
─────────────────────────────────────────────────────────────────────────────
1. Revert commit 6 (SessionEnricher) → SessionEnricher reads from JSON again
2. TRUNCATE course_enrollments;
   — Safe: no application code depends on course_enrollments until commit 6
   — The JSON column is authoritative until commit 6 is in production

This is the full data rollback. No production data is lost.
─────────────────────────────────────────────────────────────────────────────
```

**Rollback window:** Commits 6 and 7 can be reverted independently of Deliverable I. The `course_enrollments` table can be left populated even if the application temporarily reverts to reading the JSON column — the two data sources are additive, not exclusive.

---

### Portal route rollback (Deliverables G, H)

Portal routes (`/api/student/*`, `/api/parent/*`) are entirely new paths. Reverting them:
1. Reverts the route registration in `routes/index.ts`
2. All existing routes are unaffected — they were never changed by G or H

No user data is affected. No session format changes.

---

## 17. Production Deployment Strategy

The production environment is Windows IIS + NSSM (`ClassmateAPI` service). Deployments happen by: copying the compiled `dist/` bundle to the server, then `nssm restart ClassmateAPI`.

### Deployment phases

Sprint 3 requires **two deployment windows**, not one. The data migration (Deliverable I) must complete and be verified before the application code that depends on it is deployed.

---

### Phase 1 — Data migration (Deliverable I)

**Pre-conditions:**
- Sprint 1 DB migrations verified in production (all 14 migration steps — `roles`, `permissions`, `user_roles`, `student_guardians`, `course_enrollments` tables exist)
- CE-03 verification query tested and passed in development
- Migration script tested against a production database dump (not the live production DB)
- Maintenance window confirmed with stakeholders: **estimated 5–10 minutes** (depends on student count)
- Nominated admin user ID confirmed for `enrolled_by` back-fill value

**Execution:**
```
Deployment Phase 1 steps:
─────────────────────────────────────────────────────────────────────────────
1. Copy migration script to production server
2. Set DATABASE_URL to production value
3. Run: node scripts/dist/migrate-course-enrollments.js
4. Run CE-03 verification query — confirm zero mismatches
5. Record actual row count in deployment log
6. Application remains running on previous code — no service restart
─────────────────────────────────────────────────────────────────────────────
```

**Go / No-Go gate:** CE-03 must return zero rows before Phase 2 is allowed to proceed.

---

### Phase 2 — Application code (Commits 4–10)

**Pre-conditions:**
- Phase 1 complete and verified
- All integration tests (K) and security tests (L) pass in the staging environment
- Previous production build artefact saved to a rollback location
- Maintenance window: **estimated 2–3 minutes** (NSSM service restart only)

**Execution:**
```
Deployment Phase 2 steps:
─────────────────────────────────────────────────────────────────────────────
1. Save current dist/ to rollback location:
   Copy-Item dist/ dist-rollback/ -Recurse
2. Copy new build artefact (commits 4–10 compiled) to dist/
3. nssm restart ClassmateAPI
4. Confirm health check: GET /api/healthz → 200
5. Smoke test:
   - Admin login → GET /api/students → 200
   - Student login → GET /api/student/subjects → 200 (enrolled courses)
   - Student login → GET /api/students → 403
   - Parent login → GET /api/parent/children → 200
6. Monitor logs for 10 minutes post-deploy
─────────────────────────────────────────────────────────────────────────────
```

**Rollback trigger:** Any non-200 on the smoke tests, or any `OWNERSHIP_DENIED` 403 response for a teacher or admin session, triggers immediate rollback:

```
Rollback execution:
─────────────────────────────────────────────────────────────────────────────
1. Copy-Item dist-rollback/ dist/ -Recurse -Force
2. nssm restart ClassmateAPI
3. Confirm health check: GET /api/healthz → 200
4. Note: course_enrollments data remains intact — no data rollback needed
   unless security test confirms data was corrupted (see Section 16)
─────────────────────────────────────────────────────────────────────────────
```

---

### Post-deployment verification checklist

| Check | Expected result | Actor |
|---|---|---|
| `GET /api/healthz` | 200 | Automated monitor |
| Admin `GET /api/students` | 200, all students | Dev smoke test |
| Teacher `GET /api/assignments` | 200, all assignments | Dev smoke test |
| Student login → `session.enrolledCourseIds` populated | Non-empty array for enrolled student | Dev smoke test |
| Student `GET /api/student/subjects` | 200, enrolled courses only | Dev smoke test |
| Student `GET /api/assessments/:other_student_id` | 403 | Security spot-check |
| Parent `GET /api/parent/children` | 200, linked children | Dev smoke test |
| Parent `POST /api/assignments` | 403 | Security spot-check |
| `EXPLAIN ANALYZE` parent notes query | Index scan confirmed | DBA |
| Log scan — no `OWNERSHIP_DENIED` for admin/teacher | Zero entries | Dev |
| Log scan — no 500 errors | Zero entries | Dev |

---

### NSSM session invalidation note

Deploying commit 6 (`SessionEnricher` migration) changes the source of `enrolledCourseIds` in session. **Existing active sessions** will still carry the old JSON-sourced `enrolledCourseIds` value until the session expires (8-hour TTL) or the user logs out and back in.

**Impact:** For the 8-hour window after Phase 2 deployment, a student whose enrollment changed (via the new `POST /enrol` endpoint) after Phase 1 but before their next login will have stale `enrolledCourseIds` in their session. The `checkRbacVersion` middleware (Sprint 2) only refreshes `permissions`, not `enrolledCourseIds`.

**Mitigation options (choose one before deployment):**
1. **Flush all sessions** — `DELETE FROM session WHERE expire > NOW()` — forces all users to re-login. Maximum disruption; cleanest state.
2. **Accept 8-hour staleness** — for most institutions, `enrolled_course_ids` does not change frequently. Document this as known behaviour.
3. **Schedule deployment outside school hours** — at an off-peak time when no active sessions exist.

Recommended: Option 3. For a school system, deploying at 11pm or on a weekend means effectively zero active sessions to invalidate.

---

*This blueprint is the authoritative implementation guide for Sprint 3 code generation. No work begins until this document is signed off.*
