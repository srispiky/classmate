# Coding Standards

Classmate Connect — TypeScript / Node.js

---

## Language and Runtime

| Setting | Value |
|---|---|
| Runtime | Node.js 24 |
| Language | TypeScript 5.9 (strict mode) |
| Module format | CommonJS (esbuild bundle for API server) |
| Package manager | pnpm workspaces |

---

## TypeScript Naming Conventions

### Classes

Use PascalCase. Names must express role and responsibility.

```ts
// Correct
class CourseService {}
class CourseRepository {}
class CourseScopePolicy {}
class TeacherScopeValidator {}
class SessionEnricherService {}

// Incorrect
class courseManager {}
class CourseCreation {}
class handleCourses {}
```

### Methods

Use verbs. Be explicit about what the method does.

```ts
// Correct
createCourse()
updateCourse()
getById()
listCourses()
softDelete()
validateAccess()
enrichTeacher()
buildScopeContext()

// Incorrect
courseManager()
courseCreation()
processData()
handle()
```

### Variables and Properties

Use camelCase.

```ts
// Correct
courseId
studentId
teacherId
createdAt
updatedAt
deletedAt
ownedCourseIds
enrolledCourseIds

// Incorrect
course_id
CourseId
COURSE_ID
```

### Constants

Use SCREAMING_SNAKE_CASE for module-level primitive constants. Use PascalCase for
readonly arrays used as enum-like values.

```ts
// Primitive constant
const MAX_COURSE_NAME_LENGTH = 120;

// Enum-like array
const COURSE_STATUS = ["active", "archived"] as const;
```

### Interfaces and Types

Use PascalCase. Interfaces do not require an `I` prefix.

```ts
// Correct
interface ScopeContext { ... }
interface CourseFilters { ... }
interface CourseLike { ... }
type CourseStatus = "active" | "archived";

// Incorrect
interface ICourseContext { ... }
type courseStatus = string;
```

---

## File Naming

Use kebab-case for all source files.

```
course-scope-policy.ts
teacher-scope-validator.ts
scope-context.ts
scope-filter.ts
courses.queries.ts
session-enricher.ts
query-contracts.ts
```

Test files mirror their subject with a `.test.ts` suffix.

```
courses.queries.test.ts
course-scope-policy.test.ts
```

---

## Layer Responsibilities

### Controllers (Routes)

Allowed:

- Request parsing and validation (Zod `safeParse`)
- Calling service or query functions
- Mapping results to HTTP responses (serialization, status codes)

Prohibited:

- Business logic
- Authorization decisions (`if (scope.role === ...)`)
- Direct database access

### Repositories / Query Builders

Allowed:

- Database access via Drizzle ORM
- Building WHERE conditions from ScopeContext (pure condition arrays)

Prohibited:

- Business rules
- Authorization decisions
- Session access

### Services (where present)

Allowed:

- Business logic and orchestration
- Calling repositories
- Throwing domain errors

Prohibited:

- HTTP-specific concerns (`req`, `res`, status codes)
- Authorization decisions

### Policies

Allowed:

- Authorization decisions only (Layer 2 scope conditions, Layer 3 access validation)
- Delegating to validators and scope helpers

Prohibited:

- Business logic
- Database access
- HTTP concerns

### Validators

Allowed:

- Scope and ownership decisions
- Helper functions for policies

Prohibited:

- Business logic
- Database access

---

## Error Handling

Throw typed errors in domain and authorization code. Catch only `PolicyAuthorizationError`
subclasses in route handlers for 403 responses. Let unexpected errors propagate to the
global Express error handler.

```ts
// In a route handler
try {
  coursePolicy.validateAccess(scope, course);
} catch (err) {
  if (err instanceof PolicyAuthorizationError) {
    res.status(403).json(ownershipDenied("course", id));
    return;
  }
  throw err; // propagate unexpected errors
}
```

---

## Logging

Never use `console.log` in server code.

Use `req.log` inside route handlers. Use the module-level `logger` singleton for
non-request code (services, enrichers, startup).

---

## Imports

Group imports in this order, separated by blank lines:

1. Node.js built-ins
2. Third-party packages
3. Workspace packages (`@workspace/*`)
4. Local imports (relative paths)

---

## Drizzle ORM Conventions

- Always access the database through the `db` singleton from `@workspace/db`.
- Never use raw SQL strings unless a drizzle expression cannot express the query.
- Table variables follow the `Table` suffix convention: `coursesTable`, `studentsTable`.
  Exception: the `users` table export predates this convention (documented deviation).
- Extract WHERE conditions into separate `build*Conditions` functions for testability.
- The `build*Conditions` functions must be pure (no DB calls) and exported for unit testing.

---

## Zod Validation

- Use `zod/v4` (imported as `z`).
- Always call `.safeParse()` in route handlers — never `.parse()` — so validation errors
  produce 400 responses rather than unhandled exceptions.
- Define field-level schemas in the schema file and compose them into insert/update schemas.
- Use `drizzle-zod`'s `createInsertSchema` / `createSelectSchema` as the starting point;
  override fields that require additional validation.
