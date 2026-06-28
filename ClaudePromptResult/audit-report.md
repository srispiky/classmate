# Architecture Audit Report

Classmate Connect — Sprint 4 Architecture Standardization  
Audit Date: 2025-06  
Auditor: Engineering team  

---

## Executive Summary

The Classmate Connect codebase is broadly compliant with the target layered architecture,
RBAC authorization model, and policy-based access control standards. The three-layer
authorization model (route, query filter, post-fetch validation) is consistently
implemented across all resource types introduced in Sprint 4.

Six deviations from the target standards were identified. None are blocking for current
feature development. Two are high-risk (UUID primary keys, denormalized data) and require
dedicated migration planning. Four are low-risk naming inconsistencies correctable in a
single safe-refactoring sprint.

No authorization logic violations were found in the policy or validator layers. One
architectural violation — inline role checks in route handlers — is present in all
write-operation routes and is documented below with a remediation path.

---

## Scope

This audit covers:

- Database schemas (`lib/db/src/schema/`)
- Route handlers (`artifacts/api-server/src/routes/`)
- Policy layer (`artifacts/api-server/src/lib/policies/`, `shared/auth/policies/`)
- Validator layer (`artifacts/api-server/src/lib/`, `shared/auth/`)
- Scope helpers (`lib/scope-filter.ts`, `lib/scope-context.ts`)
- Session enrichment (`lib/session-enricher.ts`)
- Query builders (`lib/assessments.queries.ts`, `lib/assignments.queries.ts`,
  `lib/notes.queries.ts`, `lib/courses.queries.ts`, `lib/announcements.queries.ts`)
- Test suite (`tests/authorization/`, `tests/domain/`, `lib/*.test.ts`)

---

## Compliant Areas

### C-001 — Table Naming

All database tables use `snake_case`, plural nouns as required.

```sql
courses, students, users, course_enrollments, assignments, assessments,
notes, announcements, roles, permissions, role_permissions, user_roles,
student_guardians
```

### C-002 — Column Naming

All columns use `snake_case`. Standard timestamp columns (`created_at`, `updated_at`,
`deleted_at`) follow the documented convention.

### C-003 — Timestamp Types

All timestamp columns use `timestamptz` via Drizzle's `{ withTimezone: true }` option.
No bare `timestamp` columns exist in the schema.

### C-004 — Soft Delete Implementation

All business entity tables include a `deleted_at` column. All `build*Conditions()`
query builder functions append `isNull(table.deletedAt)` as the final WHERE condition.
All GET-by-ID route handlers apply the soft-delete guard before the Layer 3 check.
Affected tables: `courses`, `assignments`, `assessments`, `notes`, `announcements`.

### C-005 — Policy Interface Consistency

All five resource types implement the `ResourceScopePolicy<TResource>` interface:
`AssignmentScopePolicy`, `AssessmentScopePolicy`, `NotesScopePolicy`,
`AnnouncementScopePolicy`, `CourseScopePolicy`. Each is exported as a singleton.

### C-006 — Three-Layer Authorization Model

Layer 1 (route), Layer 2 (query filter via `getScopeCondition`), and Layer 3
(post-fetch via `validateAccess`) are implemented consistently across all resource types.

### C-007 — ScopeContext Pattern

`buildScopeContext()` is called at the entry of every route handler. `req.session` is
never passed into query builders or policies. `ScopeContext` is a pure value object.

### C-008 — SQL_FALSE Sentinel

`SQL_FALSE` is used consistently for empty-scope conditions (empty `ownedCourseIds`,
empty `enrolledCourseIds`, unlinked student). All test assertions use `toBe(SQL_FALSE)`
to verify blocked scopes explicitly.

### C-009 — Session Enrichment Architecture

`SessionEnricherService` pre-computes `enrolledCourseIds`, `childStudentIds`,
`childCourseIds`, `teacherId`, and `ownedCourseIds` at login time. No per-request
JOIN chains for authorization scope fields.

### C-010 — TypeScript Class Naming

All classes follow PascalCase with role-expressing names: `CourseScopePolicy`,
`TeacherScopeValidator`, `SessionEnricherService`, `NotesScopePolicy`.

### C-011 — Input Validation

All route handlers validate request bodies and route parameters with Zod `safeParse()`
before any database access. The domain-schema pattern (field-level schemas composed into
insert/update schemas) is consistently applied in `lib/db/src/schema/courses.ts`.

### C-012 — Unique Index Naming

Unique indexes use the `uq_` prefix consistently: `uq_course_enrollments_active`,
`uq_role_permissions`, `uq_student_guardians`, `uq_students_user_id`.

### C-013 — Test Coverage

866 tests across 22 test files, all passing. Authorization coverage includes:
Layer 2 condition tests, Layer 3 `validateAccess` tests, IDOR regression tests,
soft-delete security tests, scope boundary tests, and access matrix tests.

---

## Non-Compliant Areas

### N-001 — Authorization Logic in Route Handlers (Layer 1)

**Standard:** Authorization logic must exist only in Policies, Validators, and Scope
helpers. Route handlers (controllers) must not contain authorization decisions.

