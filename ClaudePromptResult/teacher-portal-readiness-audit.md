# Teacher Portal Readiness Audit

**Date:** 2026-06-09  
**Auditor:** Source-code inspection (frontend pages, backend routes, OpenAPI spec, authorization layers)  
**Scope:** All teacher-facing modules — courses, assignments, assessments, notes, announcements, dashboard

---

## Executive Summary

The Teacher Portal backend is **production-grade**: every teacher-facing API endpoint is implemented, properly role-guarded (Layer 1 `requireRole("admin","teacher")`), scope-filtered (Layer 2 policy), and ownership-validated (Layer 3 policy). The OpenAPI contract covers all read paths and most write paths.

The frontend, however, **only implements the read side of every module**. A teacher can view lists and detail pages but cannot create, edit, delete, or grade anything from the UI. Additionally, the Announcements module is entirely absent from the frontend, and one backend endpoint (`PATCH /assessments/:id`) does not exist at all. The dashboard aggregates are not filtered to the teacher's own courses.

**TEACHER PORTAL STATUS: NOT READY**

---

## Course Management

| Feature | Status | Evidence |
|---|---|---|
| Course list page | ✅ Complete | `useListCourses()` generated hook; skeleton loading, empty state, search filter |
| Course detail page | ✅ Complete | `useGetCourse()`, `useListStudents()`, `useListAssignments()`, `useListNotes()`; tabs for Students / Assignments / Notes |
| Create course UI | ❌ Blocked | `<Button><Plus />Add Course</Button>` on `courses/index.tsx:27` has no `onClick`, no dialog, no form |
| Edit course UI | ❌ Missing | No edit button, no form, no PATCH/PUT call anywhere in the frontend |
| Archive/delete UI | ❌ Missing | No delete button anywhere in course pages |
| Teacher ownership enforcement | ✅ Backend only | `coursePolicy.validateAccess()` applied on PUT, DELETE, and enrollment endpoints |
| API integration | ⚠️ Read-only | All read hooks used; write hooks (`useCreateCourse`, `useUpdateCourse`, `useDeleteCourse`) generated but never called |

**Observation:** The course detail Students tab (`courses/detail.tsx:23`) filters enrolled students client-side using the denormalised `enrolledCourseIds` JSON column stored on the student row, rather than querying the `course_enrollments` table. The enrollment API operates on `course_enrollments` (the normalised source of truth). These can diverge if a student is enrolled via the API but their JSON column is not updated in the same transaction.

---

## Assignment Management

| Feature | Status | Evidence |
|---|---|---|
| Assignment list page | ✅ Complete | `useListAssignments()` with status filter + search; real API data |
| Assignment detail page | ❌ Missing | No `/assignments/:id` route in `App.tsx`; assignment title has `cursor-pointer hover:underline` styling but no navigation |
| Create assignment UI | ❌ Missing | No create button on the assignments page |
| Edit assignment UI | ❌ Missing | No edit dialog or PATCH call |
| Delete UI | ❌ Missing | No delete button; soft-delete backend endpoint exists |
| Submission review UI | ❌ Blocked | Cards show "Needs Grading" badge (`assignments/index.tsx:114`) but provide no action to open or grade the submission |
| Grading workflow | ❌ Blocked | `PATCH /assignments/:id` with `status:"graded"` and `score` is in OpenAPI + backend but no frontend form exists |

---

## Assessment Management

| Feature | Status | Evidence |
|---|---|---|
| Assessment list page | ✅ Complete | `useListAssessments()`; shows score, percentage, strengths/weaknesses per card |
| Create assessment UI | ❌ Missing | No create button on `assessments/index.tsx` |
| Edit assessment UI | ❌ Missing | No edit UI; no PATCH call from frontend |
| Delete UI | ❌ Missing | No delete button; soft-delete backend endpoint exists |
| Score entry workflow | ❌ Blocked | POST endpoint and OpenAPI spec exist but no frontend form |
| PATCH support end-to-end | ❌ Missing | `PATCH /assessments/:id` **does not exist** in the backend route file (`assessments.ts` implements GET list, POST, GET by id, GET ai-suggestions, DELETE only). The OpenAPI spec also contains no PATCH entry for `/assessments/{id}`. Scores are write-once. |

