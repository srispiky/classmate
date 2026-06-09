# Sprint 7 Chunk 2 — Completion Report
**Assignment Management + Grading Workflow**
_Completed: June 9, 2026_

---

## Objective

Make Assignment Management fully usable for teachers: full CRUD, a dedicated detail page, and a grading workflow that lets teachers score and provide feedback on student submissions.

---

## Files Modified

| File | Change |
|---|---|
| `artifacts/classmate/src/pages/assignments/index.tsx` | Full rewrite — Create/Grade/Delete CRUD, card navigation, list cache updates |
| `artifacts/classmate/src/pages/assignments/detail.tsx` | **New file** — Assignment detail page with grade dialog and delete |
| `artifacts/classmate/src/App.tsx` | Added `/assignments/:id` route + `AssignmentDetail` import |
| `artifacts/classmate/src/tests/assignments.test.tsx` | **New file** — 32 unit tests across both pages |

---

## Components Added

### Assignment List Page (`/assignments`) — Rewritten

**Previous state:** Read-only list with search and status filter. No CRUD actions. No navigation to detail.

**Now includes:**
- **Create Assignment button** (header, role-gated to admin/teacher)
- **Create Assignment dialog** with full field set and validation
- **Card click navigation** — clicking title or chevron navigates to `/assignments/:id`
- **Grade button** — appears on `submitted`/`late` cards as an amber "Needs Grading"-style button; star icon on all cards on hover
- **Inline grade dialog** — usable directly from the list without navigating to detail
- **Delete button** — trash icon per card, hover-revealed, triggers AlertDialog confirmation
- **Improved empty state** — context-aware messaging + "Create Assignment" CTA when no assignments exist

### Assignment Detail Page (`/assignments/:id`) — New

- **Header** with assignment title, status badge, "Needs Grading" indicator, Grade button, Delete button
- **Info grid** — Student, Course, Due Date, Score (4-up stat cards)
- **Description card** — whitespace-preserved text
- **Feedback card** — conditionally rendered only when feedback exists
- **Needs-grading prompt card** — amber highlight with "Grade Now" CTA, only shown for unscored submitted/late assignments
- **Grade/Update dialog** — status select, score input (required when graded), optional feedback textarea
- **Delete AlertDialog** — confirmation with assignment title; navigates to `/assignments` on success
- **Loading skeleton** and **404 error state**

---

## Routes Added

| Route | Component |
|---|---|
| `/assignments/:id` | `AssignmentDetail` |

---

## Hooks Used

| Hook | Used in | Purpose |
|---|---|---|
| `useListAssignments` | index | Fetch all assignments |
| `useGetAssignment(id)` | detail | Fetch single assignment |
| `useCreateAssignment` | index | Create new assignment |
| `useUpdateAssignment` | index, detail | Grade / update status+score+feedback |
| `useDeleteAssignment` | index, detail | Soft-delete assignment |
| `useListCourses` | index | Populate course dropdown in create dialog |
| `useListStudents` | index | Populate student dropdown (filtered by course) |
| `useGetMe` | index | Role-gate the Create Assignment button |
| `getListAssignmentsQueryKey` | index, detail | Cache invalidation and `setQueryData` |
| `getGetAssignmentQueryKey` | detail | Update detail page cache after grade |

---

## Create Assignment Dialog

**Fields:**
- Title (text, required)
- Description (textarea, required)
- Course (select from active courses, required)
- Student (select, dynamically filtered to only students enrolled in the selected course, required)
- Due Date (date input, required)
- Max Score (number, required, must be positive)

**Validation:** All checks run client-side before calling the mutation. Error appears inline, no API call is made for invalid forms.

**Post-create:** `invalidateQueries({ queryKey: getListAssignmentsQueryKey() })` — server-authoritative refresh.

---

## Grade / Update Dialog

**Fields:**
- Status (`pending` | `submitted` | `graded` | `late`)
- Score (required when status = `graded`; must be 0–maxScore; optional otherwise)
- Feedback (optional textarea)

**Validation:**
- Score required when marking as graded
- Score must be a valid number within [0, maxScore]

**Post-grade cache strategy:**
- **From list page:** `setQueryData(getListAssignmentsQueryKey(), ...)` — patches the assignment in-place with the returned data object
- **From detail page:** `setQueryData(getGetAssignmentQueryKey(id), data)` patches the detail cache; `setQueryData(getListAssignmentsQueryKey(), ...)` patches the list cache

---

## Delete Assignment

**From list page:**
- Trash icon on card → AlertDialog
- On confirm: `setQueryData(getListAssignmentsQueryKey(), old => old.filter(a => a.id !== id))` — immediate removal from list

**From detail page:**
- Delete button in header → AlertDialog
- On confirm: removes from list cache, navigates to `/assignments`, shows toast

---

## Authorization Handling

