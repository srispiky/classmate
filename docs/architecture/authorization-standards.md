# Authorization Standards

Classmate Connect — RBAC / Policy-Based Authorization

---

## Overview

Classmate Connect uses a three-layer, policy-based authorization model that applies
defense-in-depth: no single failure point can expose unauthorized data. Every resource
access must traverse all three layers.

---

## Roles

| Role | Description |
|---|---|
| `admin` | Full access to all resources |
| `teacher` | Access to owned courses and all student data within those courses |
| `student` | Access to own data and enrolled courses |
| `parent` | Access to linked children's data and those children's enrolled courses |
| `guest` | No data access (effectively read-only on public resources only) |

Roles are stored in the `users.role` column (enforced by a database check constraint).

---

## Three-Layer Authorization Model

```
Request
   │
   ▼
┌─────────────────────────────────────────────────────────┐
│  Layer 1 — Route Authorization                          │
│  Middleware: requireAuth + role check                   │
│  Responsibility: "Is the caller allowed to perform      │
│  this operation at all?" (e.g. only admin/teacher        │
│  may create courses)                                    │
└────────────────────────┬────────────────────────────────┘
                         │ pass
                         ▼
┌─────────────────────────────────────────────────────────┐
│  Layer 2 — Query Filtering (Scope Filter)               │
│  Implemented in: build*Conditions() functions           │
│  Delegates to: ResourceScopePolicy.getScopeCondition()  │
│  Responsibility: "Which rows is the caller allowed      │
│  to retrieve?" — applied as SQL WHERE conditions.       │
│  Unauthorized rows never reach application memory.      │
└────────────────────────┬────────────────────────────────┘
                         │ rows returned
                         ▼
┌─────────────────────────────────────────────────────────┐
│  Layer 3 — Post-Fetch Validation                        │
│  Implemented in: ResourceScopePolicy.validateAccess()   │
│  Responsibility: "Does the caller own this specific     │
│  row?" — defense-in-depth guard after any direct        │
│  fetch-by-ID that bypasses Layer 2 filters.             │
│  Returns 403 OWNERSHIP_DENIED on failure.               │
└─────────────────────────────────────────────────────────┘
```

### Layer 1 — Route Authorization

Enforced by middleware registered on the Express router. The `requireAuth` middleware
checks for a valid session. Role-specific guards (admin, teacher, etc.) should be
implemented as reusable middleware, not inline `if` checks in route handlers.

**Target pattern (middleware):**

```ts
// Correct — authorization in middleware
router.post("/courses", requireRole("admin", "teacher"), async (req, res) => {
  // no role check here
});

// Current state (violates standard) — authorization in route handler
router.post("/courses", async (req, res) => {
  if (scope.role !== "admin" && scope.role !== "teacher") {
    res.status(403).json({ ... });
  }
});
```

### Layer 2 — Query Filtering

All `build*Conditions()` functions apply the scope filter as the first WHERE condition.
Conditions are built from `ScopeContext`, not from `req.session` directly.

```ts
export function buildCourseListConditions(scope: ScopeContext, filters: Partial<CourseFilters>): SQL[] {
  const conditions: SQL[] = [];
  const scopeFilter = coursePolicy.getScopeCondition(scope);
  if (scopeFilter !== undefined) conditions.push(scopeFilter);
  // resource-specific filters...
  conditions.push(isNull(coursesTable.deletedAt)); // soft-delete guard always last
  return conditions;
}
```

Layer 2 conditions always append `isNull(table.deletedAt)` as the final condition.
This is the soft-delete guard — it is never optional.

### Layer 3 — Post-Fetch Validation

Applied after `getById()` calls. Prevents IDOR (Insecure Direct Object Reference) attacks
where a caller supplies an ID for a resource they do not own.

```ts
const course = await getCourseById(id);
if (!course) { res.status(404).json(...); return; }

try {
  coursePolicy.validateAccess(scope, course);
} catch (err) {
  if (err instanceof PolicyAuthorizationError) {
    res.status(403).json(ownershipDenied("course", id));
    return;
  }
  throw err;
}
```

Return `403 OWNERSHIP_DENIED`, not `404`, when a resource exists but is outside the
requester's scope. This distinguishes "not found" from "found but access denied",
which is required for audit logging and security incident investigation.

