# Classmate Connect — Architecture & Design Document

> **Version:** 1.0  
> **Date:** June 2026  
> **Status:** Active Development  

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [System Architecture](#2-system-architecture)
3. [Technology Stack](#3-technology-stack)
4. [Repository Structure](#4-repository-structure)
5. [Database Schema](#5-database-schema)
6. [API Contract](#6-api-contract)
7. [Frontend Architecture](#7-frontend-architecture)
8. [Authentication & Security](#8-authentication--security)
9. [Deployment Architecture (Windows IIS)](#9-deployment-architecture-windows-iis)
10. [Completed Modules](#10-completed-modules)
11. [Planned Modules — Phase 2](#11-planned-modules--phase-2)
12. [RBAC Design](#12-rbac-design)
13. [Key Design Decisions](#13-key-design-decisions)

---

## 1. Project Overview

**Classmate Connect** is an AI-powered educational platform for teachers and school administrators. It enables tracking of student progress, assignment management, lesson delivery, assessment scoring, and AI-driven improvement suggestions.

### Goals

| Goal | Status |
|---|---|
| Teacher-facing class management dashboard | Done |
| Student/course/assignment/assessment CRUD | Done |
| Session-based authentication with encrypted passwords | Done |
| AI improvement suggestions per student | Done |
| Windows IIS + PostgreSQL on-premises deployment | Done |
| Role-based access control (Admin / Teacher / Student / Guest) | Planned |
| Student self-service portal with subject dashboard | Planned |
| Admin user management console | Planned |
| Teacher progress report across all students | Planned |

---

## 2. System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                   Windows Server (IIS)                          │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │   IIS Virtual Application  /classmate                    │   │
│  │   Physical path: C:\inetpub\classmate                    │   │
│  │   Serves:  React SPA (static files)                      │   │
│  │                                                          │   │
│  │   URL Rewrite Rule:                                      │   │
│  │   /classmate/api/*  →  localhost:3001/api/*              │   │
│  └──────────────────────────────────────────────────────────┘   │
│                          │                                      │
│                          ▼  HTTP proxy                          │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │   NSSM Service: ClassmateAPI                             │   │
│  │   Node.js  (ESM bundle at api-dist/index.mjs)            │   │
│  │   Express 5  ·  Drizzle ORM  ·  pino logging            │   │
│  │   PORT=3001   NODE_ENV=production                        │   │
│  └──────────────────────────────────────────────────────────┘   │
│                          │                                      │
│                          ▼  TCP :5432                           │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │   PostgreSQL 18                                          │   │
│  │   Database: classmate_db                                 │   │
│  │   User: classmate_user  (no special chars in password)   │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow

```
Browser
  │
  ├─ GET /classmate/*            → IIS serves index.html (SPA)
  │
  └─ XHR /classmate/api/**
        │
        └─ IIS URL Rewrite → localhost:3001/api/**
                                │
                                └─ Express routes → Drizzle ORM → PostgreSQL
```

---

## 3. Technology Stack

| Layer | Technology | Version |
|---|---|---|
| Runtime | Node.js | 24 |
| Package manager | pnpm (workspaces) | latest |
| Language | TypeScript | 5.9 |
| API framework | Express | 5 |
| ORM | Drizzle ORM | latest |
| Database driver | node-postgres (pg) | latest |
| Database | PostgreSQL | 18 |
| Session store | connect-pg-simple | — |
| Logging | pino + pino-http | — |
| Input validation | Zod v4 + drizzle-zod | — |
| API codegen | Orval (OpenAPI → React Query hooks) | — |
| Frontend framework | React | 18 |
| Routing | wouter | — |
| State/data fetching | TanStack React Query | — |
| UI components | shadcn/ui (Radix UI primitives) | — |
| Charts | Recharts | — |
| Bundler (frontend) | Vite | — |
| Bundler (server) | esbuild (CJS/ESM) | — |
| AI integration | OpenAI (assessment suggestions) | — |
| Service manager (Windows) | NSSM | — |
| Web server (Windows) | IIS with URL Rewrite module | — |

---

## 4. Repository Structure

```
classmate-monorepo/
│
├── artifacts/
│   ├── api-server/              # Express API — deployed as NSSM service
│   │   └── src/
│   │       ├── app.ts           # Express app, session, CORS, middleware
│   │       ├── index.ts         # Server entry point
│   │       ├── middleware/
│   │       │   └── auth.ts      # requireAuth middleware
│   │       ├── lib/
│   │       │   ├── password.ts  # AES-256-GCM + bcrypt password handling
│   │       │   └── logger.ts    # pino singleton logger
│   │       └── routes/
│   │           ├── index.ts     # Route composition + requireAuth guard
│   │           ├── auth.ts      # login / logout / me
│   │           ├── students.ts  # Student CRUD + progress
│   │           ├── courses.ts   # Course CRUD
│   │           ├── assignments.ts
│   │           ├── notes.ts
│   │           ├── assessments.ts + AI suggestions
│   │           ├── dashboard.ts # Aggregation endpoints
│   │           ├── admin.ts     # DB status + test-connection
│   │           ├── downloads.ts # Upgrade bundle download
│   │           └── health.ts    # /healthz
│   │
│   └── classmate/               # React SPA — served by IIS as static files
│       └── src/
│           ├── App.tsx          # Router, AuthProvider, route protection
│           ├── lib/auth.tsx     # AuthContext, useAuth hook
│           ├── components/
│           │   ├── layout.tsx   # Sidebar + mobile nav shell
│           │   └── ui/          # shadcn/ui component library (50+ components)
│           ├── pages/
│           │   ├── dashboard.tsx
│           │   ├── students/    # index, detail, ai
│           │   ├── courses/     # index, detail
│           │   ├── assignments/
│           │   ├── notes/       # index, detail
│           │   ├── assessments/
│           │   ├── settings/
│           │   └── login/
│           └── hooks/
│
├── lib/
│   ├── db/                      # @workspace/db — Drizzle schema + pg pool
│   │   └── src/
│   │       ├── index.ts         # pool, db instance, testConnection()
│   │       └── schema/          # One file per table
│   │           ├── users.ts
│   │           ├── students.ts
│   │           ├── courses.ts
│   │           ├── assignments.ts
│   │           ├── notes.ts
│   │           ├── assessments.ts
│   │           └── activity.ts
│   │
│   ├── api-spec/                # @workspace/api-spec — OpenAPI YAML
│   └── api-client-react/        # @workspace/api-client-react — generated hooks
│
├── scripts/                     # Utility / seed scripts
├── classmate-upgrade.sql        # Idempotent DB migration (run as postgres)
├── Upgrade-Classmate.ps1        # Windows upgrade automation script
└── ARCHITECTURE.md              # This document
```

---

## 5. Database Schema

### Current Tables

#### `users` — Login accounts
```sql
id            SERIAL PRIMARY KEY
username      TEXT NOT NULL UNIQUE
password_hash TEXT NOT NULL          -- AES-256-GCM( bcrypt(password) )
display_name  TEXT NOT NULL
role          TEXT NOT NULL DEFAULT 'teacher'  -- admin | teacher | student | guest
is_active     BOOLEAN NOT NULL DEFAULT TRUE
created_at    TIMESTAMP NOT NULL DEFAULT NOW()
updated_at    TIMESTAMP NOT NULL DEFAULT NOW()
```

#### `session` — Express session store (connect-pg-simple)
```sql
sid     VARCHAR PRIMARY KEY
sess    JSON NOT NULL
expire  TIMESTAMP(6) NOT NULL
-- INDEX: IDX_session_expire
```

#### `students` — Student roster records
```sql
id                  SERIAL PRIMARY KEY
name                TEXT NOT NULL
email               TEXT NOT NULL UNIQUE
grade               TEXT NOT NULL
avatar_url          TEXT
enrolled_course_ids JSON DEFAULT '[]'   -- array of course IDs
created_at          TIMESTAMPTZ DEFAULT NOW()
```

#### `courses` — Course catalog
```sql
id            SERIAL PRIMARY KEY
name          TEXT NOT NULL
description   TEXT NOT NULL
teacher_name  TEXT NOT NULL
subject       TEXT NOT NULL
student_count INTEGER DEFAULT 0
created_at    TIMESTAMPTZ DEFAULT NOW()
```

#### `assignments` — Student assignments
```sql
id          SERIAL PRIMARY KEY
title       TEXT NOT NULL
description TEXT NOT NULL
course_id   INTEGER NOT NULL   -- FK → courses.id (not enforced)
student_id  INTEGER NOT NULL   -- FK → students.id (not enforced)
due_date    TEXT NOT NULL
status      TEXT DEFAULT 'pending'  -- pending | submitted | graded | late
score       REAL
max_score   REAL DEFAULT 100
feedback    TEXT
created_at  TIMESTAMPTZ DEFAULT NOW()
```

#### `notes` — Lesson notes / topics
```sql
id         SERIAL PRIMARY KEY
title      TEXT NOT NULL
content    TEXT NOT NULL
course_id  INTEGER NOT NULL
topic      TEXT NOT NULL
video_url  TEXT
created_at TIMESTAMPTZ DEFAULT NOW()
```

#### `assessments` — Assessment records
```sql
id         SERIAL PRIMARY KEY
student_id INTEGER NOT NULL
course_id  INTEGER NOT NULL
title      TEXT NOT NULL
score      REAL NOT NULL
max_score  REAL DEFAULT 100
strengths  JSON DEFAULT '[]'   -- string[]
weaknesses JSON DEFAULT '[]'   -- string[]
created_at TIMESTAMPTZ DEFAULT NOW()
```

#### `activity` — Dashboard activity feed
```sql
id           SERIAL PRIMARY KEY
type         TEXT NOT NULL
description  TEXT NOT NULL
student_name TEXT NOT NULL
course_name  TEXT NOT NULL
timestamp    TIMESTAMPTZ DEFAULT NOW()
```

### Entity Relationship (Current)

```
users          (login accounts — role: admin/teacher/student/guest)

students ──────────────────────────────────────────────────────────
    │── enrolled_course_ids[] → courses.id
    │── id ─── assignments.student_id
    └── id ─── assessments.student_id

courses ────────────────────────────────────────────────────────────
    │── id ─── assignments.course_id
    │── id ─── assessments.course_id
    └── id ─── notes.course_id

NOTE: users and students are currently separate — users are login
      accounts, students are roster records. A student login account
      must be linked to a student record (Phase 2: add user_id FK).
```

---

## 6. API Contract

All authenticated routes require a valid session cookie (`connect.sid`).  
Base path: `/api`

### Authentication

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/login` | Public | Login with username + password |
| POST | `/auth/logout` | Public | Destroy session |
| GET | `/auth/me` | Session | Get current user |

### Students

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/students` | Required | List all students |
| POST | `/students` | Required | Create student |
| GET | `/students/:id` | Required | Get student |
| PATCH | `/students/:id` | Required | Update student |
| GET | `/students/:id/progress` | Required | Get progress summary |
| GET | `/students/:id/ai-suggestions` | Required | AI improvement suggestions |

### Courses

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/courses` | Required | List courses |
| POST | `/courses` | Required | Create course |
| GET | `/courses/:id` | Required | Get course |
| PATCH | `/courses/:id` | Required | Update course |
| DELETE | `/courses/:id` | Required | Delete course |

### Assignments

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/assignments` | Required | List (filter: ?studentId, ?courseId, ?status) |
| POST | `/assignments` | Required | Create assignment |
| GET | `/assignments/:id` | Required | Get assignment |
| PATCH | `/assignments/:id` | Required | Update / grade assignment |
| DELETE | `/assignments/:id` | Required | Delete assignment |

### Notes / Lessons

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/notes` | Required | List notes (?courseId) |
| POST | `/notes` | Required | Create note |
| GET | `/notes/:id` | Required | Get note |
| PATCH | `/notes/:id` | Required | Update note |
| DELETE | `/notes/:id` | Required | Delete note |

### Assessments

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/assessments` | Required | List assessments |
| POST | `/assessments` | Required | Create assessment |
| PATCH | `/assessments/:id` | Required | Update assessment |
| DELETE | `/assessments/:id` | Required | Delete assessment |

### Dashboard

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/dashboard/summary` | Required | Class stats (students, courses, avg score, at-risk) |
| GET | `/dashboard/recent-activity` | Required | Last 20 activity items |
| GET | `/dashboard/grade-breakdown` | Required | Per-course grade distribution |

### Admin / Infrastructure

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/admin/db-status` | Required | Database connection status + table counts |
| POST | `/admin/test-db` | Required | Test custom database connection |
| GET | `/downloads/upgrade` | Public | Download latest upgrade bundle (ZIP) |
| GET | `/healthz` | Public | Health check |

---

## 7. Frontend Architecture

### Routing (wouter)

```
/login              → <Login>           (public)
/                   → <Dashboard>       (protected)
/students           → <Students>        (protected)
/students/:id       → <StudentDetail>   (protected)
/students/:id/ai    → <StudentAi>       (protected)
/courses            → <Courses>         (protected)
/courses/:id        → <CourseDetail>    (protected)
/assignments        → <Assignments>     (protected)
/notes              → <Notes>           (protected)
/notes/:id          → <NoteDetail>      (protected)
/assessments        → <Assessments>     (protected)
/settings           → <Settings>        (protected)
*                   → <NotFound>
```

### Auth Flow

```
App boots
   │
   └─ AuthProvider mounts → GET /api/auth/me
              │
        ┌─────┴──────┐
        │ 200 OK     │ 401
        ▼             ▼
     setUser()    setUser(null)
        │             │
        ▼             ▼
  Protected       <Login> page
  routes render     │
                    ├─ POST /api/auth/login
                    │
                    └─ 200 → setUser() → redirect /
```

### State Management

- **Server state:** TanStack React Query with generated hooks from `@workspace/api-client-react`
- **Auth state:** React Context (`AuthProvider`) with `useAuth()` hook
- **UI state:** Local `useState` per component (no global client state library)

### UI Component Library

shadcn/ui on top of Radix UI primitives. All components in `src/components/ui/`. Key components in use:

`Card`, `Table`, `Badge`, `Dialog`, `Sheet`, `Button`, `Input`, `Select`, `Skeleton`, `Toaster`, `Sidebar`, `Chart`, `Progress`, `Avatar`

### Data Fetching Pattern

```typescript
// All API calls go through generated React Query hooks:
const { data, isLoading, error } = useGetStudents();

// Mutations:
const mutation = useCreateStudent();
mutation.mutate({ name, email, grade });
```

---

## 8. Authentication & Security

### Password Storage

Passwords are double-protected:
```
User password
    │
    ▼ bcrypt (cost factor 10) → bcrypt hash
    │
    ▼ AES-256-GCM encrypt (PASSWORD_ENCRYPTION_KEY) → stored in DB
```

Verification reverses the process: AES-256-GCM decrypt → bcrypt compare.

### Session

- Session cookies via `express-session` + `connect-pg-simple` (stored in `session` table)
- Cookie: `httpOnly: true`, `secure: false` (HTTP for on-prem IIS)
- TTL: 8 hours
- Secret: `SESSION_SECRET` env var (random 32-byte hex, generated once at install)

### Environment Variables (NSSM Service)

| Variable | Purpose |
|---|---|
| `NODE_ENV` | Must be `production` (pino-pretty crashes on Windows in dev mode) |
| `PORT` | `3001` (port 8080 is occupied by EDB PEM Apache) |
| `DATABASE_URL` | `postgresql://classmate_user:ClassmateDB2026@localhost:5432/classmate_db` |
| `PASSWORD_ENCRYPTION_KEY` | 64-char hex — AES-256-GCM key for password encryption |
| `SESSION_SECRET` | 64-char hex — express-session signing secret |

> **Critical:** Database password must contain **no special characters** (no `@`, `%`, etc.).  
> NSSM stores env vars verbatim; the bundled pg library's URL parser does not consistently  
> decode percent-encoded characters, causing silent authentication failures.

### API Authorization (Current)

All routes except `/auth/*`, `/healthz`, and `/downloads/*` require `requireAuth` middleware which checks `req.session.userId`.

**No role-based access control yet** — any authenticated user can access any endpoint.

---

## 9. Deployment Architecture (Windows IIS)

### Components

| Component | Location | Details |
|---|---|---|
| React SPA | `C:\inetpub\classmate\` | Static files served by IIS |
| Node.js API | `D:\ClassMate\Latest\...\api-dist\index.mjs` | Managed by NSSM as `ClassmateAPI` service |
| API logs | `C:\Logs\classmate-api.log` | stdout / info |
| Error logs | `C:\Logs\classmate-api-error.log` | stderr / errors |
| PostgreSQL | `localhost:5432` | PostgreSQL 18, database `classmate_db` |
| IIS | Port 80 | URL Rewrite proxies `/classmate/api/*` → `localhost:3001/api/*` |

### Upgrade Process

Running `Upgrade-Classmate.ps1` as Administrator:
1. Validates bundle integrity (checks for `api-dist/index.mjs`, `frontend/index.html`, `classmate-upgrade.sql`)
2. Runs `classmate-upgrade.sql` as postgres superuser (idempotent DDL + seed)
3. Stops `ClassmateAPI` service
4. Copies new API bundle to the service directory
5. Updates all NSSM environment variables (preserves existing `SESSION_SECRET`)
6. Copies new frontend static files to `C:\inetpub\classmate\`
7. Starts `ClassmateAPI` service

---

## 10. Completed Modules

### Module 1: Authentication System
- Session-based login / logout / session restore
- AES-256-GCM encrypted bcrypt password storage
- `requireAuth` middleware on all protected routes
- Login page with error handling
- Auth context + `useAuth()` hook in React

### Module 2: Teacher Dashboard
- Class overview stats: total students, courses, avg score, at-risk count
- Grade distribution bar chart (per course, via Recharts)
- Top performers list with links to student profiles
- Real-time activity feed (last 20 events)

### Module 3: Student Management
- Full student roster with search/sort
- Student detail page with profile, enrolled courses, assignment history
- Student progress summary (completion rate, avg score, topics mastered/needs work)
- AI improvement suggestions (OpenAI-powered) per student

### Module 4: Course Management
- Course catalog with CRUD
- Course detail page showing enrolled students and lesson notes
- Subject-level organisation

### Module 5: Assignment Tracking
- Assignment list with filters (by student, course, status)
- Status workflow: `pending → submitted → graded | late`
- Score entry and feedback
- Grade calculations

### Module 6: Lesson Notes / Library
- Lesson notes CRUD with topic tagging
- Optional video URL for replay support
- Course-scoped filtering

### Module 7: Assessments
- Assessment records with score and max score
- Strengths and weaknesses tracking (JSON arrays)
- Per-student, per-course aggregation

### Module 8: Settings Page
- DB connection status display
- Test database connection form

### Module 9: Windows Deployment Pipeline
- NSSM service configuration
- IIS Virtual Application + URL Rewrite setup
- PowerShell upgrade automation script
- Idempotent SQL upgrade script

---

## 11. Planned Modules — Phase 2

### Module 10: Role-Based Access Control (RBAC)

Four roles with distinct permissions:

| Role | Description | Permissions |
|---|---|---|
| `admin` | School administrator | User management, all teacher views, system config |
| `teacher` | Class teacher | Student roster, assignments, assessments, notes, progress reports |
| `student` | Enrolled student | Own dashboard, own subjects, own assignments |
| `guest` | Read-only observer | Read-only view of public course info |

**Implementation plan:**
- Add `requireRole(...roles)` middleware in `api-server/src/middleware/auth.ts`
- Apply role guards to each route group
- Extend `AuthUser` interface in frontend to drive conditional rendering
- Role-aware navigation (sidebar shows different links per role)

### Module 11: Admin — User Management Console

**New API routes:**
```
GET    /api/admin/users           List all users (paginated)
POST   /api/admin/users           Create user (admin, teacher, student, guest)
GET    /api/admin/users/:id       Get user detail
PATCH  /api/admin/users/:id       Update user (name, role, active status)
DELETE /api/admin/users/:id       Deactivate user (soft delete — set is_active = false)
POST   /api/admin/users/:id/reset-password   Admin-initiated password reset
```

**React pages:**
- `/admin/users` — Searchable/filterable user list table with role badges
- `/admin/users/new` — Create user form
- `/admin/users/:id` — Edit user form with role selector and deactivation toggle

### Module 12: Teacher — Student Progress Report

**New API route:**
```
GET  /api/reports/student-progress   Aggregate progress for ALL students
     Query params: ?courseId, ?grade, ?sortBy, ?order
```

**Response shape:**
```json
[{
  "studentId": 1,
  "studentName": "Jane Doe",
  "grade": "10A",
  "totalAssignments": 12,
  "completedAssignments": 10,
  "averageScore": 84.5,
  "completionRate": 0.83,
  "topicsMastered": ["Algebra", "Geometry"],
  "topicsNeedingWork": ["Calculus"],
  "riskLevel": "on-track"  // at-risk | needs-attention | on-track
}]
```

**React page:**
- `/reports/progress` — Data grid with export, sortable columns, risk-level colour coding, sparkline mini-charts

### Module 13: Student Portal

**Database change required:**
```sql
ALTER TABLE students ADD COLUMN user_id INTEGER REFERENCES users(id);
CREATE INDEX idx_students_user_id ON students(user_id);
```

**New API routes:**
```
GET  /api/student/dashboard     My enrolled subjects + recent assignment summary
GET  /api/student/subjects      My enrolled courses (with progress per course)
GET  /api/student/subjects/:id  Detail: notes, assignments, assessment scores for one course
GET  /api/student/assignments   My assignments list (?status, ?courseId)
GET  /api/student/assessments   My assessment history
```

**React pages:**
- `/student` — Subject cards grid (one card per enrolled course; shows progress bar + next due assignment)
- `/student/subjects/:id` — Subject detail: lesson notes list, assignment list, assessment scores, teacher contact

### Module 14: Unit Test Suite

| Area | Framework | Scope |
|---|---|---|
| API route handlers | Vitest + supertest | Input validation, auth guard, response shape |
| DB schema / queries | Vitest + pg test DB | Drizzle queries return correct types |
| Password utilities | Vitest | Encrypt / decrypt / verify round-trips |
| React components | Vitest + React Testing Library | Render, interactions, auth context |
| API hooks (codegen) | Vitest + msw | Mock server, hook return types |

---

## 12. RBAC Design

### Middleware Pattern (Phase 2)

```typescript
// artifacts/api-server/src/middleware/auth.ts

export const requireRole = (...roles: string[]): RequestHandler =>
  (req, res, next) => {
    if (!req.session?.userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (!roles.includes(req.session.role ?? "")) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  };
```

### Route Protection Matrix

| Route Group | Roles Allowed |
|---|---|
| `GET /students/*` | admin, teacher |
| `POST/PATCH/DELETE /students/*` | admin, teacher |
| `GET /api/student/*` | student |
| `GET /api/reports/*` | admin, teacher |
| `GET/POST/PATCH/DELETE /api/admin/users/*` | admin only |
| `GET /courses/*` | admin, teacher, student (own only) |
| `GET /assignments/*` | admin, teacher, student (own only) |
| `GET /assessments/*` | admin, teacher |
| `GET /dashboard/*` | admin, teacher |
| `GET /notes/*` | admin, teacher, student |

### Frontend Role Guard Pattern

```typescript
// React component-level guard
function AdminOnly({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (user?.role !== "admin") return <Navigate to="/" />;
  return <>{children}</>;
}

// Sidebar: navigation items filtered by role
const navByRole: Record<string, NavItem[]> = {
  admin:   [Dashboard, Users, Students, Courses, Assignments, Notes, Assessments, Reports, Settings],
  teacher: [Dashboard, Students, Courses, Assignments, Notes, Assessments, Reports],
  student: [MySubjects, MyAssignments],
  guest:   [Courses],
};
```

---

## 13. Key Design Decisions

### 1. Session-based Auth over JWT
**Decision:** Cookie sessions stored in PostgreSQL.  
**Rationale:** On-premises single-server deployment; no need for stateless tokens. Sessions are easier to invalidate (admin can deactivate a user immediately).

### 2. Double-layer Password Encryption
**Decision:** bcrypt inside AES-256-GCM, not bcrypt alone.  
**Rationale:** Even if the database is stolen, the bcrypt hashes cannot be cracked without the `PASSWORD_ENCRYPTION_KEY` which lives only in the NSSM service configuration (not in the database backup).

### 3. pnpm Workspace Monorepo
**Decision:** Single repo with `lib/db`, `lib/api-spec`, `lib/api-client-react`, `artifacts/api-server`, `artifacts/classmate`.  
**Rationale:** OpenAPI contract-first approach — the spec lives in `lib/api-spec`, codegen produces typed React Query hooks in `lib/api-client-react`, server validates with Zod schemas from `lib/api-zod`. One change to the spec propagates to both client and server types.

### 4. No Special Characters in DB Password (NSSM Constraint)
**Decision:** `classmate_user` password set to `ClassmateDB2026` (alphanumeric only).  
**Rationale:** NSSM stores `AppEnvironmentExtra` verbatim in the Windows registry. The bundled Node.js pg library does not consistently decode percent-encoded characters (e.g. `%40` for `@`) in the DATABASE_URL when parsed at runtime, causing silent SCRAM-SHA-256 authentication failures that surface as Drizzle "Failed query" errors with no obvious root cause.

### 5. students vs. users Are Separate Entities (Phase 1)
**Decision:** `users` table is for login accounts; `students` table is the academic roster.  
**Rationale:** Teachers need to create student roster records before (or without) those students having login access. A student record can exist without a login, and an admin or teacher login has no student record. Phase 2 will add a nullable `user_id` FK on `students` to link the two when student self-service portal is needed.

### 6. Drizzle ORM over Raw SQL / Prisma
**Decision:** Drizzle ORM with `drizzle-zod` for schema-to-Zod bridge.  
**Rationale:** Lightweight, no separate Prisma binary, TypeScript-native query builder, and `drizzle-zod` generates Zod schemas directly from the table definitions — keeping DB schema and API validation schemas in sync.

---

*Document maintained in `ARCHITECTURE.md` at the repository root. Update after each sprint.*
