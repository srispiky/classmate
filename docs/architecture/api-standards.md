# API Standards

Classmate Connect — REST API

---

## General Principles

- The API is contract-first: the OpenAPI specification (`lib/api-spec/`) is the source
  of truth. Client hooks and Zod schemas are generated from it via Orval.
- All endpoints return JSON.
- All request bodies are validated with Zod before any business logic executes.
- Routes never contain business logic or authorization decisions.

---

## URL Structure

All API routes are served under the `/api` prefix (enforced by the reverse proxy).

Pattern: `/api/{resource}` and `/api/{resource}/{id}`

```
GET    /api/courses              List all accessible courses
POST   /api/courses              Create a new course
GET    /api/courses/:id          Get a specific course
PUT    /api/courses/:id          Replace a course
DELETE /api/courses/:id          Soft-delete a course

GET    /api/students             List all accessible students
GET    /api/students/:id         Get a specific student

GET    /api/assignments          List accessible assignments
POST   /api/assignments          Create an assignment
PUT    /api/assignments/:id      Update an assignment
DELETE /api/assignments/:id      Soft-delete an assignment

GET    /api/assessments          List accessible assessments
POST   /api/assessments          Create an assessment

GET    /api/notes                List accessible notes
POST   /api/notes                Create a note

GET    /api/dashboard/summary
GET    /api/dashboard/recent-activity
GET    /api/dashboard/grade-breakdown

GET    /api/health               Health check (unauthenticated)
```

---

## HTTP Methods

| Method | Semantics |
|---|---|
| `GET` | Read only. No side effects. |
| `POST` | Create a new resource. Returns `201 Created`. |
| `PUT` | Full or partial update of an existing resource. Returns `200 OK`. |
| `DELETE` | Soft-delete (sets `deleted_at`). Returns `204 No Content`. |

---

## Request Validation

All request bodies and route parameters are validated with Zod.

```ts
// Body validation
const parsed = createCourseInputSchema.safeParse(req.body);
if (!parsed.success) {
  res.status(400).json({ error: parsed.error.message });
  return;
}

// Route parameter validation
const params = GetCourseParams.safeParse(req.params);
if (!params.success) {
  res.status(400).json({ error: params.error.message });
  return;
}
```

Use `.safeParse()` — never `.parse()` — in route handlers.

---

## Response Shapes

### Success responses

Serialization functions (`serialize*`) map DB rows to plain JSON objects.
All `Date` values are serialized to ISO 8601 strings.

```ts
function serializeCourse(c: CourseRow) {
  return {
    id: c.id,
    name: c.name,
    createdAt: c.createdAt.toISOString(),
    // ...
  };
}
```

### Error responses

All error responses follow a consistent shape:

```json
{ "error": "Human-readable message" }
```

Authorization denial (IDOR / ownership failure):

```json
{
  "code": "OWNERSHIP_DENIED",
  "resourceType": "course",
  "resourceId": 42
}
```

Use `ownershipDenied(resourceType, id)` from `lib/query-contracts.ts` to build this payload.

---

## HTTP Status Codes

| Code | When to use |
|---|---|
| `200 OK` | Successful GET or PUT |
| `201 Created` | Successful POST (resource created) |
| `204 No Content` | Successful DELETE |
| `400 Bad Request` | Validation failure (Zod parse error) |
| `401 Unauthorized` | Not authenticated |
| `403 Forbidden` | Authenticated but not authorized (ownership denied) |
| `404 Not Found` | Resource does not exist or is soft-deleted |
| `500 Internal Server Error` | Unhandled exception |

Do not return `404` to mask an authorization failure — use `403` with `OWNERSHIP_DENIED`
for resources that exist but are outside the requester's scope (IDOR prevention).

---

## Authentication

All routes except `/api/health` and `/api/auth/*` require an authenticated session.
Authentication is enforced by the `requireAuth` middleware before any route handler runs.

---

## OpenAPI Spec and Codegen

The OpenAPI spec lives in `lib/api-spec/openapi.yaml`. After editing the spec:

```sh
pnpm --filter @workspace/api-spec run codegen
```

This regenerates:

- `lib/api-zod/src/generated/api.ts` — Zod schemas for request/response validation
- `lib/api-client-react/src/generated/` — React Query hooks for the frontend

Do not hand-edit generated files. After codegen, `lib/api-zod/src/index.ts` is
automatically overwritten to export only from `./generated/api` (avoids name conflicts).

The spec must be kept in sync with the implementation. Stale generated schemas are a
documented deviation in the current audit report.

---

## Pagination

All list endpoints accept `limit` and `offset` query parameters (defaults: `limit=20`, `offset=0`).
Pagination is applied after scope filters — never before.

```ts
const DEFAULT_PAGE: PageOptions = { limit: 20, offset: 0 };
```

---

## Filtering

Resource-specific filters are defined per-resource in `*Filters` interfaces in each
`*.queries.ts` file. Filters are applied as additional WHERE conditions after the
scope condition and before the soft-delete guard.
