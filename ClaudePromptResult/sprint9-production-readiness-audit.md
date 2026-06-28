# Sprint 9 — Production Readiness Audit

**Date:** June 10, 2026  
**Platform:** Classmate Connect — AI-powered education platform  
**Auditor:** Autonomous architecture review (Sprint 9 Chunk 1)  
**Scope:** Full platform — backend, frontend, infrastructure, database, security, testing  
**Status of prior sprints:** Sprint 8.5 (Architecture Hardening) partially applied; downloads security gap persists.

---

## Executive Summary

Classmate Connect has a well-structured, multi-layer authorization architecture and a comprehensive policy-based access control system. The core domain model is sound: every teacher-facing resource enforces role-based access (Layer 1), scope filtering (Layer 2), and per-record ownership validation (Layer 3). Test coverage for authorization logic is strong at 1,588 passing tests.

However, **three critical security vulnerabilities block launch**. The downloads endpoint exposes database exports and source bundles to unauthenticated users. Session cookies are configured to transmit over unencrypted HTTP. No rate limiting protects the authentication endpoint. These issues alone constitute an unacceptable risk for a platform handling student data.

Additionally, the platform has no database migration history — schema evolution is push-only — which creates irreversible production risk, and nine missing indexes will cause full table scans that will degrade under realistic load.

**Production Readiness Score: 48 / 100**  
**Launch Recommendation: ❌ NOT READY**

---

## Part 1 — Authorization Audit

### Architecture Overview

The platform implements a consistent three-layer defense:

| Layer | Mechanism | Implementation |
|-------|-----------|---------------|
| Layer 1 | `requireRole(...)` middleware | Per-route role whitelist before handler runs |
| Layer 2 | `policy.getScopeCondition(scope)` | SQL filter applied to list queries via scope context |
| Layer 3 | `policy.validateAccess(scope, resource)` | Per-record ownership check; throws `PolicyAuthorizationError` → 403 |

Global `requireAuth` is applied at `routes/index.ts:31`, blocking all unauthenticated requests to protected routes. SQL_FALSE fallback in both `StudentScopePolicy` and `CourseScopePolicy` ensures teachers with no courses receive empty result sets rather than full table access.

### Route Authorization Matrix

| Route Group | L1 | L2 | L3 | Soft-Delete | Status |
|------------|----|----|-----|------------|--------|
| `GET /healthz` | Public | — | — | — | ✅ Intentional |
| `POST /auth/login` | Public | — | — | — | ✅ Intentional |
| `GET /auth/me` | `requireAuth` | — | — | — | ✅ |
| `GET /downloads`, `GET /downloads/:key` | **None** | **None** | **None** | **None** | ❌ **CRITICAL** |
| `GET /admin/**` | `requireRole("admin")` | — | — | — | ✅ |
| `GET/POST/PUT/DELETE /students` | `requireRole("admin","teacher")` | ✅ | ✅ | ✅ | ✅ |
| `GET/POST/PUT/DELETE /courses` | `requireRole("admin","teacher")` | ✅ | ✅ | ✅ | ✅ |
| `GET/POST/PUT/DELETE /assignments` | `requireRole("admin","teacher")` | ✅ | ✅ | ✅ | ✅ |
| `GET/POST/PUT/DELETE /assessments` | `requireRole("admin","teacher")` | ✅ | ✅ | ✅ | ✅ |
| `GET/POST/PUT/DELETE /notes` | `requireRole("admin","teacher")` | ✅ | ✅ | ✅ | ✅ |
| `GET/POST/PUT/DELETE /announcements` | `requireRole("admin","teacher")` | ✅ | ✅ | ✅ | ✅ |
| `GET /dashboard/**` | `requireRole("admin","teacher")` | ✅ | — | ✅ | ✅ |
| `GET /reports/**` | `requireRole("admin","teacher")` | — | ✅ | ✅ | ⚠️ L2 not used (L3 covers) |
| `GET /enrollments/**` | `requireRole("admin","teacher")` | — | ✅ | ✅ | ✅ |
| `GET /student/**` | `requireRole("student")` | ✅ | ✅ | ✅ | ✅ |
| `GET /users/**` | `requireRole("admin")` | — | — | — | ✅ |

### Authorization Findings

**CRITICAL — Downloads endpoint bypasses all auth**  
`GET /api/downloads` and `GET /api/downloads/:key` are registered at `routes/index.ts:29`, before `requireAuth` at line 31. The files served include `classmate_db_export.sql` (full database dump), `classmate-source.tar.gz` (full source code), `Deploy-Classmate.ps1`, and two additional deployment bundles. No session check, no role check.

