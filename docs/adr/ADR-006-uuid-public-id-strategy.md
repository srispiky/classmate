# ADR-006: UUID / public_id Strategy

**Status:** Accepted — implementation deferred (migration sprint)
**Date:** 2026-06-06
**Deciders:** Architecture team

---

## Context

All tables currently use `serial` (auto-increment integer) primary keys. These PKs are exposed directly in API routes (`/courses/3`, `/students/42`) and in JSON responses. This creates two problems:

1. **Enumeration attacks** — consecutive integers allow callers to iterate over all resource IDs without knowing them.  
2. **Coupling** — exposing the DB PK makes future shard/merge migrations harder because IDs collide across shards.

The UUID migration is classified **high-risk** in the audit report (N-002) because:
- All existing foreign keys reference the `serial` PK.
- All API clients and frontend hooks use integer IDs.
- A naive swap to `uuid` PK would require a coordinated migration of every FK column, every API response type, every generated hook, and every test fixture simultaneously.

---

## Decision: `public_id` additive column strategy

Rather than replacing `serial` PKs with UUIDs, we add a `public_id uuid` column to each table alongside the existing `id serial` column.

**Internal** code (Drizzle joins, FK references, session storage) continues using the integer `id`.  
**External** API routes and JSON responses use `public_id` exclusively.

### Why `public_id` over direct UUID PK replacement

| Concern | UUID PK | `public_id` column |
|---|---|---|
| FK migration risk | All FK columns must change at once | Zero: all FKs stay as integer |
| Downtime window | Hours (large tables) | Zero: column added `DEFAULT gen_random_uuid()` |
| Rollback difficulty | Hard — FKs already changed | Easy — drop the column |
| API rollout | Big-bang | Incremental per resource |

---

## Migration plan

### Phase 1 — Add `public_id` columns (zero-downtime)

For each table in priority order (`courses`, `students`, `assignments`, `assessments`, `notes`, `announcements`, `activity`, RBAC tables):

```sql
-- example for courses
ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS public_id uuid NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX IF NOT EXISTS uq_courses_public_id ON courses (public_id);
```

Update each Drizzle schema file:
```ts
publicId: uuid("public_id").notNull().defaultRandom(),
```

### Phase 2 — Dual-field API responses

Update route serialisers to include `publicId` alongside `id` in responses:
```json
{ "id": 3, "publicId": "a1b2c3d4-...", "name": "Algebra I" }
```

### Phase 3 — Route migration (incremental, per resource)

Switch URL parameters and request bodies from integer `id` to `publicId`. Use the `public_id` column in WHERE clauses; keep internal joins on the integer PK.

Route handler pattern:
```ts
// Before: WHERE id = :id (integer)
// After:  WHERE public_id = :publicId (uuid)
const [course] = await db
  .select()
  .from(coursesTable)
  .where(eq(coursesTable.publicId, params.data.id));  // publicId in URL
const internalId = course.id;  // continue using integer for joins
```

OpenAPI spec: change path parameter type from `integer` to `string` (uuid format) per resource.

### Phase 4 — Drop `id` from API responses

Once all clients have migrated to `publicId`:
1. Remove `id` from serialisers and OpenAPI response schemas.
2. Keep `id` as the internal DB column — it never leaves the server.

### Phase 5 — Cleanup (optional, long-term)

If sharding is needed in future, evaluate replacing the integer PK with UUID PK at that point. By then, no external surface uses the integer.

---

## Table priority order

| Priority | Table | Reason |
|---|---|---|
| 1 | `courses` | Core resource; already has full CRUD API |
| 2 | `students` | High-traffic; used by assignments/assessments |
| 3 | `assignments` | Exposed in frontend list views |
| 4 | `assessments` | Exposed in frontend list views |
| 5 | `notes` | Exposed in lesson library |
| 6 | `announcements` | Lower traffic |
| 7 | `activity` | Append-only log; low IDOR risk |
| 8 | RBAC tables | Internal; not exposed in API |

---

## Consequences

**Positive:**
- Zero-downtime column additions.
- Incremental rollout per resource — no big-bang migration.
- Internal query performance unchanged (joins remain on integer PK).
- Easy rollback at each phase.

**Negative:**
- Two-phase API (both `id` and `publicId` in responses during Phase 2–3) requires client coordination.
- Adds ~16 bytes per row per table (small at current scale).
- Drizzle schema files grow by one column per table.

---

## Deferred items

- Actual SQL execution and schema file updates (tracked as a future migration sprint).
- Decision on whether RBAC tables need `public_id` (currently internal-only).