| HTTP Status | Surface |
|---|---|
| 403/404 on `useGetAssignment` | Detail page renders an error state with a back button |
| 409 on enrollment conflicts | Not applicable to assignments (no duplicate guard) |
| Validation errors (400) | Server message displayed inline in the active dialog |
| Any mutation error | Toast (from list delete) or inline dialog error (create/grade) |

---

## Query Management

| Operation | Strategy |
|---|---|
| Create assignment | `invalidateQueries` (server refetch for accurate list ordering) |
| Grade from list | `setQueryData` on list key (immediate, no round-trip) |
| Grade from detail | `setQueryData` on both detail and list keys |
| Delete from list | `setQueryData` — filter removed item from list cache |
| Delete from detail | `setQueryData` on list key + navigate away |

---

## Tests Added

**File:** `artifacts/classmate/src/tests/assignments.test.tsx`
**Result: 32/32 tests pass** (combined with courses: 55/55 total)

### Assignment List Page (18 tests)

| Test | Result |
|---|---|
| Renders page title and Create Assignment button | ✅ |
| Renders all assignment cards with title, student, course | ✅ |
| Shows Grade button for submitted assignment | ✅ |
| Shows score for a graded assignment | ✅ |
| Filters by search term | ✅ |
| Filters by status | ✅ |
| Opens create dialog on button click | ✅ |
| Validation blocks empty form submission | ✅ |
| Calls `useCreateAssignment` with correct payload | ✅ |
| Invalidates assignment list query on create success | ✅ |
| Shows inline error message on create failure | ✅ |
| Filters students by selected course in create dialog | ✅ |
| Opens grade dialog on Grade button click | ✅ |
| Calls `useUpdateAssignment` with correct payload | ✅ |
| Validation blocks missing score for graded status | ✅ |
| Updates list cache on grade success (`setQueryData`) | ✅ |
| Opens delete confirmation on trash click | ✅ |
| Calls `useDeleteAssignment` when confirmed | ✅ |
| Removes from list cache on delete success | ✅ |

### Assignment Detail Page (13 tests)

| Test | Result |
|---|---|
| Renders title, status, student, course | ✅ |
| Renders Grade and Delete buttons in header | ✅ |
| Shows Needs Grading prompt for submitted assignment | ✅ |
| Opens grade dialog on Grade button click | ✅ |
| Pre-populates grade dialog with current status | ✅ |
| Calls `useUpdateAssignment` with correct payload | ✅ |
| Updates both detail and list cache on grade success | ✅ |
| Blocks grade submit when score missing for graded status | ✅ |
| Opens delete confirmation on Delete click | ✅ |
| Calls `useDeleteAssignment` when confirmed | ✅ |
| Removes from list cache on delete success | ✅ |
| Shows description in detail card | ✅ |
| Shows feedback card label when assignment has description | ✅ |

---

## Workflow Verification (E2E — Playwright)

All steps executed against the live app as `admin`:

1. **Create assignment** — "Midterm Essay" created with all required fields; dialog closed, success toast shown ✅
2. **Open assignment detail** — navigated to `/assignments/:id`; title, student, course, due date, description, Grade/Delete buttons visible ✅
3. **Grade assignment** — Grade dialog opened; validation blocked empty score when status=graded; entered score 87 + feedback; dialog closed, status updated to "graded" with score shown as `87/100` ✅
4. **Verify graded status in list** — navigated back, graded badge and score visible ✅
5. **Delete assignment** — trash icon opened confirmation dialog; "Delete Assignment" confirmed; toast appeared, assignment removed from list ✅
6. **Grade from list** — star icon opened grade dialog; "Submitted" status + score 88 saved; list updated to show `88/100` ✅

---

## Risks

- **`UpdateAssignmentBody` is narrow** — only `status`, `score`, `feedback` can be changed after creation. There is no endpoint to edit title, description, courseId, studentId, dueDate, or maxScore. If teachers need to correct a typo in a title, they must delete and recreate. This is a backend contract limitation, not a frontend gap.
- **`dueDate` format** — the create dialog submits `YYYY-MM-DDT00:00:00.000Z`. If the backend expects a different timezone-aware format, dates may appear off by one day in certain locales.
- **Student enrollment filter in create dialog** — relies on `enrolledCourseIds` JSON column on students, which (per Chunk 1 findings) is not automatically updated by the enrollment API. If a student was enrolled after the last full page refresh, they may not appear in the create dialog dropdown until `useListStudents` refetches.

---

## Remaining Teacher Portal Gaps

After Chunk 2, the following Sprint 7 items remain:

| Chunk | Feature |
|---|---|
| Chunk 3 | Assessment CRUD — create, edit, delete assessments with strengths/weaknesses |
| Chunk 4 | Notes / Lesson Library CRUD — create/edit/delete notes, video URL support |
| Chunk 5 | Announcements module — create/view/delete announcements per course |
| Chunk 6 | Dashboard scoping — filter dashboard stats and activity feed to teacher's own courses |
| Chunk 7–10 | AI suggestions, advanced enrollment UI, student progress, reporting |

The assignment and course CRUD modules are now complete.