---

## Notes Management

| Feature | Status | Evidence |
|---|---|---|
| Notes list page | ✅ Complete | `useListNotes()`, grid layout, video badge indicator, links to detail |
| Note detail page | ✅ Complete | `useGetNote()`, content rendering, video URL display |
| Create note UI | ❌ Missing | No create button on `notes/index.tsx` |
| Edit note UI | ❌ Missing | `notes/detail.tsx` shows content read-only; no edit button, no form, no PATCH call |
| Delete UI | ❌ Missing | No delete button in detail or list |
| Attachment/video handling | ⚠️ Mocked | Detail page renders a non-functional video player (`notes/detail.tsx:66` comment: `{/* Mock video player */}`) with hardcoded timestamp "0:00 / 45:00". The `videoUrl` field is stored and retrieved correctly; only the playback UI is fake. |

---

## Announcements Management

| Feature | Status | Evidence |
|---|---|---|
| Announcements page | ❌ Absent | No `/announcements` route in `App.tsx`. No nav item in `layout.tsx` `baseNavItems`. The module is entirely unreachable from the teacher UI. |
| Create announcement UI | ❌ Absent | — |
| Edit announcement UI | ❌ Absent | — |
| Delete UI | ❌ Absent | — |
| Audience targeting | ❌ Absent | The backend supports `courseId`-scoped announcements with `priority` field; none of this is exposed |

**Note:** The backend is fully implemented: `GET /announcements`, `POST /announcements`, `GET /announcements/:id`, `PATCH /announcements/:id`, `DELETE /announcements/:id` — all with Layer 1/2/3 guards (`announcements.ts`). The module is simply not wired into the frontend at all.

---

## Dashboard Review

| Feature | Status | Evidence |
|---|---|---|
| Summary cards | ✅ Real API data | `useGetDashboardSummary()`, `useGetRecentActivity()`, `useGetGradeBreakdown()` — all generated hooks |
| Loading states | ✅ Present | Skeleton components on all three data sources |
| Grade distribution chart | ✅ Real data | Recharts `BarChart` driven by `useGetGradeBreakdown()` |
| Top performers | ✅ Real data | Sourced from `summary.topPerformers` (API) |
| Activity feed | ✅ Real data | `useGetRecentActivity()`, timeline rendering |
| Teacher-specific data filtering | ❌ Not scoped | `dashboard.ts` queries `studentsTable`, `coursesTable`, `assignmentsTable`, `assessmentsTable` with `isNull(deletedAt)` only — no scope context is read from the session. A teacher sees the aggregate across the **entire platform**, not just their own students and courses. |
| Navigation completeness | ⚠️ Partial | No Announcements nav link; all other items present |
| Broken links | None found | — |
| Hardcoded data | None in dashboard | — |

---

## API Integration Findings

| Page | Hook used | Real API | Mock data | Placeholder actions |
|---|---|---|---|---|
| Dashboard | 3 generated hooks | ✅ | None | None |
| Courses list | `useListCourses` | ✅ | None | "Add Course" button — no action |
| Course detail | `useGetCourse`, `useListStudents`, `useListAssignments`, `useListNotes` | ✅ | None | No edit/delete/enroll actions |
| Assignments list | `useListAssignments` | ✅ | None | No create/grade/delete actions |
| Assessments list | `useListAssessments` | ✅ | None | No create/edit/delete actions |
| Notes list | `useListNotes` | ✅ | None | No create action |
| Note detail | `useGetNote` | ✅ | Fake video player UI | No edit/delete actions |
| Students list | `useListStudents` | ✅ | None | None |
| Student detail | `useGetStudent`, `useGetStudentProgress`, `useListAssignments`, `useListAssessments` | ✅ | None | No edit/grade/delete actions |
| Announcements | — | ❌ No page | — | — |

