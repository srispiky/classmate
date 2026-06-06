# ADR-005 — PostgreSQL Naming Conventions

**Status:** Accepted (with documented deviations)  
**Date:** 2025-06  
**Deciders:** Engineering team  

---

## Context

Consistent PostgreSQL naming makes schema migrations, DBA audits, and cross-tool
introspection (pgAdmin, psql `\d`, pg_dump) predictable. Without a documented standard,
different developers apply different prefixes and casing patterns, resulting in a schema
that is hard to navigate and hard to migrate safely.

---

## Decision

Adopt the naming conventions documented in `docs/architecture/database-standards.md`.
Key rules:

| Object | Pattern | Example |
|---|---|---|
| Tables | `snake_case`, plural | `course_enrollments` |
| Columns | `snake_case` | `teacher_id`, `deleted_at` |
| Primary keys | `pk_{table}` | `pk_courses` |
| Foreign keys | `fk_{table}_{referenced_table}` | `fk_courses_teacher_id` |
| Indexes | `ix_{table}_{column(s)}` | `ix_courses_teacher_id` |
| Unique indexes | `uq_{table}_{column(s)}` | `uq_users_email` |
| Check constraints | `ck_{table}_{rule}` | `ck_users_role` |
| Views | `v_{name}` | `v_course_summary` |
| Functions | `fn_{name}` | `fn_calculate_attendance` |

---

## Current Deviations

These deviations exist in the codebase as of the Sprint 4 audit. They are documented
here rather than immediately corrected because renaming production database objects is
a high-risk operation that requires a coordinated migration.

### DEV-001 — Index prefix: `idx_` instead of `ix_`

**Affected objects:**

```sql
idx_course_enrollments_student_id   → ix_course_enrollments_student_id
idx_course_enrollments_course_id    → ix_course_enrollments_course_id
idx_student_guardians_user_id       → ix_student_guardians_user_id
idx_user_roles_user_id              → ix_user_roles_user_id
```

**Risk:** Low. Index names are cosmetic — renaming does not affect query plans.  
**Remediation:** Include in the next schema migration batch.

---

### DEV-002 — Check constraint prefix: `chk_` instead of `ck_`

**Affected objects:**

```sql
chk_users_role    → ck_users_role
```

**Risk:** Low. Constraint names are cosmetic — renaming does not affect enforcement.  
**Remediation:** Include in the next schema migration batch.

---

### DEV-003 — Primary key type: `serial` instead of `uuid`

**Affected tables:** All tables (`courses`, `students`, `users`, `assignments`,
`assessments`, `notes`, `announcements`, `roles`, `course_enrollments`, etc.)

**Current state:** `serial` (auto-increment integer) primary keys.  
**Target standard:** `uuid` (version 4, `gen_random_uuid()`).

**Risk:** **High.** Changing primary key types requires:
1. Dropping all foreign key constraints.
2. Adding a new UUID column.
3. Populating UUIDs for all existing rows.
4. Updating all FK columns to reference the new UUID.
5. Dropping the old integer primary key.
6. Renaming the new UUID column to `id`.

This migration must be planned as a dedicated maintenance window with full data backups
and tested end-to-end in a staging environment.

**Remediation:** Schedule as a dedicated migration sprint. Do not attempt inline with
feature development. The integer IDs are not currently exposed in any public API
(all IDs are internal to the application), which reduces external impact.

---

### DEV-004 — `users` table variable named `users` instead of `usersTable`

**Affected file:** `lib/db/src/schema/users.ts`  
**Current:** `export const users = pgTable("users", ...)`  
**Standard:** `export const usersTable = pgTable("users", ...)`

All other tables follow the `Table` suffix convention (`coursesTable`, `studentsTable`,
`assignmentsTable`, etc.).

**Risk:** Low. TypeScript rename only; no database change.  
**Remediation:** Rename the export and update all import sites. Include in the next
safe-refactoring sprint. Verify with `pnpm run typecheck` after the rename.

---

## Rationale for Not Renaming Now

The spec for this sprint (Sprint 4 — Architecture Standardization) explicitly states:

> Do not perform high-risk database renames.  
> Do not rename production tables.  
> Do not rename columns.  
> Instead: Document deviations for future migration planning.

All high-risk renames are deferred. This ADR serves as the documentation required by
that directive.

---

## Migration Checklist (for future execution)

When executing database object renames:

- [ ] Back up production database before starting.
- [ ] Apply the migration in a transaction.
- [ ] Update Drizzle schema files to match new names.
- [ ] Run `pnpm run typecheck` and `pnpm run test` after each rename step.
- [ ] Verify foreign key constraints are re-created correctly.
- [ ] Deploy to staging first; run full test suite.
- [ ] Schedule production deployment during a low-traffic window.

---

## Related

- `docs/architecture/database-standards.md`
- `docs/architecture/audit-report.md`
