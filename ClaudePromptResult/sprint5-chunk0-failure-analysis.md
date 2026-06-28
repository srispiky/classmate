# Sprint 5 Chunk 0 — Failure Analysis

**Date:** 2026-06-07
**Artifact:** Classmate (frontend)
**Trigger:** AB-001 + AB-002 combined request (OpenAPI Synchronization + Audit Field Remediation)

---

## Failure Analysis

**Root Cause:**

The `api-client-react` codegen **cleaned its output folder** and regenerated `api.ts` and `api.schemas.ts` with an updated export surface. The barrel file `lib/api-client-react/src/index.ts` attempts to re-export `setBaseUrl` from the generated output, but the regenerated `api.ts` no longer provides that export under that name (or at all). The Classmate app imports from `lib/api-client-react`, hits the broken barrel, and the entire frontend module graph fails to load.

The exact runtime error from the browser console:

```
SyntaxError: The requested module
  '/@fs/home/runner/workspace/lib/api-client-react/src/index.ts'
  does not provide an export named 'setBaseUrl'
```

And the Vite log confirms the generated files were rewritten mid-serve:

```
[vite] page reload lib/api-client-react/src/generated/api.schemas.ts
[vite] page reload lib/api-client-react/src/generated/api.ts
[vite] Pre-transform error: Failed to load url /@fs/.../api.ts ... Does the file exist?
```

---

**Contributing Factors:**

1. **Orval output folder cleaning** — Orval's `cleanOutputDir: true` (or equivalent) deletes all files in the output folder before writing new ones. Vite's file watcher fires immediately on deletion, briefly attempting to import files that no longer exist.

2. **Barrel re-export of generated internals** — `lib/api-client-react/src/index.ts` re-exports named exports from the generated file. Any rename or removal in the generated output breaks every consumer without a compile-time error (it fails at runtime in the browser).

3. **No validation of the barrel after codegen** — The codegen script rewrites `lib/api-zod/src/index.ts` defensively (noted in `replit.md`), but `lib/api-client-react/src/index.ts` is not similarly guarded. The prior codegen run produced a compatible set; the new run — after adding `Enrollment`, `EnrollStudentBody`, the security scheme, and new response fields — generated a different export surface.

4. **The task itself succeeded** — All 986 tests passed, typecheck was clean, and the API server started correctly. The failure is isolated to the **frontend module resolution** layer, not the backend or schema work.

---

**Estimated Scope:**

| Category | Count |
|---|---|
| Files affected (schemas, routes, spec, codegen output) | ~18–20 |
| DB migrations executed | 11 |
| Drizzle schema files changed | 5 |
| Route handlers changed | 5 routes × 2–3 write sites each |
| OpenAPI sections changed | Tags, paths (2 new), 5 response schemas, securitySchemes |
| Tests affected | 0 (all 986 passed) |
| Codegen output files regenerated | 2 (`api.ts`, `api.schemas.ts`) |

---

**Most Expensive Task:**

The OpenAPI codegen step. Adding `Enrollment` + `EnrollStudentBody` schemas, the global `security` block, and `createdBy`/`updatedBy` to five response schemas changed the generated `api.ts` export surface. Orval rewrote it, `setBaseUrl` moved or disappeared from the named exports, and the stale barrel file broke the app.

---

**Recommended Split:**

**Chunk A — AB-002 only (audit fields, no spec change)**
- DB migrations for `created_by`, `updated_by`, `updated_at`
- Drizzle schema file updates
- Route handler population of `createdBy`/`updatedBy`
- No codegen, no OpenAPI spec change
- Validate: typecheck + test suite only

**Chunk B — OpenAPI spec audit field additions**
- Add `updatedAt`, `createdBy`, `updatedBy` to the five response schemas in `openapi.yaml`
- Run codegen
- Immediately verify `lib/api-client-react/src/index.ts` barrel still resolves — check that all re-exported names still exist in the new `api.ts`
- Validate: typecheck + test + frontend app loads

**Chunk C — AB-001 enrollment endpoints**
- Add `enrollments` tag, two endpoint entries, `Enrollment` and `EnrollStudentBody` schemas, `securitySchemes` block, global `security` to `openapi.yaml`
- Run codegen
- Same barrel verification step
- Validate: typecheck + test + frontend app loads

**Risk Level: Low** — the backend work is complete and correct; the only repair needed is the `lib/api-client-react/src/index.ts` barrel.

---

## Execution Strategy

**Step 1 (immediate fix):** Inspect `lib/api-client-react/src/index.ts` and compare its named re-exports against what the current `lib/api-client-react/src/generated/api.ts` actually exports. Identify whether `setBaseUrl` was renamed, removed, or needs to be added back to the barrel. Fix the barrel. Restart the Classmate workflow. Verify the frontend loads.

**Step 2 (process guard):** After any future codegen run, add a barrel verification step — grep the generated `api.ts` for every name that `index.ts` re-exports, and fail loudly before the workflow restarts if any are missing.

**Step 3 (future splits):** When a single request touches both the OpenAPI spec (triggering codegen) and DB schema/routes, split them into separate prompts at the codegen boundary. Codegen is the highest-risk step because it replaces files entirely rather than patching them incrementally.
