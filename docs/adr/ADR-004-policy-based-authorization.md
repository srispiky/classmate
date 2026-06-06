# ADR-004 — Policy-Based Authorization

**Status:** Accepted  
**Date:** 2025-06  
**Deciders:** Engineering team  

---

## Context

As the number of resource types grows (courses, assignments, assessments, notes,
announcements), authorization logic must be applied consistently to each. Without a
standard interface, each resource would implement its own ad-hoc authorization checks,
leading to inconsistencies and coverage gaps.

The core challenge: authorization for a given resource type is needed in two places:

1. **Query time** — to build a SQL WHERE condition that restricts which rows are returned.
2. **Post-fetch time** — to validate that a specific fetched row is within the caller's scope.

These two concerns must share the same rules. If they diverge, an attacker can bypass
one layer while the other still believes access is granted.

---

## Decision

Define a `ResourceScopePolicy<TResource>` interface that every resource type must implement.

```ts
interface ResourceScopePolicy<TResource> {
  /**
   * Layer 2 — Returns a Drizzle SQL condition that restricts which rows
   * the caller may retrieve. Returns undefined for admins (no filter).
   * Returns SQL_FALSE when the caller's scope is empty.
   */
  getScopeCondition(scope: ScopeContext): SQL | undefined;

  /**
   * Layer 3 — Validates that the caller may access this specific resource.
   * Throws PolicyAuthorizationError when access is denied.
   */
  validateAccess(scope: ScopeContext, resource: TResource): void;
}
```

Each policy class is a thin adapter: it delegates all actual authorization logic to
the appropriate scope helper function. This keeps the policy class small, consistent,
and easy to audit.

### Policy registry (current)

| Policy class | Resource | Scope type |
|---|---|---|
| `AssignmentScopePolicy` | assignments | student-scoped |
| `AssessmentScopePolicy` | assessments | student-scoped |
| `NotesScopePolicy` | notes | course-scoped (teacher = global) |
| `AnnouncementScopePolicy` | announcements | course-scoped (teacher = global) |
| `CourseScopePolicy` | courses | course-scoped (teacher = ownership) |

### Error type hierarchy

```
PolicyAuthorizationError
├── CourseAuthorizationError    (course_id not in scope)
├── StudentAuthorizationError   (student_id not in scope)
└── (future resource types)
```

All errors extend `PolicyAuthorizationError`. Route handlers catch only the base class,
keeping the catch block stable as new resource types are added.

### Singleton exports

Each policy is exported as a singleton:

```ts
export const coursePolicy = new CourseScopePolicy();
export const assignmentPolicy = new AssignmentScopePolicy();
```

Consumers import the singleton — they never instantiate the class themselves.

---

## Consequences

**Benefits:**

- One interface to audit for every resource type. A security review checks every
  `ResourceScopePolicy` implementation.
- `getScopeCondition` and `validateAccess` always share the same underlying logic
  (both delegate to the same scope helper), eliminating divergence between Layer 2
  and Layer 3.
- Adding a new resource type follows a known pattern: implement the interface,
  export a singleton, wire into the query builder and route handler.
- Error handling in route handlers is uniform: catch `PolicyAuthorizationError`,
  return 403.

**Trade-offs:**

- Thin adapter classes add boilerplate. Mitigated by the fact that each class is
  typically 10–20 lines.
- Policy behavior is only as correct as the underlying scope helper. Helpers must
  themselves be unit-tested.

---

## Scope Helper Taxonomy

There are currently two categories of scope helper, with different teacher behavior:

| Helper | Location | Teacher behavior | Used by |
|---|---|---|---|
| `studentIdScopeFilter` | `lib/scope-filter.ts` | Global (all rows) | assignments, assessments |
| `courseIdScopeFilter` | `lib/scope-filter.ts` | Global (all rows) | notes, announcements |
| `applyTeacherScopeFilter` | `shared/auth/teacher-scope-validator.ts` | Ownership-scoped | courses |

New resources that require teacher ownership enforcement must use `applyTeacherScopeFilter`.
New resources where teachers have global access use `courseIdScopeFilter` or
`studentIdScopeFilter`.

---

## Alternatives Considered

**Authorization middleware per route:** Each route registers its own `authorize()` call.
Rejected — duplicate rules for Layer 2 (query filter) and Layer 3 (post-fetch) would
inevitably diverge.

**Single `canAccess(role, resource, action)` function:** A flat function with a large
switch statement. Rejected — does not provide the Layer 2 SQL condition, only the
boolean Layer 3 answer.

---

## Related

- ADR-001 — Layered Architecture
- ADR-002 — RBAC and RLS
- `docs/architecture/authorization-standards.md`