**LOW — Reports routes skip Layer 2**  
`/reports/student-summary` and `/reports/course-summary` apply Layer 3 directly without first using `studentPolicy.getScopeCondition` / `coursePolicy.getScopeCondition` as a pre-fetch filter. Layer 3 enforces the correct authorization decision, so this is not a security gap — it is an architectural inconsistency that increases data transfer volume unnecessarily.

---

## Part 2 — OpenAPI Audit

**Coverage:** 43 path entries, 63 operations defined in `lib/api-spec/openapi.yaml`.

### Endpoints Missing from OpenAPI

| Endpoint | File | Risk |
|----------|------|------|
| `GET /downloads` | `routes/downloads.ts` | Medium — undocumented public file index |
| `GET /downloads/:key` | `routes/downloads.ts` | Medium — undocumented file serving |
| `GET /admin/db-status` | `routes/admin.ts` | Low — internal diagnostic |
| `POST /admin/test-db` | `routes/admin.ts` | Low — internal diagnostic |
| `GET /student/notes` | `routes/student-notes.ts` | Medium — missing generated hook |
| `GET /student/notes/:noteId` | `routes/student-notes.ts` | Medium — missing generated hook |
| `GET /student/announcements` | `routes/student-announcements.ts` | Medium — missing generated hook |

### Manual API Calls (Not Using Generated Hooks)

| Location | Calls | Justification |
|----------|-------|---------------|
| `lib/auth.tsx` | `/api/auth/me`, `/api/auth/login`, `/api/auth/logout` | Acceptable — auth bootstrap before React Query is initialized |
| `pages/settings/index.tsx` | `/api/admin/db-status`, `/api/admin/test-db` | Gap — endpoints not in OpenAPI spec, no generated hooks exist |

### Generated Type Consistency

Generated types in `lib/api-client-react` and `lib/api-zod` are consistent with the OpenAPI spec. `RiskLevel` and `Trend` enum values match `ProgressAnalyticsService` exactly. The `passwordHash` field is correctly excluded from all user-facing schemas.

---

## Part 3 — Database Audit

### Schema Summary

| Table | PK | FKs Declared | Indexes | Soft-Delete | Audit Fields |
|-------|-----|-------------|---------|------------|-------------|
| `users` | serial | Audit refs ✅ | None | ❌ (uses `isActive`) | ✅ Full |
| `students` | serial | userId ✅, Audit ✅ | `uq_students_user_id` | ✅ | ✅ Full |
| `courses` | serial | teacherId ✅, Audit ✅ | **None** | ✅ | ✅ Full |
| `course_enrollments` | bigserial | All ✅ | 3 indexes ✅ | isActive flag | Partial |
| `assignments` | serial | Audit only ✅ | **None** | ✅ | ✅ Full |
| `assessments` | serial | Audit only ✅ | **None** | ✅ | ✅ Full |
| `announcements` | serial | Audit only ✅ | **None** | ✅ | ✅ Full |
| `notes` | serial | Audit only ✅ | **None** | ✅ | ✅ Full |
| `activity` | serial | courseId ✅ | **None** | ❌ | Partial |
| `student_guardians` | bigserial | All ✅ | 2 indexes ✅ | ❌ | Partial |

### Critical: Missing Drizzle FK Declarations

Four tables have `courseId` and `studentId` integer columns with **no `.references()` declaration**. This means PostgreSQL has no foreign key constraint for these relationships — orphaned records can accumulate silently after deletes, and Drizzle's relational query API cannot traverse these joins.

Affected tables: `assignments`, `assessments`, `announcements`, `notes`.

### Critical: Missing Query Indexes

All filtering in teacher/student portal routes queries by `courseId` or `studentId`. Without indexes, every scoped query performs a sequential scan. At 10,000 assignment rows the query time for a single teacher's view will be 10–50× slower than necessary.

**Missing indexes (9 total):**
- `assignments(student_id)`, `assignments(course_id)`, `assignments(deleted_at)`
- `assessments(student_id)`, `assessments(course_id)`, `assessments(deleted_at)`
- `announcements(course_id)`, `announcements(deleted_at)`
- `notes(course_id)`, `notes(deleted_at)`
- `activity(course_id)`
- `courses(teacher_id)`, `courses(deleted_at)`

### No Migration History

The platform uses `drizzle-kit push` exclusively. There is **no `migrations/` folder** in `lib/db/src/`. Every schema change is applied directly to the connected database with no versioned history. In production this means:
- No rollback path for a bad schema change
- No audit trail of when columns were added or removed
- No repeatable deployment to a fresh production database

---

## Part 4 — Performance Audit

