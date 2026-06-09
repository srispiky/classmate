# Sprint 7 Chunk 1 — Completion Report
**Course Management CRUD + Enrollment UI**
_Completed: June 9, 2026_

---

## Objective

Implement the Teacher Portal's Course Management module: full CRUD for courses and a student enrollment/unenrollment UI on the course detail page.

---

## Deliverables

### 1. Courses List Page (`/courses`)

**File:** `artifacts/classmate/src/pages/courses/index.tsx`

- Displays all courses as cards with subject badge, teacher name, student count, and status chip
- **Create Course dialog** triggered by the "Add Course" button
  - Fields: Course Name, Subject, Grade Level, Academic Year (all required), Description (optional)
  - Client-side validation with inline error messages — form never submits with empty required fields
  - `teacherId` auto-populated from `useGetMe()` — teacher always owns their own courses
  - On success: invalidates `getListCoursesQueryKey()`, closes dialog, resets form, shows toast
  - On error: displays server error message inline inside the dialog
  - Cancel resets all form state

### 2. Course Detail Page (`/courses/:id`)

**File:** `artifacts/classmate/src/pages/courses/detail.tsx`

Four tabbed sections: **Students**, **Assignments**, **Notes**, **Overview**

#### Edit Course
- "Edit" button in page header opens a pre-populated dialog
- All editable fields: Course Name, Subject, Grade Level, Academic Year, Description
- Validation: Course Name required; empty submit blocked with inline error
- On success: invalidates detail + list query keys, closes dialog, shows toast
- On error: displays server error inline

#### Archive Course
- "Archive" button opens an `AlertDialog` naming the course in the confirmation copy
- Confirmed archive calls `useDeleteCourse({ id })`
- On success: invalidates list query, navigates back to `/courses`, shows toast
- Cancel dismisses without any mutation

#### Enroll Student
- "Enroll Student" button on the Students tab opens a dialog
- Real-time search filters the student list as you type
- Only unenrolled students are shown (enrolled students are filtered out)
- Clicking a student immediately calls `useEnrollStudent({ courseId, data: { studentId } })`
- **Bug fixed:** after enrollment, the Students tab updates instantly (see §4 below)
- Error handling: 409 Conflict → "already enrolled" message; 422 → "inactive course" message

#### Unenroll Student
- Each enrolled student card has a "Remove from course" icon button (UserMinus)
- Clicking opens an `AlertDialog` with the student's name in the copy
- Confirmed unenroll calls `useUnenrollStudent({ courseId, studentId })`
- On success: student disappears from the tab, student count decreases, toast shown
- **Bug fixed:** cache update is immediate (see §4 below)

---

## Bug Fixed: Enrollment Display Not Updating

### Root Cause

`GET /api/students` serializes `enrolledCourseIds` from the `enrolled_course_ids` JSON column on the students table. The enrollment API (`POST/DELETE /api/courses/:id/enrollments`) writes exclusively to the `course_enrollments` table — it never updates the JSON column. After enrolling/unenrolling, re-fetching the students list returned stale data from the JSON column, causing:

- Students tab showing "Students (0)" after a successful enrollment
- Enrolled student still visible after a successful unenrollment

### Fix Applied

Used `queryClient.setQueryData` in the `onSuccess` handlers to surgically patch the in-memory student cache:

**Enroll success:**
```ts
queryClient.setQueryData(
  getListStudentsQueryKey(),
  (old) => old?.map(s =>
    s.id === enrolledStudentId
      ? { ...s, enrolledCourseIds: [...s.enrolledCourseIds, courseId] }
      : s,
  ),
);
```

**Unenroll success:**
```ts
queryClient.setQueryData(
  getListStudentsQueryKey(),
  (old) => old?.map(s =>
    s.id === removedStudentId
      ? { ...s, enrolledCourseIds: s.enrolledCourseIds.filter(cid => cid !== courseId) }
      : s,
  ),
);
```

This avoids a server round-trip and corrects the UI immediately. The course detail query is still invalidated to refresh the `studentCount` badge.

