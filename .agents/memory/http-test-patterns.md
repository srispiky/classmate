---
name: HTTP integration test patterns
description: supertest setup, rate-limiter skip for tests, courses GET auth gap, session reuse across tests
---

## Rate limiter — skip in test mode

`routes/auth.ts` loginRateLimiter has `skip: () => process.env.NODE_ENV === "test"`. Vitest sets NODE_ENV=test automatically. Without this, running 4 HTTP test files in the same worker hits the 10-req/15min limit for `POST /api/auth/login`.

**Why:** All HTTP integration test files make multiple `loginAs()` calls (creates a supertest agent + does one POST /auth/login). The in-memory rate-limiter state is per-app-instance. When vitest runs with `--poolOptions.forks.singleFork=true` (single fork mode, required to avoid timeout), all files share the same app module and thus the same rate-limiter instance.

**How to apply:** Keep `skip: () => process.env.NODE_ENV === "test"` in the rate limiter. Never remove it without adjusting the HTTP tests.

## Finding F1 — GET /api/courses has no requireRole

`GET /api/courses` and `GET /api/courses/:id` have no `requireRole` guard. Any authenticated user (including students) can read the full course catalog. Only mutation endpoints (POST, PUT, DELETE) are guarded with `requireRole("admin", "teacher")`. Documented in `http-authorization.test.ts` under "FINDING F1" describe block.

**Why:** Discovered via HTTP integration tests in Sprint 9 Chunk 4. Not fixed (testing-only sprint).

## supertest agent pattern for session reuse

Use `supertest.agent(app)` in `beforeAll` and reuse the agent across tests in the same file. The agent carries the `connect.sid` cookie automatically. Use `ReturnType<typeof supertest.agent>` for the TypeScript type — importing from `supertest/lib/agent` fails without `esModuleInterop`.

## vitest single-fork mode

Run `npx vitest run --pool=forks --poolOptions.forks.singleFork=true` when the default parallel mode times out (e.g. full suite with 53 files + HTTP tests). Without singleFork, vitest may exceed the 120s timeout for this project.
