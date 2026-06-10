# Architecture Review: `GET /students/:id/progress`

**Date:** 2026-06-10
**Status:** Fully implemented and secured from Sprint 6.

---

## Layer-by-Layer Breakdown

### Authorization Layers

```
Layer 1  requireRole("admin", "teacher")           — students/guests blocked at middleware
Layer 2  (none — this is a single-ID lookup)
Layer 3  applyLayer3Guard(scope, studentId, res)   — teacher ownership enforced per-record
```

`applyLayer3Guard` is a local async helper in `artifacts/api-server/src/routes/students.ts` that:

1. Fetches the student's active course enrollments from `course_enrollments`
2. Calls `studentPolicy.validateAccess(scope, { id, enrolledCourseIds })`
3. Returns 403 if the teacher's `ownedCourseIds ∩ student.enrolledCourseIds = ∅`

### `StudentScopePolicy.validateAccess`

Defined in `artifacts/api-server/src/lib/policies/student-scope-policy.ts`:

| Role | Decision |
|---|---|
| `admin` | Always allowed |
| `teacher` | Allowed only if student is enrolled in ≥1 teacher-owned course |
| anything else | 403 |

The sub-queries for assignments and assessments inside the handler (lines 225–228) are intentionally unfiltered by scope — the Layer 3 ownership check already verified the teacher has rights to this student, so showing all their work is correct.

---

## File Locations

| Concern | File |
|---|---|
| Route handler | `artifacts/api-server/src/routes/students.ts` lines 197–266 |
| Policy | `artifacts/api-server/src/lib/policies/student-scope-policy.ts` |
| Scope filter primitive | `artifacts/api-server/src/lib/scope-filter.ts` — `teacherStudentEnrollmentFilter` |
| OpenAPI spec | `lib/api-spec/openapi.yaml` — `/students/{id}/progress` → `StudentProgress` schema |
| Generated hook | `useGetStudentProgress` (from `@workspace/api-client-react`) |
| Frontend consumer | `artifacts/classmate/src/pages/students/detail.tsx` |
| Security regression tests | `artifacts/api-server/src/tests/security-remediation.test.ts` |

---

## OpenAPI Contract

Defined in `lib/api-spec/openapi.yaml` at `/students/{id}/progress` referencing the `StudentProgress` schema.

Response shape:

```
studentId         integer
totalAssignments  integer
completedAssignments integer
averageScore      number  (0–100, 1 decimal place)
completionRate    number  (0–1, 2 decimal places)
topicsMastered    string[] (up to 5, deduped)
topicsNeedingWork string[] (up to 5, deduped)
```

---

## Frontend Integration

`artifacts/classmate/src/pages/students/detail.tsx` consumes:

```ts
const { data: progress } = useGetStudentProgress(id, { ... });
```

Displays in a **Progress** tab on the student detail page:
- `averageScore` and `completionRate` as headline stats
- `topicsMastered` as badge list
- `topicsNeedingWork` as badge list

---

## Sprint 6 Security Remediation Coverage

`security-remediation.test.ts` (691 lines) covers this endpoint under finding **S-02**
("Student IDOR — ownership enforcement missing"):

> Layer 3: GET/PATCH/DELETE/:id and GET/:id/progress enforce per-record teacher ownership via StudentScopePolicy.

The four routes covered by S-02:

| Route | Layer 3 guard |
|---|---|
| `GET /students/:id` | `applyLayer3Guard` |
| `PATCH /students/:id` | `applyLayer3Guard` |
| `DELETE /students/:id` | `applyLayer3Guard` |
| `GET /students/:id/progress` | `applyLayer3Guard` |

---

## Observation: 404 vs 403 Ordering

The endpoint returns **404** for a deleted/non-existent student *before* the auth check, then **403** if the student exists but the teacher doesn't own them. This is a deliberate, platform-wide convention:

- A teacher probing a **valid** student ID they don't own → **403** (correct IDOR signal)
- A **non-existent** ID → **404**

This is consistent across all scoped routes in the codebase.

---

## Conclusion

`GET /students/:id/progress` is:

- **Complete** — handler, policy, and OpenAPI contract all in place
- **Secure** — three-layer auth (requireRole + Layer 3 ownership check)
- **Tested** — Sprint 6 security remediation regression suite
- **Frontend-connected** — `useGetStudentProgress` hook consumed in the student detail page

**No work needed here.**
