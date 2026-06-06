# ADR-003 — Soft Delete Strategy

**Status:** Accepted  
**Date:** 2025-06  
**Deciders:** Engineering team  

---

## Context

Educational records — courses, assignments, assessments, notes — are audit-sensitive.
Permanently deleting them removes evidence needed for grade disputes, compliance audits,
and historical reporting. At the same time, users expect "deleted" records to disappear
from the active UI.

---

## Decision

All business entity tables include a `deleted_at` column (`timestamptz`, nullable).

Rules:

1. **Active records:** `deleted_at IS NULL`.
2. **Deleted records:** `deleted_at IS NOT NULL` (timestamp of deletion).
3. **No physical deletes** — `DELETE` statements are prohibited on business tables.
4. **Soft-delete guard** — every list query appends `isNull(table.deletedAt)` as the
   final WHERE condition. Every detail (GET by ID) query also applies this guard.
5. **Delete endpoints** set `deleted_at = NOW()` and `updated_at = NOW()` via `UPDATE`.
6. **Soft-deleted records return 404** — they are treated as non-existent by the API.

### Implementation pattern

```ts
// Soft delete in a route handler
await db
  .update(coursesTable)
  .set({ deletedAt: new Date(), updatedAt: new Date() })
  .where(eq(coursesTable.id, id));

res.status(204).send();
```

### Query guard pattern

```ts
// In build*Conditions — always last
conditions.push(isNull(coursesTable.deletedAt));
```

### Tables with soft delete

| Table | Column |
|---|---|
| `courses` | `deleted_at` |
| `assignments` | `deleted_at` |
| `assessments` | `deleted_at` |
| `notes` | `deleted_at` |
| `announcements` | `deleted_at` |

### Tables without soft delete (by design)

| Table | Rationale |
|---|---|
| `users` | Deactivated via `is_active = false`; no deletion use case |
| `course_enrollments` | Deactivated via `is_active = false`, `dropped_at` |
| `student_guardians` | Relationship removal is a hard delete (no data loss) |
| `role_permissions` | Junction table; hard delete is safe |

---

## Consequences

**Benefits:**

- Full audit trail: deleted records are recoverable and inspectable.
- Referential integrity: foreign keys to deleted records remain valid.
- Compliance: satisfies data retention requirements without a separate archive store.
- Rollback: an admin can un-delete records by setting `deleted_at = NULL`.

**Trade-offs:**

- Queries must always include the soft-delete guard — missing it is a data-leak bug.
  This is mitigated by the `build*Conditions()` pattern which always appends the guard.
- Deleted records accumulate. A purge job (physical delete after a retention period)
  must be planned for large tables.
- Unique constraints on active records must use partial indexes
  (`WHERE deleted_at IS NULL`) to avoid conflicts between active and deleted records
  with the same logical key.

---

## Alternatives Considered

**Physical delete + audit log table:** More complex. Requires a trigger or application-layer
audit hook on every `DELETE`. Harder to query historical data. Rejected in favor of the
simpler soft-delete approach.

**Separate archive tables:** Requires a data migration step on deletion and complicates
foreign key relationships. Rejected.

---

## Related

- ADR-001 — Layered Architecture
- `docs/architecture/database-standards.md`
