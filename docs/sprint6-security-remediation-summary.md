# Sprint 6 — Security Remediation Summary

**Date:** 2026-06-09
**Status:** All findings closed

---

## Findings Closed

| ID | Severity | Title | Status |
|----|----------|-------|--------|
| S-01 | CRITICAL | Admin routes unguarded | CLOSED |
| S-02 | HIGH | Student IDOR — ownership enforcement missing | CLOSED |
| AF-01 | MEDIUM | Student creation missing `createdBy` | CLOSED |
| AF-02 | MEDIUM | Student updates missing `updatedBy` / `updatedAt` | CLOSED |

---

## S-01 — Admin Routes Hardened

### Backend

**File:** `artifacts/api-server/src/routes/admin.ts`

Both handlers now require `requireRole("admin")` in addition to the existing `requireAuth()` middleware:

```
GET  /admin/db-status   → requireAuth() → requireRole("admin") → handler
POST /admin/test-db     → requireAuth() → requireRole("admin") → handler
```

Teacher, student, parent, and guest all receive `403 Forbidden`.

### Frontend

**Files:** `artifacts/classmate/src/App.tsx`, `artifacts/classmate/src/components/layout.tsx`

- `/settings` route is conditionally rendered — the component is never mounted for non-admin users
- Non-admin direct URL access to `/settings` triggers an immediate redirect to `/`
- Settings nav item is hidden from the sidebar for all non-admin roles; only visible when `user.role === "admin"`

---

## S-02 — Student IDOR Fixed

### New Policy

**File:** `artifacts/api-server/src/lib/policies/student-scope-policy.ts`

`StudentScopePolicy` implements the existing `ResourceScopePolicy<T>` interface, consistent with `AssignmentScopePolicy` and `CourseScopePolicy`.

### New Scope Filter

**File:** `artifacts/api-server/src/lib/scope-filter.ts`

`teacherStudentEnrollmentFilter(studentIdColumn, ownedCourseIds)` — new primitive that generates a correlated subquery:

```sql
students.id IN (
  SELECT DISTINCT ce.student_id
  FROM course_enrollments ce
  WHERE ce.course_id = ANY(ARRAY[...ownedCourseIds]::integer[])
  AND ce.is_active = true
)
```

Returns `SQL_FALSE` when `ownedCourseIds` is empty.

### Layer 2 — List Scope Filter

**Endpoint:** `GET /students`

| Role | Condition |
|------|-----------|
| admin | No filter — full table |
| teacher | `students.id IN (SELECT student_id FROM course_enrollments WHERE course_id IN ownedCourseIds)` |
| other | `SQL_FALSE` — zero rows |

### Layer 3 — Single-Record Ownership

**Endpoints:** `GET /students/:id`, `PATCH /students/:id`, `DELETE /students/:id`, `GET /students/:id/progress`

Route handler flow:
1. Fetch student by ID (404 if not found or soft-deleted)
2. Fetch student's active enrolled course IDs from `course_enrollments`
3. Call `studentPolicy.validateAccess(scope, { id, enrolledCourseIds })`
4. Policy checks `scope.ownedCourseIds ∩ enrolledCourseIds ≠ ∅` for teachers
5. `PolicyAuthorizationError` thrown → 403 response

Admin always passes. Authorization stays in the policy — not in the controller or repository.

---

## AF-01 — createdBy Populated

**Endpoint:** `POST /students`

`createdBy` and `updatedBy` are now set from `scope.userId` on every student insert:

```ts
await db.insert(studentsTable).values({
  ...fields,
  createdBy: scope.userId,
  updatedBy: scope.userId,
});
```

---

## AF-02 — updatedBy / updatedAt Populated

**Endpoint:** `PATCH /students/:id`

`updatedBy` and `updatedAt` are now set from session on every student update:

```ts
await db.update(studentsTable).set({
  ...parsed.data,
  updatedBy: scope.userId,
  updatedAt: new Date(),
});
```

---

## Migration Details

```sql
ALTER TABLE students
  ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN created_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
```