**Current state:** Write-operation routes (`POST`, `PUT`, `DELETE`) perform inline role
checks:

```ts
// Found in routes/courses.ts, routes/notes.ts, routes/assessments.ts, etc.
if (scope.role !== "admin" && scope.role !== "teacher") {
  res.status(403).json({ error: "Access denied", code: "OWNERSHIP_DENIED" });
  return;
}
```

**Risk:** Medium. Inline checks are functional but not centrally auditable. Adding a new
role or changing access rules requires a grep across all route files.

**Remediation:** Introduce a `requireRole(...roles: RoleKey[])` middleware factory:

```ts
function requireRole(...allowed: RoleKey[]): RequestHandler {
  return (req, res, next) => {
    const scope = buildScopeContext(req.session as ClassmateSession);
    if (!allowed.includes(scope.role)) {
      res.status(403).json({ error: "Access denied", code: "OWNERSHIP_DENIED" });
      return;
    }
    next();
  };
}

// Usage
router.post("/courses", requireRole("admin", "teacher"), async (req, res) => {
  // no role check needed here
});
```

**Priority:** Medium. Existing behavior is correct; this is an architectural cleanliness
improvement.

---

### N-002 — Primary Key Type: `serial` instead of `uuid`

**Standard:** All tables should use `uuid` primary keys (`gen_random_uuid()`).

**Current state:** All tables use `serial` (auto-increment integer) primary keys.

**Risk:** High (for migration). The current implementation is not wrong — integer PKs are
performant and widely used. Migration to UUID is a breaking schema change affecting every
table and every FK column in the database.

**Remediation:** Plan as a dedicated migration sprint with:
1. Full production backup
2. Staged migration (add UUID column → populate → switch FK references → drop integer column)
3. Zero-downtime deployment strategy
4. Session invalidation (all existing sessions reference integer user IDs)

See ADR-005 for the detailed migration checklist.

**Priority:** Low (correctness) / High (risk when executed).

---

### N-003 — `updated_at` Missing from Four Tables

**Standard:** All mutable tables should carry an `updated_at` column.

**Current state:** The following tables have no `updated_at` column:

| Table | Has `created_at` | Has `updated_at` | Has `deleted_at` |
|---|---|---|---|
| `assignments` | ✓ | ✗ | ✓ |
| `assessments` | ✓ | ✗ | ✓ |
| `notes` | ✓ | ✗ | ✓ |
| `activity` | ✓ | ✗ | — |

**Risk:** Low-medium. Missing `updated_at` prevents accurate audit trails and
optimistic-concurrency checks on these tables.

**Remediation:** Add `updated_at timestamptz NOT NULL DEFAULT NOW()` to each table.
For `courses.ts` the `updated_at` update is already implemented in route handlers
(`updatedAt: new Date()`). The same pattern must be applied after this column is added
to the other tables.

Execute via `executeSql` (not `drizzle-kit push`, which is interactive):

```sql
ALTER TABLE assignments ADD COLUMN updated_at timestamptz NOT NULL DEFAULT NOW();
ALTER TABLE assessments ADD COLUMN updated_at timestamptz NOT NULL DEFAULT NOW();
ALTER TABLE notes       ADD COLUMN updated_at timestamptz NOT NULL DEFAULT NOW();
ALTER TABLE activity    ADD COLUMN updated_at timestamptz NOT NULL DEFAULT NOW();
```

**Priority:** Medium.

---

### N-004 — Index Naming: `idx_` instead of `ix_`

**Standard:** Indexes use the `ix_` prefix.

**Current state:** Four non-unique indexes use `idx_`:

```sql
idx_course_enrollments_student_id
idx_course_enrollments_course_id
idx_student_guardians_user_id
idx_user_roles_user_id
```

**Risk:** Low. Cosmetic only. Does not affect query plans or application behavior.

**Remediation:** Include in next schema migration batch:

```sql
ALTER INDEX idx_course_enrollments_student_id RENAME TO ix_course_enrollments_student_id;
ALTER INDEX idx_course_enrollments_course_id  RENAME TO ix_course_enrollments_course_id;
ALTER INDEX idx_student_guardians_user_id     RENAME TO ix_student_guardians_user_id;
ALTER INDEX idx_user_roles_user_id            RENAME TO ix_user_roles_user_id;
```

Update corresponding Drizzle schema files to match.

**Priority:** Low.

---

### N-005 — Check Constraint Naming: `chk_` instead of `ck_`

**Standard:** Check constraints use the `ck_` prefix.

**Current state:** One check constraint uses `chk_`:

```sql
chk_users_role    → ck_users_role
```

**Risk:** Low. Cosmetic only.

**Remediation:**

```sql
ALTER TABLE users RENAME CONSTRAINT chk_users_role TO ck_users_role;
```

Update `lib/db/src/schema/users.ts` to match.

**Priority:** Low.

---

### N-006 — Denormalized Data on `students` and `courses`

**Standard:** Avoid denormalized arrays and counters for relational data.

**Current state:**

