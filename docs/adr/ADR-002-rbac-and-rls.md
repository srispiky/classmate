# ADR-002 — RBAC and RLS

**Status:** Accepted  
**Date:** 2025-06  
**Deciders:** Engineering team  

---

## Context

Classmate Connect serves five distinct user roles: admin, teacher, student, parent, and
guest. Each role has a different view of the data:

- Admins see everything.
- Teachers see their own courses and all student work within those courses.
- Students see only their own assignments, assessments, and enrolled courses.
- Parents see the data of their linked children.
- Guests have no data access.

A single, flat permission model (e.g. "is authenticated = can read everything") is
insufficient. A pure enumerated permission list (ACL) is possible but brittle — any
new resource type requires a new permission string to be threaded through every layer.

---

## Decision

Use **Role-Based Access Control (RBAC)** at the application layer combined with
**scope-filtered SQL queries** that act as a lightweight Row-Level Security (RLS)
equivalent inside the application.

### Application-Layer RBAC

Roles are stored in `users.role` (enforced by a database check constraint). The five
roles are: `admin`, `teacher`, `student`, `parent`, `guest`.

A session enrichment step (`SessionEnricherService`) runs at login and stores
pre-computed scope fields in the session: `enrolledCourseIds`, `childStudentIds`,
`childCourseIds`, `teacherId`, `ownedCourseIds`. These fields are read-only during the
request lifecycle and never re-fetched per request.

### ScopeContext

`buildScopeContext(session)` converts the session into a normalized `ScopeContext` value
object. All authorization decisions — both Layer 2 query filters and Layer 3 post-fetch
checks — consume only this value. Route handlers never pass `req.session` into query
builders or policies.

### Scope-Filtered Queries (Application RLS)

Rather than relying on PostgreSQL's native RLS feature, scoped WHERE conditions are built
at the application layer by `ResourceScopePolicy.getScopeCondition()` and applied to every
list and detail query. This approach:

- Keeps authorization logic in TypeScript where it is testable without a DB connection.
- Produces explicit SQL that can be inspected in query logs.
- Works with any PostgreSQL hosting (native RLS is database-user-dependent and harder to
  test in CI).

### PostgreSQL RLS (Future)

Native PostgreSQL RLS is listed as a future defense-in-depth layer. It is not implemented
today. If added, it would complement — not replace — the application-layer scope filters.

---

## Consequences

**Benefits:**

- Authorization logic is unit-testable (pure TypeScript).
- Pre-computed session fields eliminate per-request JOIN chains for common scoping needs.
- `ScopeContext` acts as a typed boundary: no `req` object leaks into the query layer.
- Explicit WHERE conditions are visible in query logs and explain plans.

**Trade-offs:**

- Session scope fields can become stale if underlying data changes (e.g. a teacher gains
  a new course) without a re-login. A session invalidation or refresh mechanism is needed
  for long-lived sessions.
- Pre-computing `ownedCourseIds` at login means teachers with a large number of courses
  will have proportionally larger session payloads. Monitor session size.

---

## Alternatives Considered

**PostgreSQL native RLS only:** Rejected as primary mechanism. Cannot produce structured
error responses (just returns 0 rows). Harder to test without a live database. Requires
a per-role PostgreSQL user which adds operational complexity.

**ACL-per-resource (explicit permission strings):** Partially implemented (the `permissions`,
`roles`, `role_permissions`, and `user_roles` tables exist). Deferred to a future sprint
as a fine-grained permission layer on top of the current RBAC model.

---

## Related

- ADR-001 — Layered Architecture
- ADR-004 — Policy-Based Authorization
- `docs/architecture/authorization-standards.md`