Applied via `psql "$DATABASE_URL"`.

---

## OpenAPI Changes

**File:** `lib/api-spec/openapi.yaml`

`Student` schema updated:

| Field | Type | Required | Change |
|-------|------|----------|--------|
| `updatedAt` | string | Yes | Added |
| `createdBy` | integer (nullable) | No | Added |
| `updatedBy` | integer (nullable) | No | Added |

Codegen re-run (`pnpm --filter @workspace/api-spec run codegen`) — all barrel checks passed.

---

## Files Modified

| File | Change |
|------|--------|
| `artifacts/api-server/src/routes/admin.ts` | Added `requireRole("admin")` to both handlers |
| `artifacts/api-server/src/routes/students.ts` | Layer 2 + Layer 3 + audit field population |
| `artifacts/api-server/src/lib/scope-filter.ts` | Added `teacherStudentEnrollmentFilter` |
| `artifacts/api-server/src/lib/policies/student-scope-policy.ts` | New file — `StudentScopePolicy` |
| `lib/db/src/schema/students.ts` | Added `updatedAt`, `updatedBy`, `createdBy` columns |
| `lib/api-spec/openapi.yaml` | `Student` schema updated with new audit fields |
| `artifacts/classmate/src/App.tsx` | `/settings` route gated to `user.role === "admin"` |
| `artifacts/classmate/src/components/layout.tsx` | Settings nav item hidden for non-admins |
| `artifacts/api-server/src/tests/security-remediation.test.ts` | New test file — 48 tests |

---

## Architecture Review

Authorization remains exclusively in:
- **Policies** (`StudentScopePolicy`, `teacherStudentEnrollmentFilter`)
- **Middleware** (`requireRole`)

Not in:
- Controllers / route handlers (they only call the policy and map errors to HTTP codes)
- Repositories

Consistent with: `CourseScopePolicy`, `AssignmentScopePolicy`, `AssessmentScopePolicy`.

---

## Security Verification

### S-01 — Admin Route Guard

| Role | `GET /admin/db-status` | `POST /admin/test-db` |
|------|------------------------|----------------------|
| admin | PASS (allowed) | PASS (allowed) |
| teacher | PASS (403) | PASS (403) |
| student | PASS (403) | PASS (403) |
| parent | PASS (403) | PASS (403) |
| guest | PASS (403) | PASS (403) |

### S-02 — Student Ownership

| Scenario | Expected | Result |
|----------|----------|--------|
| Teacher A accesses Student A (enrolled in Course A) | Allowed | PASS |
| Teacher A accesses Student B (enrolled in Course B only) | 403 | PASS |
| Teacher B accesses Student B (enrolled in Course B) | Allowed | PASS |
| Teacher B accesses Student A (enrolled in Course A only) | 403 | PASS |
| Admin accesses Student A | Allowed | PASS |
| Admin accesses Student B | Allowed | PASS |
| Teacher with no courses — any student | 403 | PASS |
| Layer 2: teacher with courses returns SQL (not SQL_FALSE) | SQL subquery | PASS |
| Layer 2: teacher with no courses returns SQL_FALSE | SQL_FALSE | PASS |
| Layer 2: admin returns undefined (no filter) | undefined | PASS |

---

## Test Results

**New test file:** `artifacts/api-server/src/tests/security-remediation.test.ts` — 48 tests

**Full suite:** 1375 / 1375 passing (38 test files)

| Suite | Tests | Result |
|-------|-------|--------|
| S-01 admin route gating | 10 | PASS |
| S-02 Layer 2 getScopeCondition | 6 | PASS |
| S-02 teacherStudentEnrollmentFilter | 2 | PASS |
| S-02 Layer 3 validateAccess (unit) | 12 | PASS |
| S-02 Ownership integration (live DB) | 8 | PASS |
| AF-01 createdBy schema + ORM | 3 | PASS |
| AF-02 updatedBy / updatedAt | 4 | PASS |
| Architecture verification | 3 | PASS |
| All pre-existing tests | 1327 | PASS |
| **Total** | **1375** | **PASS** |
