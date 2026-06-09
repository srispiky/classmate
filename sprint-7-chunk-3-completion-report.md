# Sprint 7 Chunk 3 — Completion Report
**Assessment Management + Missing PATCH Endpoint**
_Completed: June 9, 2026_

---

## Objective

Make Assessment Management fully usable for teachers, and fix the write-once gap: assessments had no PATCH endpoint, making score corrections and qualitative updates impossible after creation.

---

## Backend Files Modified

| File | Change |
|---|---|
| `artifacts/api-server/src/routes/assessments.ts` | Added `PATCH /assessments/:id` handler (L1/L2/L3 security chain, audit fields) |

---

## OpenAPI Changes

| Location | Change |
|---|---|
| `lib/api-spec/openapi.yaml` | Added `PATCH /assessments/{id}` operation (`operationId: updateAssessment`) |
| `lib/api-spec/openapi.yaml` | Added `AssessmentUpdate` schema to `components/schemas` |

### `AssessmentUpdate` schema

All fields optional (PATCH semantics):
- `title` — string, minLength: 1
- `score` — number
- `maxScore` — number
- `strengths` — string array
- `weaknesses` — string array

**Ownership transfer is not allowed** — `studentId` and `courseId` are excluded from the update body by design.

---

## Generated Hooks Added

| Symbol | Package | Use |
|---|---|---|
| `useUpdateAssessment` | `@workspace/api-client-react` | React Query mutation hook for PATCH |
| `UpdateAssessmentBody` | `@workspace/api-zod` | Server-side request body validator |
| `UpdateAssessmentParams` | `@workspace/api-zod` | Path param validator (`id` → integer) |
| `UpdateAssessmentResponse` | `@workspace/api-zod` | Response shape validator |

---

## PATCH /assessments/:id — Security Chain

| Layer | What it does |
|---|---|
| L1 `requireRole("admin", "teacher")` | Blocks students, parents, and guests at the middleware level before any business logic |
| Soft-delete guard | `getAssessmentById()` filters `isNull(deletedAt)` — deleted assessments return null → 404 |
| L3 `assessmentPolicy.validateAccess()` | Teacher can only update assessments in courses they own; admin has unrestricted access |
| Audit fields | `updatedAt: new Date(), updatedBy: scope.userId` are always set by the route, never from user input |

---

## Frontend Files Modified

| File | Change |
|---|---|
| `artifacts/classmate/src/pages/assessments/index.tsx` | **Full rewrite** — Create / Edit / Delete CRUD, card navigation, hover-reveal action buttons |
| `artifacts/classmate/src/pages/assessments/detail.tsx` | **New file** — Assessment detail page with Edit dialog and Delete confirmation |
| `artifacts/classmate/src/App.tsx` | Added `/assessments/:id` route + `AssessmentDetail` import |

---

## Assessment List Page (`/assessments`) — What Changed

**Previous state:** Read-only grid of assessment cards, search filter only.

**Now includes:**
- **Create Assessment button** (header, role-gated to admin/teacher)
- **Create Assessment dialog** — Course select → Student select (enrolled, with fallback to all students if enrollment data is stale) → Title → Score / Max Score → Strengths (textarea, one per line) → Areas to Improve (textarea, one per line)
- **Card click navigation** — clicking a card navigates to `/assessments/:id`
- **Hover-reveal action icons** — pencil (Edit) and trash (Delete) appear on card hover; both stop card-level click propagation
- **Edit dialog** — same form as create but pre-populated; uses PATCH; immediately patches list cache via `setQueryData`
- **Delete AlertDialog** — confirmation with assessment title and student name; removes from list cache via `setQueryData`
- **Improved empty state** — context-aware message + Create CTA

### Student Dropdown Resilience

The create dialog filters students by `enrolledCourseIds` to only show students in the selected course. When `enrolledCourseIds` is empty (stale JSON column, known Sprint 7 Ch.1 finding), it automatically falls back to showing all students rather than an empty dropdown.

---

## Assessment Detail Page (`/assessments/:id`) — New

- **Header** — title, date completed, Edit button, Delete button
- **Stat cards** — Student, Course, Score (`score/maxScore`), Percentage (colour-coded: green ≥90%, blue ≥75%, amber ≥60%, red <60%)
- **Strengths card** — full list with green left-border items
- **Areas to Improve card** — full list with orange left-border items
- **Edit dialog** — pre-populated; updates both detail cache (`getGetAssessmentQueryKey`) and list cache (`getListAssessmentsQueryKey`) on success
- **Delete AlertDialog** — on confirm: removes from list cache, navigates to `/assessments`
- **Loading skeleton** and **404 error state** with back button

---

## Validation

| Rule | Surface |
|---|---|
| Title required | Create + Edit dialogs |
| Course required | Create dialog |
| Student required | Create dialog |
| Score required and numeric | Create + Edit dialogs |
| Max score ≥ 1 | Create + Edit dialogs |
| Score in `[0, maxScore]` | Create + Edit dialogs |
| Server errors | Displayed inline in the active dialog |

---

## Cache Strategy

