# ADR-001 — Layered Architecture

**Status:** Accepted  
**Date:** 2025-06  
**Deciders:** Engineering team  

---

## Context

Classmate Connect is an educational platform where multiple user types (admins, teachers,
students, parents) access overlapping data with different permissions. A flat architecture
where route handlers perform all logic — database access, authorization, business rules,
serialization — becomes unauditable and untestable at scale.

Early versions of the codebase mixed database calls, authorization checks, and serialization
in a single route handler function. Adding a new role or a new access rule required editing
every affected handler, with no guarantee that all cases were covered.

---

## Decision

Adopt a four-layer application architecture enforced by coding standards:

```
┌──────────────────────────────┐
│  Layer: Routes (Controllers) │  HTTP parsing, validation, serialization only
├──────────────────────────────┤
│  Layer: Policies / Validators│  Authorization decisions only
├──────────────────────────────┤
│  Layer: Query Builders       │  SQL WHERE conditions; no DB calls, testable pure functions
├──────────────────────────────┤
│  Layer: Database (Drizzle)   │  Drizzle ORM; type-safe, no raw SQL strings
└──────────────────────────────┘
```

Cross-cutting concerns:

- **Scope helpers** (`scope-filter.ts`, `teacher-scope-validator.ts`) — pure functions that
  translate a `ScopeContext` into Drizzle SQL conditions.
- **Session enrichment** (`session-enricher.ts`) — pre-computes expensive scope fields at
  login time; no per-request DB joins for authorization.

---

## Consequences

**Benefits:**

- Authorization logic is testable without an HTTP server or a database — policies and
  scope helpers are pure functions.
- `build*Conditions()` functions are exported and tested in isolation; the WHERE clause
  can be verified before the query executes.
- Adding a new role or tightening a permission requires editing one policy class, not
  every route handler.
- The query layer never receives `req.session` directly — it only sees a `ScopeContext`
  value, which eliminates an entire class of session-misuse bugs.

**Trade-offs:**

- More files and indirection than a flat route-handler approach.
- Developers must understand the layer boundaries before contributing; a short ramp-up
  period is required.
- Current implementation has layer violations (inline role checks in route handlers) that
  must be remediated over time. See `docs/architecture/audit-report.md`.

---

## Alternatives Considered

**Flat route handlers:** Rejected. Authorization correctness cannot be verified without
running the full HTTP stack. Adding a new role would require auditing every handler.

**ORM-level row security (Postgres RLS):** Considered as a complement, not a replacement.
PostgreSQL RLS is useful for defense-in-depth at the DB level but does not replace
application-level authorization because it cannot enforce business rules or produce
structured error responses.

---

## Related

- ADR-002 — RBAC and RLS
- ADR-004 — Policy-Based Authorization
- `docs/architecture/authorization-standards.md`