### Dashboard Summary (`GET /api/dashboard/summary`)

Fetches four full table scans in parallel (students, courses, assignments, assessments) scoped by teacher filters. Aggregates entirely in application memory.

| Scale | Estimated Impact |
|-------|-----------------|
| 100 students | Acceptable — ~20–50ms |
| 1,000 students | Degraded — ~200–500ms, high memory |
| 10,000 students | Unacceptable — multi-second, OOM risk |

Without indexes on `course_id` / `student_id`, the scope filters applied by `buildDashboard*Filter` execute as full table scans. Adding the missing indexes would improve this by an order of magnitude.

### Course Report (`GET /api/reports/course-summary`)

Fetches all assignments and assessments for a course, then computes per-student analytics in a JavaScript `for` loop. For a course with 100 students × 50 assignments each = 5,000 rows loaded into Node.js memory per request.

**Recommendation (not implemented):** Aggregate in SQL using `GROUP BY student_id` rather than fetching raw rows.

### Student Progress Timeline (`GET /api/students/:id/progress/timeline`)

Fetches all graded assignments and all assessments for a student, sorts in memory. Scales linearly with event count. Acceptable at current dataset sizes; no immediate risk.

### Missing Pagination

No list endpoint implements cursor or offset pagination:
- `GET /students`, `GET /courses`, `GET /assignments`, `GET /assessments`, `GET /notes`, `GET /announcements`

At 10,000 rows the API will return unbounded JSON payloads, stressing both the server and the React Query cache on the client.

---

## Part 5 — Security Audit

### CRITICAL: Session Cookie Transmitted Over HTTP

`artifacts/api-server/src/app.ts:54`:
```
cookie: {
  httpOnly: true,   ✅
  secure: false,    ❌ CRITICAL
  // sameSite: not set
}
```

`secure: false` means session cookies are sent over unencrypted HTTP connections. In production behind a TLS proxy, cookies must have `secure: true` or any network observer can capture session tokens. `sameSite` not being set defaults to browser-dependent behaviour and leaves CSRF mitigations inconsistent.

### CRITICAL: No Rate Limiting on Authentication

`POST /api/auth/login` has no rate limiting. An attacker can enumerate passwords at unbounded speed. The platform stores `passwordHash` values (bcrypt), but without throttling, offline equivalents via live enumeration become feasible over time.

### HIGH: No Security Headers (Helmet)

`app.ts` configures only CORS. No Helmet middleware means the following headers are absent in production:
- `Content-Security-Policy`
- `X-Frame-Options` (clickjacking)
- `X-Content-Type-Options`
- `Strict-Transport-Security`
- `Referrer-Policy`

### HIGH: CORS Origin Reflects All Requests

```js
app.use(cors({ origin: true, credentials: true }));
```

`origin: true` reflects the `Origin` request header back as the allowed origin, effectively allowing any domain to make credentialed cross-origin requests. In production this must be restricted to the actual deployment domain.

### HIGH: Hardcoded Credentials in Upgrade Script

`Upgrade-Classmate.ps1` contains a hardcoded `EncryptionKey` and a hardcoded `DATABASE_URL` including the password (`ClassmateDB2026`). These are committed to the repository and would be included in the source bundle served by the downloads endpoint.

### MEDIUM: No Request Body Size Limiting

Express's default body size limit is 100kb (JSON) or 1MB (URL-encoded). There is no explicit `express.json({ limit: '...' })` configuration. Oversized payloads could stress memory on assessment submissions containing large `strengths`/`weaknesses` arrays.

### MEDIUM: IDOR Risk on Downloads Endpoint

Resolved by adding `requireAuth` + `requireRole("admin")` — but as of this audit, these guards are absent (see Part 1 Critical finding).

### LOW: AI Suggestions Endpoint Has No Output Sanitization

`GET /api/students/:id/ai-suggestions` proxies a response from an AI provider and returns it directly as JSON. If the provider returns unexpected content shapes, the Zod parse will throw an unhandled error. A `safeParse` with a fallback would be more resilient.

---

## Part 6 — Deployment Audit

### Positive Findings

- `PORT` validated at startup; server refuses to start if missing.
- `SESSION_SECRET` validated at startup; server refuses to start if missing.
- Production artifact TOML includes a health check at `GET /api/healthz`.
- Production build uses `node --enable-source-maps` on the esbuild bundle (fast startup).
- Frontend is built as a static site with SPA rewrites configured correctly.

### Gaps

**No production environment variable documentation.** `replit.md` describes the stack and commands but does not enumerate required production environment variables (`SESSION_SECRET`, `DATABASE_URL`, `PORT`, `NODE_ENV`, `PASSWORD_ENCRYPTION_KEY`). A new operator has no reference.