---

## Authorization Findings

| Scenario | Status | Evidence |
|---|---|---|
| Teacher blocked from /settings | ✅ Pass | `App.tsx:43` redirects any non-admin away from `/settings`; nav item absent from `baseNavItems` |
| Teacher sees only own courses (list) | ✅ Pass | `listCourses()` applies `CourseScopePolicy.getScopeCondition()` — subquery filters to `ownedCourseIds` |
| Teacher blocked from other teacher's course (detail) | ✅ Pass | `coursePolicy.validateAccess()` called before response; throws 403 |
| Teacher sees only own students (list) | ✅ Pass | `studentPolicy.getScopeCondition()` applies enrollment subquery at DB level |
| Teacher blocked from other teacher's student (detail) | ✅ Pass | `applyLayer3Guard()` fetches live `course_enrollments` and validates via `studentPolicy.validateAccess()` |
| Teacher cannot grade another teacher's assignment | ✅ Pass | `assignmentPolicy.validateAccess()` checked on PATCH before write |
| Teacher cannot delete another teacher's note/assessment/announcement | ✅ Pass | All DELETE routes check policy before soft-delete |
| Dashboard shows only teacher's class data | ❌ Fail | `dashboard.ts` reads without scope — teacher sees all students, all courses, all assignments platform-wide |

---

## OpenAPI Findings

| Endpoint | In OpenAPI | Generated hook | Used in frontend |
|---|---|---|---|
| GET /courses | ✅ | `useListCourses` | ✅ |
| POST /courses | ✅ | `useCreateCourse` | ❌ Never called |
| PUT /courses/:id | ✅ | `useUpdateCourse` | ❌ Never called |
| DELETE /courses/:id | ✅ | `useDeleteCourse` | ❌ Never called |
| GET /assignments | ✅ | `useListAssignments` | ✅ |
| POST /assignments | ✅ | `useCreateAssignment` | ❌ Never called |
| PATCH /assignments/:id | ✅ | `useUpdateAssignment` | ❌ Never called |
| DELETE /assignments/:id | ✅ | `useDeleteAssignment` | ❌ Never called |
| GET /assessments | ✅ | `useListAssessments` | ✅ |
| POST /assessments | ✅ | `useCreateAssessment` | ❌ Never called |
| **PATCH /assessments/:id** | **❌ Missing** | **Not generated** | **No backend route either** |
| DELETE /assessments/:id | ✅ | `useDeleteAssessment` | ❌ Never called |
| GET /notes | ✅ | `useListNotes` | ✅ |
| POST /notes | ✅ | `useCreateNote` | ❌ Never called |
| PATCH /notes/:id | ✅ | `useUpdateNote` | ❌ Never called |
| DELETE /notes/:id | ✅ | `useDeleteNote` | ❌ Never called |
| GET /announcements | ✅ | `useListAnnouncements` | ❌ No page |
| POST /announcements | ✅ | `useCreateAnnouncement` | ❌ No page |
| PATCH /announcements/:id | ✅ | `useUpdateAnnouncement` | ❌ No page |
| DELETE /announcements/:id | ✅ | `useDeleteAnnouncement` | ❌ No page |
| POST /courses/:id/enrollments | ✅ | `useEnrollStudent` | ❌ Never called |
| DELETE /courses/:id/enrollments/:studentId | ✅ | `useUnenrollStudent` | ❌ Never called |

**No manual `fetch()` calls bypass the generated contract.** Every API call in the frontend uses a generated hook from `@workspace/api-client-react`. The OpenAPI sync issue is the missing `PATCH /assessments/:id` (absent from both spec and backend).

---

## Workflow Simulation Results

### Journey A — Create course → Enroll students → Create assignment → Publish assignment