| Operation | Strategy |
|---|---|
| Create assessment | `invalidateQueries` — server-authoritative list refresh |
| Edit from list | `setQueryData` on list key — immediate in-place update |
| Edit from detail | `setQueryData` on both detail key and list key |
| Delete from list | `setQueryData` — filter removed item from list cache |
| Delete from detail | `setQueryData` on list key + navigate to `/assessments` |

---

## Tests Added

### Backend — `patch-assessment-auth.test.ts` (28 tests)

| Suite | Tests |
|---|---|
| L1/L3 role enforcement | admin allow, teacher-owns allow, teacher-no-match deny, teacher-no-courses deny, student deny, parent deny, guest deny |
| L3 IDOR prevention | Teacher A cannot access Teacher B's course; Teacher B can access own course; admin unrestricted |
| Soft-delete protection (structural) | `isNull(deletedAt)` last condition for all 6 role variants |
| `UpdateAssessmentBody` validation | empty object accepted, partial update accepted, full update accepted, empty title rejected, score as string rejected, strengths non-array rejected, weaknesses non-array rejected |
| `UpdateAssessmentParams` validation | coerces string id, rejects non-numeric id, rejects missing id |
| Audit field injection prevention | `updatedAt` stripped from body schema, audit fields not required |

### Frontend — `assessments.test.tsx` (29 tests)

**List Page (20 tests)**

| Test | Result |
|---|---|
| Renders page title, Create button, assessment cards | ✅ |
| Shows percentage and score | ✅ |
| Shows strengths and weaknesses | ✅ |
| Filters by search term | ✅ |
| Opens create dialog | ✅ |
| Validation: empty submit | ✅ |
| Validation: course not selected | ✅ |
| Calls `useCreateAssessment` with correct payload | ✅ |
| Invalidates list query on create success | ✅ |
| Shows inline error on create failure | ✅ |
| Filters students by course in create dialog | ✅ |
| Opens edit dialog on pencil click | ✅ |
| Pre-populates edit dialog values | ✅ |
| Calls `useUpdateAssessment` with correct payload | ✅ |
| Updates list cache on edit success | ✅ |
| Validation: empty title in edit | ✅ |
| Opens delete confirmation on trash click | ✅ |
| Calls `useDeleteAssessment` when confirmed | ✅ |
| Removes from list cache on delete success | ✅ |

**Detail Page (9 tests)**

| Test | Result |
|---|---|
| Renders title, student, course, score, percentage | ✅ |
| Renders strengths and weaknesses sections | ✅ |
| Renders Edit and Delete buttons | ✅ |
| Opens edit dialog pre-populated on Edit click | ✅ |
| Calls `useUpdateAssessment` with correct payload | ✅ |
| Updates both detail and list cache on edit success | ✅ |
| Blocks edit submit when title cleared | ✅ |
| Opens delete confirmation on Delete click | ✅ |
| Calls `useDeleteAssessment` when confirmed | ✅ |
| Removes from list cache on delete success | ✅ |

**Total test counts after Chunk 3:**
- Frontend: **84/84** (23 courses + 32 assignments + 29 assessments)
- Backend: **1403/1403** (all pre-existing + 28 new PATCH assessment auth tests)

---

## Workflow Verification (E2E — Playwright)

All steps executed against the live app as `admin`:

1. **Create validation** — empty submit showed "Title is required" ✅
2. **Create assessment** — "Final Exam Assessment" created with course/student/score/strengths/areas; list updated ✅
3. **Assessment detail** — navigated to `/assessments/:id`; title, student, course, score, percentage, strengths, areas, Edit/Delete visible ✅
4. **Edit from detail** — score changed to 92; dialog closed; updated score/percentage visible ✅
5. **Delete from list** — trash icon opened AlertDialog; confirmed; toast + removal from list ✅
6. **Edit from list** — pencil icon opened edit dialog; added "Time management" to Strengths; saved; list updated ✅
7. **Edit validation** — cleared title, clicked Save, "Title is required" inline error appeared, no mutation ✅

---

## Risks

- **`enrolledCourseIds` JSON column** — The student filter in the create dialog now falls back to all students when the enrollment data is stale. This is the correct resilience behaviour given the known Sprint 7 Ch.1 finding that `course_enrollments` writes don't update the JSON column.
- **Score range validation is client-only** — The PATCH endpoint accepts `score > maxScore` because the `AssessmentUpdate` Zod schema has no cross-field constraint. Client-side validation enforces `score ≤ maxScore` but a direct API call can bypass this. A future migration could add a DB-level check constraint or add Zod `.refine()` to the server schema.
- **No `feedback` / `notes` field** — The assessments table has no feedback column. The spec intentionally omits it. If free-form teacher notes per assessment are needed, a schema migration is required.

---

## Remaining Teacher Portal Gaps

| Chunk | Feature |
|---|---|
| Chunk 4 | Notes / Lesson Library CRUD — create, edit, delete notes; video URL support |
| Chunk 5 | Announcements module — create/view/delete announcements per course |
| Chunk 6 | Dashboard scoping — filter stats and activity feed to teacher's own courses |
