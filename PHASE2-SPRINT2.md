# Classmate Connect — Phase 2 Sprint 2: Authorization Architecture

> **Source of truth:** Architecture v1.0 · RBAC Design v1.0 · API Auth Design v1.0 · Architecture Review Report v1.0 · Sprint 1 (approved)
> **Sprint:** Phase 2 · Sprint 2
> **Version:** 1.0
> **Date:** June 2026
> **Architect role:** Senior .NET Solution Architect (patterns mapped to Node.js 24 + Express 5 + TypeScript 5.9)
> **Pre-requisite:** Sprint 1 database migrations completed and verified
> **Status:** AWAITING APPROVAL — do not begin Sprint 3 until this document is signed off

---

## Terminology Mapping — .NET to Node.js

Before reading this document, the following table resolves .NET-specific terms to their Node.js equivalents used throughout.

| .NET / ASP.NET Core Concept | Node.js / Express Equivalent |
|---|---|
| `ClaimsIdentity` / JWT Claims | Session payload (`req.session`) |
| `IAuthorizationRequirement` | Permission key string (`'students:read'`) |
| `IAuthorizationPolicy` | Middleware factory: `requirePermission(key)` |
| `IAuthorizationHandler` | Middleware function body |
| `AuthorizationMiddleware` | Express middleware chain (`requireAuth → checkRbacVersion → requirePermission`) |
| `IAuthorizationService` | `PermissionResolverService` class |
| Dependency Injection container | Express `app.locals` + module-scoped singletons |
| Request pipeline (`Program.cs`) | Express app setup (`app.ts`) — middleware registration order |
| `ClaimsPrincipal.HasClaim()` | `req.session.permissions.includes(key)` |
| `[Authorize(Policy = "...")]` | Route-level middleware: `requirePermission('...')` |
| `[Authorize(Roles = "...")]` | Route-level middleware: `requireRole('...')` |
| `IOptions<T>` | Environment variables / `process.env` |
| `AddAuthentication().AddJwtBearer()` | `app.use(session(...))` in `app.ts` |

---

## Table of Contents