---

## ScopeContext

`ScopeContext` is the single normalized authorization context passed to all query builders
and policy validators. It is built once per request from the enriched session.

```ts
interface ScopeContext {
  role: RoleKey;
  isGlobal: boolean;           // true for admin and teacher (student-scoped resources)
  userId: number;
  studentId: number | null;    // student role only
  enrolledCourseIds: number[]; // student role only
  childStudentIds: number[];   // parent role only
  childCourseIds: number[];    // parent role only (pre-computed at login)
  teacherId: number | null;    // teacher role only
  ownedCourseIds: number[];    // teacher role only (pre-computed at login)
}
```

**Rules:**

- Build `ScopeContext` exactly once per request at the route handler entry point.
- Never pass `req.session` into query builders or policies — use `ScopeContext` only.
- `ScopeContext` is a pure value: no methods, no DB access, no side effects.

---

## ResourceScopePolicy Interface

```ts
interface ResourceScopePolicy<TResource> {
  getScopeCondition(scope: ScopeContext): SQL | undefined;
  validateAccess(scope: ScopeContext, resource: TResource): void;
}
```

Every resource type has exactly one policy that implements this interface.

| Policy | Resource | Scope Filter Column |
|---|---|---|
| `AssignmentScopePolicy` | assignments | `student_id` |
| `AssessmentScopePolicy` | assessments | `student_id` |
| `NotesScopePolicy` | notes | `course_id` (isGlobal for teacher) |
| `AnnouncementScopePolicy` | announcements | `course_id` |
| `CourseScopePolicy` | courses | `courses.id` (ownership-scoped for teacher) |

---

## Scope Filter Functions

Two primitive scope filter functions in `lib/scope-filter.ts`:

| Function | Column type | Teacher behavior |
|---|---|---|
| `studentIdScopeFilter` | `student_id` FK | Global (full table — `isGlobal = true`) |
| `courseIdScopeFilter` | `course_id` FK | Global (full table — `isGlobal = true`) |

One ownership-enforcing scope filter in `shared/auth/teacher-scope-validator.ts`:

| Function | Column type | Teacher behavior |
|---|---|---|
| `applyTeacherScopeFilter` | `course_id` or `courses.id` | Ownership-scoped (`ownedCourseIds`) |

`applyTeacherScopeFilter` is used by `CourseScopePolicy`. All other policies currently
use the global-access filters. Future resources that enforce teacher ownership should
use `applyTeacherScopeFilter`.

---

## Session Enrichment

`SessionEnricherService` pre-computes expensive lookups at login time and stores them
in the session. This avoids per-request DB joins for common scope fields.

| Field enriched | Computed by |
|---|---|
| `enrolledCourseIds` | `enrichStudent()` — queries course_enrollments |
| `childStudentIds`, `childCourseIds` | `enrichParent()` — queries student_guardians + course_enrollments |
| `teacherId`, `ownedCourseIds` | `enrichTeacher()` — queries courses |

Session fields are populated at login and must be refreshed when the underlying data
changes (e.g. a teacher is assigned a new course).

---

## Authorization Placement Rules

| Location | Authorization allowed? |
|---|---|
| Policies | **Yes** — the only authorized location for authorization decisions |
| Validators | **Yes** — scope and ownership helpers called by policies |
| Scope helpers (`scope-filter.ts`, `teacher-scope-validator.ts`) | **Yes** — primitive filter builders |
| Middleware (`requireAuth`, `requireRole`) | **Yes** — Layer 1 only |
| Route handlers | **No** (current deviation — see audit report) |
| Query builders (repositories) | **No** |
| Services | **No** |

---

## SQL_FALSE Sentinel

`SQL_FALSE` (`sql\`false\``) is the canonical zero-row sentinel returned when a scope
constraint produces an empty set (e.g. a teacher with no owned courses, a student with
no enrolled courses). It is a valid Drizzle `SQL` expression — callers do not need to
special-case it.

Using `SQL_FALSE` rather than an empty `inArray()` avoids a Drizzle error on empty arrays
and makes test assertions explicit: `expect(conditions[0]).toBe(SQL_FALSE)`.