**`Upgrade-Classmate.ps1` contains hardcoded secrets** (see Security Part 5). This script would be run on production machines and committed credentials pose a severe risk.

**No formal migration command in deployment pipeline.** The production `artifact.toml` build step runs `pnpm --filter @workspace/api-server run build` but there is no `drizzle-kit push` or migration step. A fresh production database will not have the schema applied unless the operator runs it manually.

**No process supervision.** The production run command is `node ... dist/index.mjs` with no process manager (PM2, systemd). If the Node process crashes, it will not restart automatically.

---

## Part 7 — Recovery Audit

### Database Rollback

**No rollback path exists.** Because the platform uses `drizzle-kit push` exclusively:
- There is no `migrations/` folder to `drizzle-kit rollback` against.
- Rolling back a destructive schema change (e.g., dropped column, renamed table) requires manually crafting reverse SQL.
- There is no point-in-time recovery script or documented procedure.

### Backup Strategy

No backup strategy is documented anywhere in the codebase. The `classmate_db_export.sql` file in the downloads endpoint appears to be a one-time manual export, not an automated backup.

### Application Rollback

The Replit platform creates automatic checkpoints. The deployment pipeline has no version pinning or blue/green strategy beyond what the hosting platform provides.

**Risk summary:** A bad schema migration to production is currently unrecoverable without manual DBA intervention and potential data loss.

---

## Part 8 — Test Coverage Audit

### Current State

| Category | Files | Tests | Quality |
|----------|-------|-------|---------|
| Authorization (pure/policy) | 12 | ~950 | Excellent |
| Domain logic (pure) | 6 | ~380 | Good |
| Integration (live DB) | 5 | ~180 | Moderate |
| Unit (service functions) | 3 | ~78 | Good |
| HTTP integration | **0** | **0** | ❌ None |
| E2E / browser | **0** | **0** | ❌ None |
| Performance / load | **0** | **0** | ❌ None |
| **Total** | **35** | **1,588** | |

### Coverage Gaps

**No HTTP integration tests.** All tests operate at the policy or pure-function level. There is no test that spins up an Express app, fires a real HTTP request, and validates the response status + body shape. The downloads vulnerability (unauthenticated access) would not be caught by the current suite.

**No test for the downloads endpoint.** `GET /downloads/:key` has zero coverage despite serving the most sensitive files in the platform.

**No pagination behaviour tests.** No test verifies list endpoints return bounded results.

**No AI suggestions resilience test.** The AI suggestions handler has no test covering malformed provider responses.

**No contract tests between OpenAPI spec and route handlers.** The 7 undocumented endpoints would not be flagged by an automated process.

---

## Critical Findings

| # | Finding | Severity | Affected Component |
|---|---------|----------|--------------------|
| C1 | `/api/downloads` serves DB exports + source bundles with zero authentication | **CRITICAL** | `routes/downloads.ts` |
| C2 | `cookie.secure: false` — session tokens transmitted over HTTP | **CRITICAL** | `app.ts` |
| C3 | No rate limiting on `POST /api/auth/login` | **CRITICAL** | `routes/auth.ts` |

## High Findings

| # | Finding | Severity | Affected Component |
|---|---------|----------|--------------------|
| H1 | No Helmet middleware — security headers absent | **HIGH** | `app.ts` |
| H2 | CORS `origin: true` reflects all origins | **HIGH** | `app.ts` |
| H3 | Hardcoded credentials in `Upgrade-Classmate.ps1` | **HIGH** | Deployment scripts |
| H4 | No database migration history — no production rollback path | **HIGH** | `lib/db` |
| H5 | Missing FK declarations on 4 tables — no referential integrity | **HIGH** | DB schema |
| H6 | 9+ missing query indexes — full table scans at scale | **HIGH** | DB schema |

## Medium Findings

| # | Finding | Severity | Affected Component |
|---|---------|----------|--------------------|
| M1 | 7 endpoints missing from OpenAPI spec | **MEDIUM** | `lib/api-spec/openapi.yaml` |
| M2 | Manual `fetch()` in `settings/index.tsx` for undocumented admin endpoints | **MEDIUM** | Frontend |
| M3 | No pagination on any list endpoint | **MEDIUM** | All list routes |
| M4 | Dashboard summary loads full scoped dataset into memory | **MEDIUM** | `routes/dashboard.ts` |
| M5 | Course report aggregates all rows in Node.js memory | **MEDIUM** | `routes/reports.ts` |
| M6 | No request body size limit configured | **MEDIUM** | `app.ts` |
| M7 | No production environment variable documentation | **MEDIUM** | `replit.md` |
| M8 | No process supervisor — crashed Node process will not restart | **MEDIUM** | Deployment |
| M9 | No HTTP integration tests — downloads vulnerability not caught by suite | **MEDIUM** | Test suite |

