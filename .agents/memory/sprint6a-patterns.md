---
name: Sprint 6A security patterns
description: requireRole middleware, soft-delete columns, and testing conventions established in Sprint 6A.
---

## requireRole middleware
- Path: `artifacts/api-server/src/middleware/require-role.ts`
- Factory pattern: `requireRole(...allowed: RoleKey[]): RequestHandler`
- Reads role from `buildScopeContext(req.session).role`
- Responds `403` with `ownershipDenied("endpoint", 0)` for blocked roles
- Applied to: students, assignments, assessments, announcements, notes, dashboard route groups

## Soft-delete column convention
- All soft-deletable tables have: `deleted_at TIMESTAMP`, `deleted_by INTEGER`
- Students table had these added in Sprint 6A via direct SQL (drizzle-kit push is interactive in this env — always use `psql "$DATABASE_URL"` for migrations)
- students insert: ORM can now include `deleted_at`/`deleted_by` columns (they exist in DB)

## Test structure for security layers
- Layer 1 (middleware): unit-test with mock req/res — `makeReq(role)` + `makeMockRes()` helpers, call middleware factory directly
- Layer 2 (scope filter): use `expectLayer2Allows/Blocks/SoftDeleteGuard` from `tests/helpers/authorization/assertions.ts`
- Layer 3 (policy): use `expectAuthorized/Forbidden` from same helpers
- Integration (DB): follow `audit-fields.test.ts` pattern — beforeAll inserts fixtures, afterAll hard-deletes, test soft-delete sets columns then verifies query exclusion

**Why:** Separate layer testing lets failures pinpoint exactly which security boundary broke.