| Step | Status | Reason |
|---|---|---|
| Create course | ❌ Blocked | "Add Course" button has no action |
| Enroll students | ❌ Blocked | No enrollment UI on course detail page |
| Create assignment | ❌ Blocked | No create UI on assignments page |
| Publish assignment | ❌ Blocked | No "publish" concept in UI; PATCH grading flow not wired up |

**Result: Blocked at step 1**

### Journey B — Create assessment → Enter scores → Edit scores

| Step | Status | Reason |
|---|---|---|
| Create assessment | ❌ Blocked | No create button or form |
| Enter scores | ❌ Blocked | Same — no score entry UI |
| Edit scores | ❌ Blocked | `PATCH /assessments/:id` missing from backend and OpenAPI |

**Result: Blocked at step 1; editing impossible even if creation UI were built**

### Journey C — Create announcement → Create note → Update note → Delete note

| Step | Status | Reason |
|---|---|---|
| Create announcement | ❌ Blocked | Announcements module has no frontend page |
| Create note | ❌ Blocked | No create button on notes list |
| Update note | ❌ Blocked | Note detail is read-only |
| Delete note | ❌ Blocked | No delete UI |

**Result: Blocked at every step**

---

## Launch Blockers

### Severity 1 — Critical (blocks all teacher workflows)

| # | Blocker | Business Impact | Estimated Effort |
|---|---|---|---|
| B-01 | **No create/edit/delete UI for any module** — courses, assignments, assessments, notes all have placeholder or missing action buttons | Teacher cannot do any teaching work; platform is read-only for the teacher role | Large — requires dialogs/forms for 4 modules × (create + edit + delete) = ~12 UI flows |
| B-02 | **Announcements module absent from frontend** — no page, no route, no nav link | Teachers cannot communicate with students at all | Medium — page + CRUD forms + nav entry; backend is 100% ready |
| B-03 | **No grading workflow** — "Needs Grading" is shown but clicking does nothing; no assignment detail page | Core teacher function is unreachable | Medium — assignment detail page + grade form using existing `useUpdateAssignment` hook |

### Severity 2 — High (partial capability blocked)

| # | Blocker | Business Impact | Estimated Effort |
|---|---|---|---|
| B-04 | **`PATCH /assessments/:id` missing from backend and OpenAPI** | Assessment scores are write-once; teachers cannot correct errors | Small — add route handler to `assessments.ts` + OpenAPI entry + re-run codegen |
| B-05 | **Dashboard not teacher-scoped** — `dashboard/summary`, `recent-activity`, `grade-breakdown` query all records regardless of which teacher is logged in | Teacher sees another teacher's students and grades; confusing and potentially a privacy concern | Medium — `dashboard.ts` must accept and apply scope context |
| B-06 | **No enrollment UI** — `POST /courses/:id/enrollments` and `DELETE` equivalent exist and are generated, but no UI lets a teacher enroll or remove a student | Teacher cannot populate a course | Small — add enroll/unenroll dialog to course detail Students tab |

### Severity 3 — Medium (cosmetic / lower-priority gaps)

| # | Blocker | Business Impact | Estimated Effort |
|---|---|---|---|
| B-07 | **Note video player is mocked** — hardcoded "0:00 / 45:00", non-functional | Teachers and students expecting lesson replay cannot use it | Small to medium depending on whether a real video embed (YouTube/Vimeo iframe) is acceptable |
| B-08 | **Course detail student list uses denormalised JSON column** — `enrolledCourseIds` from student row rather than `course_enrollments` table | Potential stale display if enrollment data diverges between tables | Small — switch to a course-scoped student query once supported |

---

## TEACHER PORTAL STATUS: NOT READY

**Evidence summary:** Three complete end-to-end teacher journeys are each blocked at step 1. The frontend is a functional read-only dashboard backed by real API data, but the teacher's primary responsibilities — creating and grading assignments, recording assessments, posting announcements, managing course enrollment — have no UI entry point whatsoever. All necessary backend infrastructure (routes, policies, OpenAPI contracts, generated hooks) exists and is correct; the gap is exclusively in frontend implementation of write operations.