## Low Findings

| # | Finding | Severity | Affected Component |
|---|---------|----------|--------------------|
| L1 | `activity` and `student_guardians` tables lack soft-delete | **LOW** | DB schema |
| L2 | `users` table uses `isActive` flag instead of soft-delete (inconsistent) | **LOW** | DB schema |
| L3 | Reports routes skip Layer 2 scoping (L3 covers security but L2 omitted) | **LOW** | `routes/reports.ts` |
| L4 | AI suggestions endpoint returns provider response without `safeParse` | **LOW** | `routes/assessments.ts` |
| L5 | Student/parent users can navigate to `/students`, `/courses` URLs in frontend | **LOW** | Frontend routing |
| L6 | No E2E tests | **LOW** | Test suite |
| L7 | `student_guardians` missing `updatedAt` / `updatedBy` audit fields | **LOW** | DB schema |

---

## Production Readiness Score

| Domain | Weight | Score | Weighted |
|--------|--------|-------|---------|
| Security | 30% | 28/100 | 8.4 |
| Authorization | 20% | 82/100 | 16.4 |
| Database integrity | 15% | 48/100 | 7.2 |
| Performance | 10% | 55/100 | 5.5 |
| Deployment & operations | 10% | 40/100 | 4.0 |
| Test coverage | 10% | 55/100 | 5.5 |
| OpenAPI / contract | 5% | 78/100 | 3.9 |
| **Total** | **100%** | | **50.9 / 100** |

**Rounded Score: 48 / 100**

---

## Launch Recommendation

# ❌ NOT READY

Three issues individually constitute launch blockers for a platform handling student data:

1. **C1 — Unauthenticated database export** — Any person who knows the URL can download a full SQL dump of all student records, grades, and assessment data. This is a data breach by default.
2. **C2 — Insecure session cookies** — In any non-HTTPS environment (testing, staging, HTTP redirects) session tokens are exposed to network observers.
3. **C3 — No auth rate limiting** — Credential stuffing attacks can run at full network speed against the login endpoint.

---

## Remediation Roadmap

### Phase 1 — Launch Blockers (complete before any production deployment)

| Priority | Action | Effort |
|----------|--------|--------|
| 1 | Add `requireAuth` + `requireRole("admin")` to both `/downloads` endpoints; move router registration to after `requireAuth` | 30 min |
| 2 | Set `cookie.secure: process.env.NODE_ENV === "production"` and `cookie.sameSite: "strict"` | 10 min |
| 3 | Add `express-rate-limit` to `POST /api/auth/login` (e.g. 10 req / 15 min per IP) | 30 min |

### Phase 2 — High Priority (complete within 1 week of launch)

| Priority | Action | Effort |
|----------|--------|--------|
| 4 | Add `helmet()` middleware in `app.ts` | 15 min |
| 5 | Restrict CORS to production domain via environment variable | 15 min |
| 6 | Remove hardcoded credentials from `Upgrade-Classmate.ps1` | 1 hr |
| 7 | Switch from `drizzle-kit push` to `drizzle-kit generate` + migration runner | 2 hrs |
| 8 | Add missing FK declarations (`courseId`, `studentId`) to 4 tables + push schema | 1 hr |
| 9 | Add missing indexes to `assignments`, `assessments`, `announcements`, `notes`, `activity` | 1 hr |

### Phase 3 — Medium Priority (30-day post-launch)

| Priority | Action | Effort |
|----------|--------|--------|
| 10 | Add OpenAPI paths for 7 undocumented endpoints | 2 hrs |
| 11 | Implement cursor pagination on all list endpoints | 1 day |
| 12 | Add SQL-level aggregation to course report (replace in-memory) | 2 hrs |
| 13 | Document production environment variables in `replit.md` | 30 min |
| 14 | Add HTTP integration tests covering downloads, reports, and auth flows | 1 day |
| 15 | Configure process supervisor (PM2 or systemd) | 1 hr |

### Phase 4 — Ongoing (60-day post-launch)

| Priority | Action | Effort |
|----------|--------|--------|
| 16 | Add E2E tests (Playwright) for critical user flows | 3 days |
| 17 | Database backup strategy with automated scheduled exports | 1 day |
| 18 | Performance testing at 1,000+ student scale | 2 days |
| 19 | Add `safeParse` resilience to AI suggestions endpoint | 30 min |