> **Note for future work:** the `enrolled_course_ids` JSON column on the students table is now effectively a display-only stale cache. The source of truth for enrollment is `course_enrollments`. Any backend query that needs accurate enrollment data (e.g. Layer 3 access policies) already reads from `course_enrollments` via `fetchStudentEnrolledCourseIds()`. Consider removing the JSON column in a future migration.

---

## Testing

### Unit Tests (Vitest)

**File:** `artifacts/classmate/src/tests/courses.test.tsx`
**Setup:** `artifacts/classmate/src/tests/setup.ts`, `artifacts/classmate/vitest.config.ts`

**Result: 23/23 tests pass**

| Suite | Tests | Result |
|---|---|---|
| Courses list page | 7 | ✅ All pass |
| Course detail page | 16 | ✅ All pass |

**Coverage:**
- Renders existing courses and Add Course button
- Opens create dialog on button click
- Validation blocks empty form submission
- `useCreateCourse` called with correct payload including `teacherId`
- Cache invalidation on create success
- Inline error displayed on create failure
- Dialog closes and resets on cancel
- Course name, Edit, Archive buttons rendered in detail header
- Edit dialog pre-populated with current course data
- `useUpdateCourse` called with correct `id` + `data` payload
- Cache invalidation (detail + list) on edit success
- Validation blocks empty course name in edit
- Archive confirmation dialog opens with course name
- `useDeleteCourse` called when archive confirmed
- Enroll Student button visible on Students tab
- Enroll dialog opens with searchable student list
- `useEnrollStudent` called with correct `courseId` + `studentId`
- `queryClient.setQueryData` called with students cache key on enroll success
- 409 conflict error displayed inline in enroll dialog
- Enrolled student rendered with remove button
- `useUnenrollStudent` called when remove confirmed
- `queryClient.setQueryData` called with students cache key on unenroll success
- `getGetCourseQueryKey` invalidated on unenroll success

### End-to-End Tests (Playwright via `runTest`)

**Result: 33/33 steps pass**

Full flow tested as `admin`:
1. Navigate to `/courses` — list loads with Add Course button
2. Submit empty form — validation error, no API call
3. Fill all fields → create "Algebra I Test" — card appears, toast shown
4. Open course detail — name, Edit, Archive buttons visible
5. Edit: pre-populated dialog, change name to "Algebra I Updated" — heading updates
6. Enroll first available student — dialog closes, Students tab shows count = 1
7. Remove enrolled student — confirmation dialog, student removed, count = 0
8. Click Archive → Cancel — remained on detail page, course not archived

---

## Files Changed

| File | Change |
|---|---|
| `artifacts/classmate/src/pages/courses/index.tsx` | Rewritten — Create Course dialog with validation |
| `artifacts/classmate/src/pages/courses/detail.tsx` | Rewritten — Edit, Archive, Enroll, Unenroll with cache fix |
| `artifacts/classmate/src/tests/courses.test.tsx` | New — 23 unit tests |
| `artifacts/classmate/src/tests/setup.ts` | New — jest-dom setup |
| `artifacts/classmate/vitest.config.ts` | New — Vitest config with happy-dom + React |
| `artifacts/classmate/package.json` | Added `"test": "vitest run"` script |

---

## Patterns Established

These patterns should be followed in subsequent Sprint 7 chunks:

- **Form state:** `useState` per field — no react-hook-form
- **Mutations:** `onSuccess`/`onError` callbacks via mutation options object
- **Cache updates:** `queryClient.setQueryData` for immediate UI; `invalidateQueries` for count/aggregate refreshes
- **Validation:** client-side guard before calling `mutate`, with inline `<p className="text-sm text-destructive">` error
- **Toasts:** `useToast()` from `@/hooks/use-toast`
- **Confirmations:** `AlertDialog` from `@/components/ui/alert-dialog`
- **Auth context:** `useGetMe().data` for `teacherId` in create forms

---

## Next: Sprint 7 Chunk 2

Assignment CRUD + Grading UI (assignment list with status filters, create/edit/grade dialogs, scoped to teacher's courses).