1. [Sprint Scope & Exit Criteria](#1-sprint-scope--exit-criteria)
2. [Claims Strategy — Session as Claim Store](#2-claims-strategy--session-as-claim-store)
3. [Authorization Architecture Overview](#3-authorization-architecture-overview)
4. [Class Diagram](#4-class-diagram)
5. [Sequence Diagrams](#5-sequence-diagrams)
6. [Service Responsibilities](#6-service-responsibilities)
7. [Authorization Flow](#7-authorization-flow)
8. [Middleware Design](#8-middleware-design)
9. [Folder Structure Changes](#9-folder-structure-changes)
10. [Dependency Injection Registrations](#10-dependency-injection-registrations)
11. [Request Pipeline Integration](#11-request-pipeline-integration)
12. [API Integration Plan](#12-api-integration-plan)
13. [Risks & Mitigation](#13-risks--mitigation)
14. [Sprint 2 Completion Criteria](#14-sprint-2-completion-criteria)

---

## 1. Sprint Scope & Exit Criteria

### What Sprint 2 delivers

Sprint 2 delivers the **complete authorization middleware layer**. All existing routes are upgraded to use the new permission system. The session payload is extended with RBAC claims. No new API endpoints are added.

| Deliverable | Description |
|---|---|
| `PermissionResolverService` | Resolves a user's full permission set from `user_roles` + `role_permissions` at login. Applies `manage` → sub-permission expansion. |
| `RbacVersionCacheService` | In-process singleton. Caches `rbac_version.version`. Refreshes every 60 seconds. Used by `checkRbacVersion` middleware. |
| `SessionEnricherService` | Populates role-specific session fields at login: `enrolledCourseIds` (student), `childStudentIds` (parent). |
| Extended session type | TypeScript `SessionData` interface extended with `permissions`, `permissionsVersion`, `studentId`, `enrolledCourseIds`, `childStudentIds`. |
| `requireAuth` middleware | Confirms session exists and account is active. Replaces the current minimal version. |
| `checkRbacVersion` middleware | Compares `session.permissionsVersion` vs cache. Re-resolves if stale. |
| `requirePermission(key)` | Factory. Returns middleware that checks `session.permissions.includes(key)`. |
| `requireRole(...roles)` | Factory. Returns middleware that checks `session.role` against allowed list. |
| `requireOwnership(resolver)` | Factory. Returns middleware enforcing row-level scope for student / parent roles. |
| Updated login handler | Calls `PermissionResolverService` and `SessionEnricherService` before writing session. |
| Updated `GET /auth/me` | Returns extended session payload including `permissions[]`. |
| All existing routes updated | Each route receives the correct `requirePermission` and/or `requireOwnership` middleware per the Route Authorization Matrix (API Auth Design v1.0, Section 5). |

### What Sprint 2 does NOT deliver

- No new API routes
- No frontend route guard changes (Sprint 3)
- No `course_enrollments` table switch (Sprint 3 — `enrolled_course_ids` JSON array still used in Sprint 2 for `enrolledCourseIds` session population)
- No `audit_log` writes (Sprint 3)
- No `ai_suggestions` persistence (Sprint 3)
- No Parent portal routes (Sprint 3)
- No Student portal routes (Sprint 3)

### Exit criteria

Sprint 2 is complete when:

1. All existing routes protected with the correct permission middleware per the API Integration Plan (Section 12)
2. Login response still returns the same shape as before Sprint 2
3. `GET /api/auth/me` returns the extended payload with `permissions[]`
4. Admin user can access all routes
5. A newly-created teacher account is blocked from admin routes with 403
6. `pnpm run typecheck` passes with zero errors
7. `pnpm --filter @workspace/api-spec run codegen` passes and `GET /api/auth/me` schema updated

---

## 2. Claims Strategy — Session as Claim Store

### 2a. Why session, not JWT tokens

The deployed architecture is Windows IIS + NSSM (on-premises, no load balancer, single Node.js process). JWT tokens are designed for:

- Stateless horizontal scaling (no shared session store needed)
- Cross-service authentication (microservices, mobile clients)
- Short-lived bearer tokens with refresh token rotation

None of these apply here. A shared PostgreSQL session store (`connect-pg-simple`) is already operational and proven working. Migrating to JWT would:
- Add token storage complexity (where does the React SPA store the JWT securely? `httpOnly` cookie defeats the "stateless" benefit)
- Require implementing refresh token rotation
- Provide no benefit at current scale

**Decision: The session payload is the claims store.** It provides the same guarantees as a JWT claims set — typed, structured, populated at authentication time — with the addition of server-side revocation (session deletion on logout or deactivation).

### 2b. Session payload as JWT claims equivalent

The following table maps standard JWT claims to their session equivalents:

| JWT Claim | Session Field | Type | Description |
|---|---|---|---|
| `sub` (subject) | `userId` | `number` | User identity — set at login, never changes |
| `preferred_username` | `username` | `string` | Username — for logging |
| `name` | `displayName` | `string` | Display name — for UI header |
| `role` | `role` | `string` | Primary role shortcut |
| `permissions` (custom) | `permissions` | `string[]` | Fully resolved, expanded permission keys |
| `pv` (custom — version) | `permissionsVersion` | `number` | RBAC version stamp for staleness detection |
| `active` (custom) | `isActive` | `boolean` | Account status — always TRUE (inactive = session deleted) |
| `sid` (custom — student) | `studentId` | `number?` | Student record ID (student role only) |
| `courses` (custom) | `enrolledCourseIds` | `number[]?` | Enrolled course IDs (student role only) |
| `children` (custom) | `childStudentIds` | `number[]?` | Child student IDs (parent role only) |

### 2c. Complete `SessionData` interface (TypeScript type contract)

```
interface ClassmateSession {
  // Identity claims (all authenticated roles)
  userId:              number
  username:            string
  displayName:         string
  role:                'admin' | 'teacher' | 'student' | 'parent' | 'guest'
  isActive:            boolean          // always true; inactive users have no session

  // Permission claims (all authenticated roles)
  permissions:         string[]         // fully expanded — see Section 6a
  permissionsVersion:  number           // from rbac_version.version at login time

  // Student role claims (undefined for other roles)
  studentId?:          number | null    // null = account exists but not yet linked
  enrolledCourseIds?:  number[]

  // Parent role claims (undefined for other roles)
  childStudentIds?:    number[]
}
```

This interface extends `express-session`'s `SessionData` via module augmentation in `artifacts/api-server/src/types/session.d.ts`.

---

## 3. Authorization Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        SPRINT 2 AUTHORIZATION LAYER                         │
│                                                                              │
│  ┌───────────────────────────────────────────────────────────────────────┐   │
│  │                    LOGIN HANDLER  (auth.ts)                           │   │
│  │                                                                       │   │
│  │   ┌─────────────────────────┐   ┌──────────────────────────────┐     │   │
│  │   │ PermissionResolverSvc   │   │ SessionEnricherSvc            │     │   │
│  │   │                         │   │                              │     │   │
│  │   │ DB → user_roles         │   │ role='student' → fetch       │     │   │
│  │   │   → role_permissions    │   │   students.user_id match     │     │   │
│  │   │   → permissions.key     │   │   enrolled_course_ids        │     │   │
│  │   │ Apply manage→sub expan. │   │                              │     │   │
│  │   │ Read rbac_version       │   │ role='parent' → fetch        │     │   │
│  │   │ Returns: string[] + ver │   │   student_guardians.user_id  │     │   │
│  │   └───────────┬─────────────┘   └────────────┬─────────────────┘     │   │
│  │               │                              │                        │   │
│  │               └──────────────┬───────────────┘                        │   │
│  │                              ▼                                        │   │
│  │                    session.save(ClassmateSession)                     │   │
│  └───────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌───────────────────────────────────────────────────────────────────────┐   │
│  │                    REQUEST MIDDLEWARE CHAIN                           │   │
│  │                                                                       │   │
│  │  requireAuth                                                          │   │
│  │    └── checkRbacVersion ─── RbacVersionCacheSvc (60s TTL)            │   │
│  │          └── requirePermission('resource:action')                    │   │
│  │                └── requireOwnership(resolverFn)  [scoped routes only] │   │
│  │                      └── route handler                               │   │
│  └───────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌───────────────────────────────────────────────────────────────────────┐   │
│  │              RbacVersionCacheService  (singleton)                    │   │
│  │                                                                       │   │
│  │   currentVersion: number                                             │   │
│  │   lastRefreshed:  Date                                               │   │
│  │   TTL: 60 seconds                                                    │   │
│  │   On read: if age > TTL → SELECT version FROM rbac_version           │   │
│  │                           update currentVersion, lastRefreshed       │   │
│  └───────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Class Diagram

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         CLASSMATE CONNECT — SPRINT 2                         │
│                         AUTHORIZATION CLASS DIAGRAM                           │
└──────────────────────────────────────────────────────────────────────────────┘

  ┌─────────────────────────────────────────┐
  │           <<interface>>                  │
  │           ClassmateSession               │
  │─────────────────────────────────────────│
  │ + userId:             number             │
  │ + username:           string             │
  │ + displayName:        string             │
  │ + role:               RoleKey            │
  │ + isActive:           boolean            │
  │ + permissions:        string[]           │
  │ + permissionsVersion: number             │
  │ + studentId?:         number | null      │
  │ + enrolledCourseIds?: number[]           │
  │ + childStudentIds?:   number[]           │
  └─────────────────────────────────────────┘
             ▲
             │ extends
  ┌─────────────────────────────────────────┐
  │           SessionData                    │
  │           (express-session)              │
  └─────────────────────────────────────────┘


  ┌─────────────────────────────────────────┐
  │           <<type>>                       │
  │           RoleKey                        │
  │─────────────────────────────────────────│
  │ 'admin' | 'teacher' | 'student'         │
  │ | 'parent' | 'guest'                    │
  └─────────────────────────────────────────┘


  ┌─────────────────────────────────────────┐      ┌──────────────────────────────┐
  │           <<service>>                    │      │      <<service>>              │
  │      PermissionResolverService           │      │   RbacVersionCacheService     │
  │─────────────────────────────────────────│      │──────────────────────────────│
  │ - db: DrizzleDb                          │      │ - currentVersion: number      │
  │─────────────────────────────────────────│      │ - lastRefreshed: Date         │
  │ + resolve(userId):                       │      │ - ttlMs: number = 60_000      │
  │     Promise<ResolvedPermissions>         │      │──────────────────────────────│
  │                                          │      │ + getVersion():               │
  │ + expandManagePermissions(keys):         │      │     Promise<number>           │
  │     string[]                             │      │     (reads DB if stale)       │
  │                                          │      │                              │
  │ <<private>>                              │      │ + invalidate(): void          │
  │ - fetchUserRoles(userId):                │      │     (force immediate refresh) │
  │     Promise<number[]>                    │      └──────────────────────────────┘
  │                                          │
  │ - fetchRolePermissions(roleIds):         │
  │     Promise<string[]>                    │
  │                                          │
  │ - readRbacVersion():                     │
  │     Promise<number>                      │
  └─────────────────────────────────────────┘


  ┌─────────────────────────────────────────┐
  │           <<service>>                    │
  │        SessionEnricherService            │
  │─────────────────────────────────────────│
  │ - db: DrizzleDb                          │
  │─────────────────────────────────────────│
  │ + enrich(userId, role, session):         │
  │     Promise<void>                        │
  │                                          │
  │ <<private>>                              │
  │ - enrichStudent(userId, session):        │
  │     Promise<void>                        │
  │     Sets: studentId, enrolledCourseIds   │
  │                                          │
  │ - enrichParent(userId, session):         │
  │     Promise<void>                        │
  │     Sets: childStudentIds                │
  └─────────────────────────────────────────┘


  ┌─────────────────────────────────────────┐
  │           <<type>>                       │
  │         ResolvedPermissions              │
  │─────────────────────────────────────────│
  │ + keys: string[]                         │
  │ + version: number                        │
  └─────────────────────────────────────────┘


  ┌──────────────────────────────────────────────────────────────────────────┐
  │                          <<middleware functions>>                         │
  │                                                                           │
  │  requireAuth                                                              │
  │  ─────────────────────────────────────────────────────────────────────   │
  │  Signature:  (req, res, next) → void                                     │
  │  Checks:     req.session.userId present → else 401 UNAUTHORIZED          │
  │              req.session.isActive === true → else 401 ACCOUNT_INACTIVE   │
  │  On pass:    calls next()                                                 │
  │                                                                           │
  │  checkRbacVersion                                                         │
  │  ─────────────────────────────────────────────────────────────────────   │
  │  Signature:  (req, res, next) → Promise<void>                            │
  │  Checks:     RbacVersionCacheSvc.getVersion() vs                         │
  │                session.permissionsVersion                                 │
  │  On match:   calls next() (no DB hit)                                    │
  │  On mismatch:PermissionResolverSvc.resolve(session.userId)               │
  │              → update session.permissions + session.permissionsVersion   │
  │              → session.save() → calls next()                             │
  │                                                                           │
  │  requirePermission(key: string)                                           │
  │  ─────────────────────────────────────────────────────────────────────   │
  │  Signature:  (key: string) → RequestHandler                              │
  │  Returns a middleware that checks:                                        │
  │              session.permissions.includes(key) → else 403 FORBIDDEN      │
  │                                                                           │
  │  requireRole(...roles: RoleKey[])                                         │
  │  ─────────────────────────────────────────────────────────────────────   │
  │  Signature:  (...roles: RoleKey[]) → RequestHandler                      │
  │  Returns a middleware that checks:                                        │
  │              roles.includes(session.role) → else 403 FORBIDDEN           │
  │  Use case:   admin-only routes where a permission key is insufficient    │
  │                                                                           │
  │  requireOwnership(resolver: OwnershipResolver)                            │
  │  ─────────────────────────────────────────────────────────────────────   │
  │  Signature:  (resolver: OwnershipResolver) → RequestHandler              │
  │  Type:       OwnershipResolver = (req) => Promise<number | null>         │
  │              Returns the student_id of the resource being requested       │
  │  Logic:      admin / teacher → skip (global scope)                       │
  │              student → resolved id must equal session.studentId          │
  │              parent  → resolved id must be in session.childStudentIds[]  │
  │              else    → 403 OWNERSHIP_DENIED                              │
  └──────────────────────────────────────────────────────────────────────────┘


  DEPENDENCIES (all services depend on DrizzleDb instance)
  ─────────────────────────────────────────────────────────
  DrizzleDb (lib/db)
      ▲           ▲           ▲
      │           │           │
  PermissionResolverSvc  SessionEnricherSvc  RbacVersionCacheSvc
      │                │
      └────── used by login handler (auth.ts)
                       └────── used by checkRbacVersion middleware
```

---

## 5. Sequence Diagrams

### 5a. Login — Permission Resolution and Session Enrichment

```
Client          auth.ts         PermissionResolverSvc   SessionEnricherSvc    DB
  │                │                    │                       │               │
  │ POST /auth/login                    │                       │               │
  │ {username, password}                │                       │               │
  │────────────────►│                   │                       │               │
  │                 │                   │                       │               │
  │                 │ SELECT users WHERE username = ?           │               │
  │                 │──────────────────────────────────────────────────────────►│
  │                 │◄──────────────────────────────────────────────────────────│
  │                 │ {id, password_hash, role, is_active}       │               │
  │                 │                   │                       │               │
  │                 │ verify password   │                       │               │
  │                 │                   │                       │               │
  │                 │ resolve(userId)   │                       │               │
  │                 │──────────────────►│                       │               │
  │                 │                   │                       │               │
  │                 │                   │ SELECT ur.role_id     │               │
  │                 │                   │ FROM user_roles ur    │               │
  │                 │                   │ WHERE ur.user_id = ?  │               │
  │                 │                   │ AND (expires_at IS NULL│              │
  │                 │                   │      OR expires > NOW)│               │
  │                 │                   │──────────────────────────────────────►│
  │                 │                   │◄──────────────────────────────────────│
  │                 │                   │ [role_id, ...]         │               │
  │                 │                   │                       │               │
  │                 │                   │ SELECT p.key          │               │
  │                 │                   │ FROM role_permissions rp              │
  │                 │                   │ JOIN permissions p ON p.id = rp.permission_id
  │                 │                   │ WHERE rp.role_id = ANY(?)             │
  │                 │                   │──────────────────────────────────────►│
  │                 │                   │◄──────────────────────────────────────│
  │                 │                   │ ['students:read', ...]  │               │
  │                 │                   │                       │               │
  │                 │                   │ SELECT version        │               │
  │                 │                   │ FROM rbac_version     │               │
  │                 │                   │──────────────────────────────────────►│
  │                 │                   │◄──────────────────────────────────────│
  │                 │                   │ {version: N}          │               │
  │                 │                   │                       │               │
  │                 │                   │ expandManagePermissions()             │
  │                 │                   │ (users:manage → + users:read,         │
  │                 │                   │  users:create, users:update,          │
  │                 │                   │  users:delete)        │               │
  │                 │                   │                       │               │
  │                 │◄──────────────────│                       │               │
  │                 │ {keys: [...], version: N}                 │               │
  │                 │                   │                       │               │
  │                 │ enrich(userId, role, session)             │               │
  │                 │───────────────────────────────────────────►               │
  │                 │                   │                       │               │
  │                 │       [if role = 'student']               │               │
  │                 │                   │  SELECT id, enrolled_course_ids       │
  │                 │                   │  FROM students WHERE user_id = ?      │
  │                 │                   │──────────────────────────────────────►│
  │                 │                   │◄──────────────────────────────────────│
  │                 │                   │  {id: 42, enrolled_course_ids: [1,3]} │
  │                 │                   │                       │               │
  │                 │       [if role = 'parent']                │               │
  │                 │                   │  SELECT student_id    │               │
  │                 │                   │  FROM student_guardians               │
  │                 │                   │  WHERE user_id = ?    │               │
  │                 │                   │──────────────────────────────────────►│
  │                 │                   │◄──────────────────────────────────────│
  │                 │                   │  {childStudentIds: [7, 12]}           │
  │                 │                   │                       │               │
  │                 │◄──────────────────────────────────────────│               │
  │                 │ session enriched  │                       │               │
  │                 │                   │                       │               │
  │                 │ session.save()    │                       │               │
  │                 │ (full ClassmateSession written to DB)      │               │
  │                 │                   │                       │               │
  │◄────────────────│                   │                       │               │
  │ 200 {id, username, displayName, role}                       │               │
  │ Set-Cookie: connect.sid=...         │                       │               │
```

---

### 5b. Authenticated Request — Permission Check (no staleness)

```
Client       requireAuth    checkRbacVersion   requirePermission   RouteHandler
  │               │               │                  │                  │
  │ GET /api/students             │                  │                  │
  │ Cookie: connect.sid=...       │                  │                  │
  │───────────────►│              │                  │                  │
  │                │              │                  │                  │
  │                │ session.userId present?          │                  │
  │                │ session.isActive = true?         │                  │
  │                │ ✅ pass       │                  │                  │
  │                │──────────────►│                 │                  │
  │                │               │                 │                  │
  │                │  RbacVersionCacheSvc.getVersion()│                 │
  │                │               │ (in-memory — no DB hit if < 60s)   │
  │                │               │                 │                  │
  │                │  session.permissionsVersion == cachedVersion?      │
  │                │               │ ✅ match — skip re-resolve          │
  │                │               │─────────────────►│                │
  │                │               │                  │                 │
  │                │               │ session.permissions.includes(      │
  │                │               │   'students:read')?               │
  │                │               │                  │ ✅ pass         │
  │                │               │                  │─────────────────►
  │                │               │                  │                  │
  │                │               │                  │  SELECT * FROM students
  │                │               │                  │  WHERE deleted_at IS NULL
  │                │               │                  │◄─────────────────┤
  │◄──────────────────────────────────────────────────────────────────────
  │ 200 [{students...}]           │                  │                  │
```

---

### 5c. Stale Permissions Detected — Mid-Session Re-Resolution

```
Client       requireAuth    checkRbacVersion    PermissionResolverSvc    DB
  │               │               │                    │                  │
  │ GET /api/assessments          │                    │                  │
  │───────────────►│              │                    │                  │
  │                │ ✅ auth pass │                    │                  │
  │                │──────────────►│                   │                  │
  │                │               │                   │                  │
  │                │  RbacVersionCacheSvc.getVersion()  │                  │
  │                │               │ cache stale (> 60s) → SELECT version  │
  │                │               │──────────────────────────────────────►│
  │                │               │◄──────────────────────────────────────│
  │                │               │ version = N+1  (admin changed perms)  │
  │                │               │                   │                  │
  │                │               │ session.permissionsVersion = N         │
  │                │               │ cached version = N+1                  │
  │                │               │ ❌ MISMATCH — must re-resolve          │
  │                │               │                   │                  │
  │                │               │ resolve(session.userId)               │
  │                │               │───────────────────►│                 │
  │                │               │                    │                  │
  │                │               │                    │ SELECT keys, version
  │                │               │                    │──────────────────►│
  │                │               │                    │◄──────────────────│
  │                │               │◄───────────────────│                  │
  │                │               │ {keys: [...updated], version: N+1}    │
  │                │               │                   │                  │
  │                │               │ session.permissions = keys            │
  │                │               │ session.permissionsVersion = N+1      │
  │                │               │ session.save()    │                  │
  │                │               │                   │                  │
  │                │               │ proceed to requirePermission...       │
  │                │               │                   │                  │
  │◄──────────────────────────────────────────────────────────────────────│
  │ 200 or 403 (depending on new permissions)         │                  │
```

---

### 5d. Row-Level Scope — Parent Accessing Child's Assignment

```
Client     requireAuth   checkRbacVer   requirePermission   requireOwnership    DB
  │              │             │               │                   │              │
  │ GET /api/assignments/99    │               │                   │              │
  │──────────────►│            │               │                   │              │
  │               │ ✅ auth    │               │                   │              │
  │               │────────────►│              │                   │              │
  │               │            │ ✅ version OK │                   │              │
  │               │            │──────────────►│                  │              │
  │               │            │               │ session.permissions              │
  │               │            │               │ .includes('assignments:read')    │
  │               │            │               │ ✅ parent has it  │              │
  │               │            │               │──────────────────►│              │
  │               │            │               │                   │              │
  │               │            │               │ resolver(req)     │              │
  │               │            │               │ SELECT student_id │              │
  │               │            │               │ FROM assignments  │              │
  │               │            │               │ WHERE id = 99     │              │
  │               │            │               │───────────────────────────────►  │
  │               │            │               │                   │◄─────────────│
  │               │            │               │                   │ {student_id: 7}
  │               │            │               │                   │              │
  │               │            │               │ session.role = 'parent'          │
  │               │            │               │ resolved id = 7   │              │
  │               │            │               │ session.childStudentIds = [7,12] │
  │               │            │               │ 7 IN [7, 12]? ✅  │              │
  │               │            │               │ pass              │              │
  │               │            │               │                   │              │
  │               │            │ Route handler executes            │              │
  │◄─────────────────────────────────────────────────────────────────────────────│
  │ 200 {assignment...}         │               │                   │              │
```

---

### 5e. Ownership Check Failure — Student Accessing Another Student's Record

```
Client     requireAuth   requirePermission   requireOwnership
  │              │               │                  │
  │ GET /api/assignments/99      │                  │
  │  (session.studentId = 5)     │                  │
  │──────────────►│              │                  │
  │               │ ✅ auth      │                  │
  │               │──────────────►│                │
  │               │               │ ✅ permission   │
  │               │               │─────────────────►
  │               │               │                  │
  │               │               │ resolver(req)    │
  │               │               │ → student_id = 7  (assignment belongs to student 7)
  │               │               │                  │
  │               │               │ session.role = 'student'
  │               │               │ resolved id = 7  │
  │               │               │ session.studentId = 5
  │               │               │ 7 === 5? ❌       │
  │               │               │                  │
  │◄──────────────────────────────────────────────────
  │ 403 { error: { code: 'OWNERSHIP_DENIED', status: 403 } }
```

---

## 6. Service Responsibilities

---

### 6a. `PermissionResolverService`

**Location:** `artifacts/api-server/src/services/permissionResolver.ts`  
**Instantiation:** Singleton — one instance per process, created at startup, stored in `app.locals`

**Primary responsibility:**  
Given a `userId`, produce the complete, expanded set of permission keys and the current RBAC version number. Called only at login time (not per-request).

**`resolve(userId)` — detailed logic:**

```
Step 1 — Fetch active role IDs
  SELECT role_id FROM user_roles
  WHERE user_id = :userId
    AND (expires_at IS NULL OR expires_at > NOW())
  → roleIds: number[]

Step 2 — Fetch permission keys for those roles
  SELECT DISTINCT p.key
  FROM role_permissions rp
  JOIN permissions p ON p.id = rp.permission_id
  WHERE rp.role_id = ANY(:roleIds)
  → rawKeys: string[]

Step 3 — Apply manage→sub-permission expansion
  For each key in rawKeys:
    if key ends with ':manage':
      resource = key.split(':')[0]
      add: resource:read, resource:create, resource:update, resource:delete
  → expandedKeys: string[] (deduplicated)

Step 4 — Read current RBAC version
  SELECT version FROM rbac_version WHERE id = 1
  → version: number

Step 5 — Return { keys: expandedKeys, version }
```

**Manage expansion mapping:**

| Input key | Keys added to set |
|---|---|
| `users:manage` | `users:read`, `users:create`, `users:update`, `users:delete` |
| `roles:manage` | `roles:read`, `roles:create`, `roles:update`, `roles:delete` |
| `students:manage` | `students:read`, `students:create`, `students:update`, `students:delete` |
| `courses:manage` | `courses:read`, `courses:create`, `courses:update`, `courses:delete` |

Note: No existing role currently holds any `:manage` key except `users:manage` and `roles:manage` (admin only). Expansion is applied defensively for future custom role grants.

---

### 6b. `RbacVersionCacheService`

**Location:** `artifacts/api-server/src/services/rbacVersionCache.ts`  
**Instantiation:** Singleton — one instance per process

**Primary responsibility:**  
Maintain a 60-second in-memory cache of `rbac_version.version`. Prevents a DB hit on every authenticated request while still detecting permission changes within 60 seconds.

**`getVersion()` — logic:**

```
if (Date.now() - lastRefreshed) < TTL_MS:
  return currentVersion   ← no DB hit
else:
  SELECT version FROM rbac_version WHERE id = 1
  currentVersion = result.version
  lastRefreshed = Date.now()
  return currentVersion
```

**`invalidate()` — called by:**  
The admin `PATCH /api/admin/roles/:id/permissions` route (Sprint 3). Forces immediate cache refresh on the next `getVersion()` call by resetting `lastRefreshed = new Date(0)`.

---

### 6c. `SessionEnricherService`

**Location:** `artifacts/api-server/src/services/sessionEnricher.ts`  
**Instantiation:** Singleton — one instance per process

**Primary responsibility:**  
Populate role-specific session fields after permission resolution. Called once at login, after `PermissionResolverService.resolve()`.

**`enrich(userId, role, session)` — logic:**

```
if role === 'student':
  SELECT id AS studentId, enrolled_course_ids AS enrolledCourseIds
  FROM students
  WHERE user_id = :userId
    AND deleted_at IS NULL

  if row found:
    session.studentId = row.studentId
    session.enrolledCourseIds = row.enrolledCourseIds ?? []
  else:
    session.studentId = null       ← account not yet linked to a student record
    session.enrolledCourseIds = []

if role === 'parent':
  SELECT student_id FROM student_guardians
  WHERE user_id = :userId

  session.childStudentIds = rows.map(r => r.student_id)
  // [] if no guardian links exist yet

if role === 'admin' or 'teacher' or 'guest':
  no-op — no role-specific fields needed
```

---

### 6d. Middleware Functions

**Location:** `artifacts/api-server/src/middleware/auth.ts`  
All functions are exported from the single `auth.ts` file.

**`requireAuth`** (replaces the current minimal implementation):

```
Checks:
  1. req.session?.userId → if falsy: respond 401 { error: { code: 'UNAUTHORIZED' } }
  2. req.session.isActive === true → if false: respond 401 { error: { code: 'ACCOUNT_INACTIVE' } }

On pass: call next()
```

**`checkRbacVersion`** (new):

```
Async middleware — must be placed immediately after requireAuth.

Steps:
  1. cachedVersion = await RbacVersionCacheSvc.getVersion()
  2. if req.session.permissionsVersion === cachedVersion: call next() (fast path)
  3. else:
       resolved = await PermissionResolverSvc.resolve(req.session.userId)
       req.session.permissions = resolved.keys
       req.session.permissionsVersion = resolved.version
       await req.session.save()
       call next()

Error handling: if DB unreachable, log error and call next()
  — fail open on permission refresh (user retains stale permissions rather than
    being locked out due to a transient DB connectivity blip)
```

**`requirePermission(key: string)`** (new):

```
Factory — returns a synchronous RequestHandler.

Returned middleware:
  1. if req.session.permissions.includes(key): call next()
  2. else: respond 403 { error: { code: 'FORBIDDEN', required: key, status: 403 } }
     Note: do NOT include 'required' field for student/parent roles (see Auth Design §9)
```

**`requireRole(...roles: RoleKey[])`** (new):

```
Factory — returns a synchronous RequestHandler.

Returned middleware:
  1. if roles.includes(req.session.role): call next()
  2. else: respond 403 { error: { code: 'FORBIDDEN', status: 403 } }
```

**`requireOwnership(resolver: OwnershipResolver)`** (new):

```
Type: OwnershipResolver = (req: Request) => Promise<number | null>
  — Returns the student_id of the resource being requested.
  — Returns null if the resource does not exist (route handler will 404).

Factory — returns an async RequestHandler.

Returned middleware:
  1. if session.role === 'admin' or 'teacher': call next() (global scope — skip)
  2. resolvedStudentId = await resolver(req)
  3. if resolvedStudentId === null: call next() (resource not found — let route handler 404)
  4. if session.role === 'student':
       if resolvedStudentId === session.studentId: call next()
       else: respond 403 { error: { code: 'OWNERSHIP_DENIED', status: 403 } }
  5. if session.role === 'parent':
       if session.childStudentIds?.includes(resolvedStudentId): call next()
       else: respond 403 { error: { code: 'OWNERSHIP_DENIED', status: 403 } }
  6. else: respond 403
```

---

## 7. Authorization Flow

### 7a. Complete decision tree per request

```
Incoming Request
       │
       ▼
Is route in PUBLIC list?
  /api/healthz, /api/auth/login, /api/auth/logout,
  /api/downloads/upgrade, /api/public/courses
       │
   YES │                         NO
       ▼                          │
Route handler                     ▼
(no auth)               ┌─── requireAuth ───┐
                         │                   │
                      PASS                 FAIL
                         │                   │
                         ▼                   ▼
                  checkRbacVersion      401 UNAUTHORIZED
                         │
               version match?
                    │         │
                   YES        NO
                    │          │
                    │     resolve permissions
                    │     update session
                    │          │
                    └────┬─────┘
                         │
                         ▼
               requirePermission(key)
                         │
               key in session.permissions?
                    │         │
                   YES        NO
                    │          │
                    │     403 FORBIDDEN
                    │
                    ▼
       Is route SCOPED (requireOwnership)?
                    │         │
                   NO        YES
                    │          │
              Route handler    │
                               ▼
                    resolver(req) → studentId
                               │
                         studentId null?
                         │           │
                        YES          NO
                         │           │
                    Route handler    │
                    (will 404)       ▼
                               role check
                               │
                    admin/teacher: PASS → Route handler
                    student: studentId === session.studentId?
                    parent:  studentId IN session.childStudentIds?
                               │         │
                              YES        NO
                               │          │
                          Route handler  403 OWNERSHIP_DENIED
```

---

### 7b. Middleware composition pattern per route type

**Pattern 1 — Global read (admin + teacher):**
```
router.get('/path', requireAuth, checkRbacVersion, requirePermission('resource:read'), handler)
```

**Pattern 2 — Scoped read (student/parent see only their own data):**
```
router.get('/path/:id', requireAuth, checkRbacVersion, requirePermission('resource:read'),
  requireOwnership(resolverFn), handler)
```

**Pattern 3 — Write operation (no ownership check — only admin/teacher write):**
```
router.post('/path', requireAuth, checkRbacVersion, requirePermission('resource:create'), handler)
```

**Pattern 4 — Admin only (requireRole replaces requirePermission):**
```
router.get('/admin/users', requireAuth, checkRbacVersion, requireRole('admin'), handler)
```

**Pattern 5 — Student portal (role-gated, not permission-gated):**
```
router.get('/student/dashboard', requireAuth, checkRbacVersion, requireRole('student'), handler)
```

---

## 8. Middleware Design

### 8a. Middleware registration order in `app.ts`

```
Express Application Setup (app.ts) — final order after Sprint 2

[1]  pinoHttp(logger)             — request/response logging
[2]  cors({ origin: true, credentials: true })
[3]  express.json({ limit: '2mb' })
[4]  session({                    — restore ClassmateSession from PostgreSQL
       store: new PgSession({ pool }),
       secret: process.env.SESSION_SECRET,
       resave: false,
       saveUninitialized: false,
       cookie: {
         httpOnly: true,
         sameSite: 'lax',
         maxAge: 8 * 60 * 60 * 1000   — 8 hours
       }
     })

[5]  app.use('/api/public', publicRouter)   — no auth: /public/courses
[6]  app.use('/api/health', healthRouter)   — no auth: /healthz
[7]  app.use('/api/auth', authRouter)       — no auth: login, logout
[8]  app.use('/api/downloads', downloadsRouter) — no auth

[9]  app.use('/api', requireAuth)           — all remaining routes require auth
[10] app.use('/api', checkRbacVersion)      — version check after requireAuth

[11] app.use('/api/students',    studentsRouter)
[12] app.use('/api/courses',     coursesRouter)
[13] app.use('/api/assignments', assignmentsRouter)
[14] app.use('/api/notes',       notesRouter)
[15] app.use('/api/assessments', assessmentsRouter)
[16] app.use('/api/dashboard',   dashboardRouter)
[17] app.use('/api/reports',     reportsRouter)      ← new Phase 2
[18] app.use('/api/admin',       adminRouter)

[19] 404 handler
[20] global error handler
```

**Key design decisions:**

- `requireAuth` and `checkRbacVersion` are registered globally at the `/api` level (lines 9–10). This means they run for ALL routes under `/api` except the public ones registered before line 9. This is cleaner than applying them per-route and prevents accidental omission.
- `requirePermission`, `requireRole`, and `requireOwnership` are applied **per-route** inside each router file. They are not global.

### 8b. Global error handler design

The global error handler (last middleware in `app.ts`) catches any errors propagated via `next(err)` and returns the standardised error envelope:

```
{
  "error": {
    "code":    string   — UNAUTHORIZED | FORBIDDEN | OWNERSHIP_DENIED |
                         NOT_FOUND | VALIDATION_ERROR | CONFLICT |
                         INTERNAL_ERROR
    "message": string   — human-readable
    "status":  number   — HTTP status code
    "field"?:  string   — present for VALIDATION_ERROR only
  }
}
```

401 and 403 responses are generated inline by the middleware (not via `next(err)`) to prevent error handler interception from leaking stack traces.

---

## 9. Folder Structure Changes

```
artifacts/api-server/src/
├── app.ts                         ← MODIFIED — register new middleware order
├── index.ts                       ← no change
│
├── types/
│   └── session.d.ts               ← NEW — module augmentation for ClassmateSession
│
├── middleware/
│   └── auth.ts                    ← MODIFIED — replace requireAuth, add 4 new exports:
│                                    requireAuth (updated)
│                                    checkRbacVersion (new)
│                                    requirePermission (new)
│                                    requireRole (new)
│                                    requireOwnership (new)
│
├── services/                      ← NEW DIRECTORY
│   ├── permissionResolver.ts      ← NEW — PermissionResolverService class
│   ├── rbacVersionCache.ts        ← NEW — RbacVersionCacheService class
│   └── sessionEnricher.ts         ← NEW — SessionEnricherService class
│
├── lib/
│   ├── password.ts                ← no change
│   └── logger.ts                  ← no change
│
└── routes/
    ├── index.ts                   ← MODIFIED — remove per-router requireAuth guard
    │                                (now applied globally in app.ts)
    ├── auth.ts                    ← MODIFIED — call services at login; extend /me response
    ├── students.ts                ← MODIFIED — add requirePermission + requireOwnership
    ├── courses.ts                 ← MODIFIED — add requirePermission + requireOwnership
    ├── assignments.ts             ← MODIFIED — add requirePermission + requireOwnership
    ├── notes.ts                   ← MODIFIED — add requirePermission + requireOwnership
    ├── assessments.ts             ← MODIFIED — add requirePermission + requireOwnership
    ├── dashboard.ts               ← MODIFIED — add requirePermission('dashboard:view')
    ├── admin.ts                   ← MODIFIED — add requireRole('admin')
    ├── downloads.ts               ← no change (public route)
    └── health.ts                  ← no change (public route)
```

---

## 10. Dependency Injection Registrations

Express does not have a native DI container. The equivalent is `app.locals` for shared singletons, accessed via `req.app.locals` in route handlers and middleware.

### 10a. Service instantiation at startup (`index.ts`)

**Creation order:**

```
Startup sequence (index.ts):

1. Import db pool from lib/db                         ← existing
2. Instantiate RbacVersionCacheService(db)            ← NEW singleton
3. Instantiate PermissionResolverService(db, rbacVersionCacheSvc)  ← NEW singleton
4. Instantiate SessionEnricherService(db)             ← NEW singleton
5. Import app from app.ts                             ← existing
6. Register singletons on app.locals:
     app.locals.permissionResolver = permissionResolverSvc
     app.locals.rbacVersionCache   = rbacVersionCacheSvc
     app.locals.sessionEnricher    = sessionEnricherSvc
7. app.listen(PORT)                                   ← existing
```

### 10b. Service access pattern in middleware and routes

Services are accessed from `req.app.locals` inside middleware and route handlers:

```
Middleware / route handler access pattern:
  const { permissionResolver, rbacVersionCache, sessionEnricher } = req.app.locals
```

### 10c. `app.locals` type declaration

To enable TypeScript type checking on `app.locals`, a module augmentation is added to `src/types/express.d.ts`:

```
Interface declaration (not code):
  Augment Express.Application.locals with:
    permissionResolver: PermissionResolverService
    rbacVersionCache:   RbacVersionCacheService
    sessionEnricher:    SessionEnricherService
```

This prevents `req.app.locals.permissionResolver` from being typed as `any`.

---

## 11. Request Pipeline Integration

### 11a. Middleware layer diagram (complete runtime stack)

```
HTTP Request
     │
     ▼  [1] pinoHttp         ← logs every request/response
     │
     ▼  [2] cors             ← CORS headers
     │
     ▼  [3] express.json     ← parse body (2mb limit)
     │
     ▼  [4] session()        ← restore ClassmateSession from PG session table (JSONB)
     │
     ├─ /api/public/*        ← no auth — serve public course list
     ├─ /api/healthz         ← no auth — health check
     ├─ /api/auth/*          ← no auth — login / logout (auth handler uses services internally)
     ├─ /api/downloads/*     ← no auth — upgrade bundle
     │
     ▼  [9] requireAuth      ← 401 if no session.userId or isActive=false
     │
     ▼ [10] checkRbacVersion ← compare session.permissionsVersion vs RbacVersionCacheSvc
     │                          re-resolve if stale (one DB query + session.save)
     │
     ├─ /api/students/*      ← requirePermission + requireOwnership per route
     ├─ /api/courses/*       ← requirePermission + requireOwnership per route
     ├─ /api/assignments/*   ← requirePermission + requireOwnership per route
     ├─ /api/notes/*         ← requirePermission + requireOwnership per route
     ├─ /api/assessments/*   ← requirePermission + requireOwnership per route
     ├─ /api/dashboard/*     ← requirePermission('dashboard:view')
     ├─ /api/reports/*       ← requirePermission + requireOwnership per route
     └─ /api/admin/*         ← requireRole('admin') on all routes
```

### 11b. Login handler pipeline (internal)

```
POST /api/auth/login
     │
     ▼ Parse body → { username, password }
     │
     ▼ SELECT user WHERE username = ?
     │   → 401 if not found or is_active = false
     │
     ▼ Verify password (bcrypt compare)
     │   → 401 if mismatch
     │
     ▼ PermissionResolverService.resolve(userId)
     │   → { keys: string[], version: number }
     │
     ▼ SessionEnricherService.enrich(userId, role, session)
     │   → sets studentId / enrolledCourseIds / childStudentIds
     │
     ▼ Build session:
     │   session.userId             = user.id
     │   session.username           = user.username
     │   session.displayName        = user.display_name
     │   session.role               = user.role
     │   session.isActive           = true
     │   session.permissions        = resolved.keys
     │   session.permissionsVersion = resolved.version
     │   [role-specific fields from enricher]
     │
     ▼ session.save()
     │
     ▼ 200 { id, username, displayName, role }
         ← same response shape as today (backward compatible)
         Set-Cookie: connect.sid=...
```

---

## 12. API Integration Plan

For each existing route, this plan specifies the exact middleware chain after Sprint 2. Routes marked 🔲 do not exist yet and are Sprint 3+.

### Legend

```
[A]   = requireAuth        (global — applied in app.ts for all /api routes below public)
[V]   = checkRbacVersion   (global — applied in app.ts)
[P:x] = requirePermission('x')
[R:x] = requireRole('x')
[O]   = requireOwnership(resolver)
```

Global middleware `[A]` and `[V]` apply to ALL routes below this table's divider. Per-route columns show only the additional middleware.

---

### 12a. Auth routes

| Method | Path | Additional middleware | Note |
|---|---|---|---|
| POST | `/api/auth/login` | _(none — public)_ | Login handler internally calls services |
| POST | `/api/auth/logout` | _(none — public)_ | Destroys session |
| GET | `/api/auth/me` | _(none — auth checked globally)_ | Returns extended session payload with `permissions[]` |

---

### 12b. Students

| Method | Path | Additional middleware | Who can access |
|---|---|---|---|
| GET | `/api/students` | `[P:students:read]` | Admin, Teacher |
| POST | `/api/students` | `[P:students:create]` | Admin, Teacher |
| GET | `/api/students/:id` | `[P:students:read]` `[O]` | Admin, Teacher, Student (own), Parent (children) |
| PATCH | `/api/students/:id` | `[P:students:update]` | Admin, Teacher |
| DELETE | `/api/students/:id` 🔲 | `[P:students:delete]` | Admin only |
| GET | `/api/students/:id/progress` | `[P:students:read]` `[O]` | Admin, Teacher, Student (own), Parent (children) |
| GET | `/api/students/:id/ai-suggestions` | `[P:ai:suggestions]` `[O]` | Admin, Teacher, Student (own), Parent (children) |

**Ownership resolver for `students` routes:**  
`resolver(req) → parseInt(req.params.id)` — the student ID is the path param itself.

---

### 12c. Courses

| Method | Path | Additional middleware | Who can access |
|---|---|---|---|
| GET | `/api/courses` | `[P:courses:read]` | Admin, Teacher (global); Student/Parent (scoped in handler — enrolled only) |
| POST | `/api/courses` | `[P:courses:create]` | Admin, Teacher |
| GET | `/api/courses/:id` | `[P:courses:read]` | Admin, Teacher (global); Student/Parent (scoped in handler — enrolled only) |
| PATCH | `/api/courses/:id` | `[P:courses:update]` | Admin, Teacher |
| DELETE | `/api/courses/:id` | `[P:courses:delete]` | Admin only |
| GET | `/api/public/courses` | _(none — public)_ | All including Guest |

**Note on course scope:** Course-level scoping for Student/Parent (enrolled courses only) is enforced in the route handler using `session.enrolledCourseIds` / `session.childStudentIds`, not via `requireOwnership`. Courses do not have a single `student_id` FK — they are many-to-many. The `requireOwnership` middleware is designed for student_id-based resources only.

---

### 12d. Assignments

| Method | Path | Additional middleware | Who can access |
|---|---|---|---|
| GET | `/api/assignments` | `[P:assignments:read]` | Admin, Teacher (global); Student/Parent (handler-scoped by student_id) |
| POST | `/api/assignments` | `[P:assignments:create]` | Admin, Teacher |
| GET | `/api/assignments/:id` | `[P:assignments:read]` `[O]` | Admin, Teacher, Student (own), Parent (children) |
| PATCH | `/api/assignments/:id` | `[P:assignments:update]` | Admin, Teacher |
| DELETE | `/api/assignments/:id` | `[P:assignments:delete]` | Admin, Teacher |

**Ownership resolver for `assignments/:id`:**  
`resolver(req) → SELECT student_id FROM assignments WHERE id = req.params.id`

---

### 12e. Notes / Lessons

| Method | Path | Additional middleware | Who can access |
|---|---|---|---|
| GET | `/api/notes` | `[P:notes:read]` | Admin, Teacher (global); Student/Parent (handler-scoped by enrolled course_id) |
| POST | `/api/notes` | `[P:notes:create]` | Admin, Teacher |
| GET | `/api/notes/:id` | `[P:notes:read]` | Admin, Teacher (global); Student/Parent (handler checks course enrollment) |
| PATCH | `/api/notes/:id` | `[P:notes:update]` | Admin, Teacher |
| DELETE | `/api/notes/:id` | `[P:notes:delete]` | Admin, Teacher |

**Note on notes scope:** Notes are course-scoped, not student-scoped. `requireOwnership` does not apply. The handler applies: `WHERE notes.course_id = ANY(session.enrolledCourseIds)` for student/parent access.

---

### 12f. Assessments

| Method | Path | Additional middleware | Who can access |
|---|---|---|---|
| GET | `/api/assessments` | `[P:assessments:read]` | Admin, Teacher (global); Student/Parent (handler-scoped) |
| POST | `/api/assessments` | `[P:assessments:create]` | Admin, Teacher |
| PATCH | `/api/assessments/:id` | `[P:assessments:update]` | Admin, Teacher |
| DELETE | `/api/assessments/:id` | `[P:assessments:delete]` | Admin only |

**Scoped list filter for GET `/api/assessments`:**  
Handler checks `session.role` and applies `WHERE student_id = :studentId` or `WHERE student_id = ANY(:childStudentIds)` for student/parent.

---

### 12g. Dashboard

| Method | Path | Additional middleware | Who can access |
|---|---|---|---|
| GET | `/api/dashboard/summary` | `[P:dashboard:view]` | Admin, Teacher |
| GET | `/api/dashboard/recent-activity` | `[P:dashboard:view]` | Admin, Teacher |
| GET | `/api/dashboard/grade-breakdown` | `[P:dashboard:view]` | Admin, Teacher |

**Note:** Student and Parent have `dashboard:view` in the permission matrix (for their own scoped dashboard — Sprint 3). These endpoints serve the teacher dashboard only. Student/Parent attempting to access them will receive 403 at the handler level via role check, since no student/parent-specific data is returned here.

**Sprint 3 design note:** Student/Parent dashboard endpoints will be `/api/student/dashboard` and `/api/parent/dashboard` — separate routes with `[R:student]` and `[R:parent]` guards, not these existing endpoints.

---

### 12h. Admin

| Method | Path | Additional middleware | Who can access |
|---|---|---|---|
| GET | `/api/admin/db-status` | `[R:admin]` | Admin only |
| POST | `/api/admin/test-db` | `[R:admin]` | Admin only |
| GET | `/api/admin/users` 🔲 | `[R:admin]` `[P:users:read]` | Admin only |
| POST | `/api/admin/users` 🔲 | `[R:admin]` `[P:users:manage]` | Admin only |
| GET | `/api/admin/users/:id` 🔲 | `[R:admin]` `[P:users:read]` | Admin only |
| PATCH | `/api/admin/users/:id` 🔲 | `[R:admin]` `[P:users:manage]` | Admin only |
| DELETE | `/api/admin/users/:id` 🔲 | `[R:admin]` `[P:users:manage]` | Admin only |
| POST | `/api/admin/users/:id/reset-password` 🔲 | `[R:admin]` `[P:users:manage]` | Admin only |

---

### 12i. Infrastructure

| Method | Path | Additional middleware | Note |
|---|---|---|---|
| GET | `/api/healthz` | _(none — public)_ | No change |
| GET | `/api/downloads/upgrade` | _(none — public)_ | No change |

---

## 13. Risks & Mitigation

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R-01 | **`checkRbacVersion` DB failure causes request failure** | Low | Medium — authenticated users blocked | Fail-open: on DB error, log warning and call `next()` with stale permissions. User experience preserved; stale permissions are safe for minutes. |
| R-02 | **Student `user_id` not linked when they first log in** | Medium | Medium — `session.studentId = null`, all scoped routes return empty | `requireOwnership` resolver returns null → route handler returns empty array (not 403). Graceful degradation. Admin links the account. |
| R-03 | **Parent has no `childStudentIds` linked** | Medium | Low — all scoped routes return empty | Same graceful degradation as R-02. Parent sees empty lists until admin links guardian records. |
| R-04 | **`session.save()` failure in `checkRbacVersion`** | Low | Low — stale permissions persist until next login | Log the save failure. User continues with stale permissions for the session lifetime. Not a security issue — stale permissions are always a subset of the true set if permissions were reduced. |
| R-05 | **Existing routes miss a `requirePermission` call** | Medium | High — route unintentionally unprotected | `requireAuth` + `checkRbacVersion` run globally — so the route is not anonymous. Missing `requirePermission` means role/permission check is skipped but auth is still required. Sprint 2 integration plan (Section 12) is the authoritative checklist. Code review must verify each route. |
| R-06 | **Dashboard `[P:dashboard:view]` blocks Student/Parent incorrectly** | Medium | Low — Student/Parent should not access the teacher dashboard | Expected and correct. Student/Parent portal routes are separate paths (Sprint 3). Document this explicitly in release notes. |
| R-07 | **TypeScript session module augmentation conflicts with express-session types** | Low | Medium — typecheck failures | `session.d.ts` must use `declare module 'express-session'` augmentation pattern. Test with `pnpm run typecheck` before Sprint 2 is marked complete. |
| R-08 | **`app.locals` type augmentation breaks existing code** | Low | Low — typing only, runtime unaffected | Express type augmentation is additive. Existing `req.app.locals` usages remain valid. |

---

## 14. Sprint 2 Completion Criteria

Sprint 2 is complete and approved for Sprint 3 when **all** of the following are confirmed:

| # | Criterion | Confirmed by |
|---|---|---|
| SC-01 | All existing routes have correct middleware per Section 12 | Dev — code review checklist |
| SC-02 | `POST /api/auth/login` returns same shape as today (backward compatible) | Dev — manual test |
| SC-03 | `GET /api/auth/me` returns `permissions[]` array in response | Dev — manual test |
| SC-04 | Admin user receives 200 on all admin routes | Dev — automated test |
| SC-05 | Teacher user receives 403 on `GET /api/admin/db-status` | Dev — automated test |
| SC-06 | Student user receives 403 on `GET /api/students` (list all) | Dev — automated test |
| SC-07 | Student user receives 200 on `GET /api/students/:ownId` | Dev — automated test |
| SC-08 | Student user receives 403 on `GET /api/students/:otherId` | Dev — automated test |
| SC-09 | Parent user receives 200 on `GET /api/assignments/:childAssignmentId` | Dev — manual test |
| SC-10 | Parent user receives 403 on `GET /api/assignments/:nonChildAssignmentId` | Dev — manual test |
| SC-11 | After admin modifies role_permissions, next request within 60s re-resolves permissions | Dev — manual test (update DB row, wait, verify) |
| SC-12 | `pnpm run typecheck` passes with zero errors | Dev — CI |
| SC-13 | `pnpm --filter @workspace/api-spec run codegen` passes | Dev — CI |
| SC-14 | Sprint 3 scope document reviewed and approved by stakeholders | PM |

---

*Sprint 2 scope is complete as specified. Sprint 3 (student portal routes, parent portal routes, admin user management API, course_enrollments migration, frontend route guards) will not begin until this document is approved.*
