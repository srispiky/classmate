# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## Classmate App

AI-powered educational platform for tracking student progress, assignments, and providing AI improvement suggestions.

### Features
- **Dashboard** — class overview with stats, grade distribution charts, top performers, and activity feed
- **Students** — manage students, view individual progress, assignments, and assessments
- **Courses** — manage courses, enrolled students, lesson notes
- **Assignments** — track and grade assignments with status filters
- **Notes/Lessons** — lesson library with video replay support
- **Assessments** — record assessment scores with strengths/weaknesses tracking
- **AI Suggestions** — AI-powered improvement recommendations per student based on assessment data

### Database Schema (lib/db/src/schema/)
- `students` — student profiles with grade and enrolled course IDs
- `courses` — course catalog with teacher info
- `assignments` — student assignments with status tracking and grading
- `notes` — lesson notes/topics with optional video URLs
- `assessments` — assessment records with strengths/weaknesses arrays
- `activity` — activity log for the dashboard feed

### API Routes (artifacts/api-server/src/routes/)
- `/api/students` — CRUD + progress summary
- `/api/courses` — CRUD
- `/api/assignments` — CRUD with filters by student/course
- `/api/notes` — CRUD lesson notes
- `/api/assessments` — CRUD + AI suggestions
- `/api/students/:id/ai-suggestions` — AI improvement suggestions for a student
- `/api/dashboard/summary|recent-activity|grade-breakdown` — dashboard aggregations

### Codegen Note
After codegen, the `lib/api-zod/src/index.ts` is overwritten to only export from `./generated/api` to avoid name conflicts with the types barrel. This is handled automatically in the codegen script.