1. `students.enrolled_course_ids` — a `json` column storing an array of course IDs.
   This duplicates information in `course_enrollments.course_id` and can drift out of sync.

2. `courses.student_count` — an integer column storing the count of enrolled students.
   This can drift from the actual count in `course_enrollments`.

**Risk:** Medium. The denormalized fields are used by the session enricher
(`enrolledCourseIds`) and by course serialization (`studentCount`). Removing them
requires: updating `SessionEnricherService` to query `course_enrollments` directly,
updating all course serializers, and verifying no frontend breakage.

**Remediation:**

1. Replace `students.enrolled_course_ids` with a query against `course_enrollments`
   in `SessionEnricherService.enrichStudent()`. Remove the column from the schema.
2. Replace `courses.student_count` with a subquery or a view (`v_course_summary`).

These changes require coordinated frontend and backend updates and should be planned
as a dedicated normalization sprint.

**Priority:** Medium.

---

### N-007 — Dual Teacher Scope Behaviors (Architectural Inconsistency)

**Standard:** Teacher role behavior should be consistent across all resource types.

**Current state:** Two conflicting behaviors exist for the teacher role depending on
which scope helper is used:

| Helper | Teacher behavior | Resources using it |
|---|---|---|
| `courseIdScopeFilter` (via `isGlobal`) | **Global** — all rows visible | notes, announcements |
| `applyTeacherScopeFilter` | **Ownership-scoped** — only owned courses | courses |

This means a teacher can see notes from any course (global) but can only see courses
they own. The intended long-term behavior should be documented and enforced consistently.

**Risk:** Medium. Not a security vulnerability (teachers have global note/announcement
access by design in the current model), but it creates confusion and may need revisiting
as the authorization model matures.

**Remediation:** Decide on the intended teacher behavior for each resource type and
document it explicitly in `docs/architecture/authorization-standards.md`. If teacher
ownership should be enforced for notes and announcements, migrate those policies to use
`applyTeacherScopeFilter`.

**Priority:** Medium. Requires a product decision before implementation.

---

### N-008 — `users` Table Variable Named `users` (not `usersTable`)

**Standard:** Table variables use the `Table` suffix convention.

**Current state:** `export const users = pgTable("users", ...)` — all other tables
follow `coursesTable`, `studentsTable`, etc.

**Risk:** Low. TypeScript rename only; no database change.

**Remediation:** Rename the export to `usersTable` and update all import sites. Run
`pnpm run typecheck` to verify. Affects: `lib/db/src/schema/users.ts` and all files
importing `users` from `@workspace/db`.

**Priority:** Low.

---

### N-009 — OpenAPI Spec and Generated Schemas Are Stale

**Standard:** Generated schemas must reflect the current API contract.

**Current state:** The OpenAPI spec and generated `@workspace/api-zod` schemas for
courses do not include the Sprint 4 additions: `grade`, `academicYear`, `teacherId`,
`status`. Route handlers use the domain schemas (`createCourseInputSchema` from
`@workspace/db`) to work around the stale generated schemas.

**Risk:** Medium. Frontend React Query hooks are generated from the stale spec, meaning
the frontend may not send or receive the new fields without manual updates.

**Remediation:**

1. Update `lib/api-spec/openapi.yaml` to include the new course fields.
2. Run `pnpm --filter @workspace/api-spec run codegen`.
3. Update frontend components to use the new fields from the regenerated hooks.

**Priority:** High (frontend correctness depends on this).

---

## Risk Assessment Summary

| Deviation | Risk | Priority | Effort |
|---|---|---|---|
| N-001 Authorization in route handlers | Medium | Medium | Low (middleware refactor) |
| N-002 Serial vs UUID primary keys | High (migration risk) | Low (correctness) | Very High |
| N-003 Missing `updated_at` columns | Low-Medium | Medium | Low (4 ALTER TABLEs) |
| N-004 Index naming (`idx_` vs `ix_`) | Low | Low | Low |
| N-005 Constraint naming (`chk_` vs `ck_`) | Low | Low | Low |
| N-006 Denormalized data | Medium | Medium | High |
| N-007 Dual teacher scope behaviors | Medium | Medium | Medium (product decision) |
| N-008 `users` table variable name | Low | Low | Low |
| N-009 Stale OpenAPI spec | Medium | High | Low-Medium |

---

## Recommended Remediation Order

**Sprint 4 (safe refactoring — this sprint):**

- N-001: Introduce `requireRole()` middleware to eliminate inline role checks.
- N-004: Rename `idx_` indexes to `ix_` in schema files and database.
- N-005: Rename `chk_users_role` constraint to `ck_users_role`.
- N-008: Rename `users` export to `usersTable`.
- N-009: Update OpenAPI spec and run codegen for courses.

**Sprint 5 (data model hardening):**

- N-003: Add `updated_at` to four tables.
- N-007: Resolve dual teacher scope behavior (product decision required).

**Dedicated Migration Sprint (high-risk, planned separately):**

- N-002: Migrate primary keys to UUID.
- N-006: Normalize `enrolled_course_ids` and `student_count`.
