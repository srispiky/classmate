# Security Remediation Verification Report

**Date:** June 9, 2026
**Verification method:** Direct source code inspection of current HEAD
**Files inspected:**
- `artifacts/api-server/src/routes/admin.ts`
- `artifacts/api-server/src/routes/index.ts`
- `artifacts/api-server/src/routes/students.ts`
- `artifacts/classmate/src/pages/settings/index.tsx`

---

## S-01 Verification — Admin Routes Exposed to All Authenticated Users

### Verdict: FAIL

No remediation has been applied. The finding is identical to the state reported in the audit.

**Evidence — `admin.ts` (no requireRole on either handler):**

```
Line  7:  router.get("/admin/db-status", async (_req, res): Promise<void> => {
Line 62:  router.post("/admin/test-db", async (req, res): Promise<void> => {
```

Neither handler references `requireRole`. No middleware is passed as a second argument. There is no role check inside the handler bodies.

**Evidence — `routes/index.ts` (registration order):**

```
Line 30:  router.use(requireAuth);       ← only authentication gate
Line 48:  router.use(adminRouter);       ← admin router registered here, no role gate added
```

`adminRouter` is mounted after `requireAuth` and nothing else. Any valid session — teacher, student, parent, guest — can reach both endpoints.

**Evidence — `settings/index.tsx` (frontend exposure unchanged):**

```
Line 45:  const res = await fetch(`${BASE}/api/admin/db-status`);
Line 57:  const res = await fetch(`${BASE}/api/admin/test-db`, { method: "POST", ... });
```

The Settings page is not role-gated. There is no `useAuthUser` role check before rendering the component, no route guard in `App.tsx` for `/settings`, and no conditional hide of the navigation item. Any logged-in user who navigates to `/settings` is presented with the full DB diagnostics UI and the connection test form.

**Exploitability confirmation:**

`POST /admin/test-db` (line 62–85) accepts arbitrary `host`, `port`, `database`, `user`, `password` from the request body and opens a real TCP connection to the target. A student or parent session can supply an arbitrary host and use the server as a network probe with no authorization barrier.

---

## S-02 Verification — Student Management Ownership Enforcement Gap

### Verdict: FAIL

No remediation has been applied. All four affected routes still rely solely on Layer 1 (`requireRole`). No Layer 3 ownership validation exists anywhere in the file.

**Evidence — `GET /students/:id` (lines 77–101):**

```typescript
router.get("/students/:id", requireRole("admin", "teacher"), async (req, res) => {
  const [student] = await db.select()
    .from(studentsTable)
    .where(eq(studentsTable.id, params.data.id));   // ← ID taken directly from URL
  // No scope context built. No policy.validateAccess. No ownership check.
  res.json(...);
});
```

**Evidence — `PATCH /students/:id` (lines 106–148):**

```typescript
router.patch("/students/:id", requireRole("admin", "teacher"), async (req, res) => {
  // Fetches existing only to check deleted_at — not to validate ownership.
  const [existing] = await db.select({ id, deletedAt }).from(studentsTable)
    .where(eq(studentsTable.id, params.data.id));
  // No scope context. No policy check.
  await db.update(studentsTable).set(parsed.data).where(...);
});
```

**Evidence — `GET /students/:id/progress` (lines 153–220):**

```typescript
router.get("/students/:id/progress", requireRole("admin", "teacher"), async (req, res) => {
  // Fetches student, assignments, assessments by studentId.
  // No scope context. No ownership validation.
  res.json(GetStudentProgressResponse.parse(progress));
});
```

**Evidence — `DELETE /students/:id` (lines 225–256):**

```typescript
router.delete("/students/:id", requireRole("admin", "teacher"), async (req, res) => {
  const scope = buildScopeContext(req.session as ClassmateSession);
  // scope is used only to extract scope.userId for deletedBy (line 251).
  // No policy.validateAccess call. No check that teacher owns this student.
  await db.update(studentsTable).set({ deletedAt: new Date(), deletedBy: scope.userId })...
});
```

**Additional finding during S-02 review — `GET /students` also unscoped:**

```typescript
// Lines 23–39
router.get("/students", requireRole("admin", "teacher"), async (_req, res) => {
  const students = await db.select().from(studentsTable)
    .where(isNull(studentsTable.deletedAt));   // ← returns ALL non-deleted students
  // No scope context built. No Layer 2 filter. Teacher sees all students system-wide.
});
```

The list endpoint has the same gap as the detail endpoints. A teacher in School A can list and access every student in the system. Every other collection endpoint (assignments, assessments, announcements, notes, courses) applies `getScopeCondition` at Layer 2. Students is the only resource that does not.

**Logical bypass analysis — confirmed exploitable:**

A teacher session only needs to know (or enumerate) a student ID to read full profile, all assignments and their scores, all assessment strengths/weaknesses, update any field, or soft-delete any student. There is no enrollment check, no `ownedCourseIds` intersection, and no policy guard between the teacher's token and any student row.

---

## Additional Security Findings

### AF-01 — `POST /students` does not set `createdBy` (line 52–61)

```typescript
await db.insert(studentsTable).values({
  name:    parsed.data.name,
  email:   parsed.data.email,
  grade:   parsed.data.grade,
  avatarUrl: parsed.data.avatarUrl ?? null,
  enrolledCourseIds: [],
  // createdBy: scope.userId  ← missing
});
void scope;   // ← scope was built but discarded
```

The scope is built on line 45 and discarded with `void scope` on line 71. `createdBy` is never written. This is an audit integrity gap, not an authorization gap — but it means student creation leaves no actor trail in the database.

### AF-02 — `PATCH /students/:id` does not set `updatedAt` or `updatedBy` (lines 130–134)

```typescript
await db.update(studentsTable)
  .set(parsed.data)   // ← only client fields; no updatedAt, no updatedBy
  .where(eq(studentsTable.id, params.data.id));
```

This is a pre-existing schema gap (the `students` table has no `updated_at` or `updated_by` columns) compounded by the route not attempting to set them even if it could.

---

## Authorization Architecture Review

### Verdict: PASS (with noted violations)

The 3-layer model itself is sound and correctly implemented across all other resource types. The violations are localized to `students.ts` and `admin.ts` — they are additions by omission (missing guards) rather than architectural mutations. No authorization logic was found inside repositories. No policy logic was found inside repositories. The `requireRole` middleware factory, `ScopeContext`, and `ResourceScopePolicy` interfaces remain clean.

The `void scope` statement in the student POST handler is a tell: a developer built the scope context but did not know where or how to apply it, suggesting the guard pattern was not propagated consistently when `students.ts` was authored before the policy library was established.

---

## Regression Risk Assessment

### LOW — for changes to other modules

The student and admin vulnerabilities are isolated. The policy enforcement pattern in `courses.ts`, `assignments.ts`, `assessments.ts`, `announcements.ts`, and `notes.ts` is unaffected and would not be disturbed by remediating `students.ts` and `admin.ts`.

### MEDIUM — for the student remediation itself

Adding Layer 2 scope filtering to `GET /students` requires a `StudentScopePolicy` or equivalent — either a new policy class following the existing pattern, or reuse of `enrolledCourseIds` / `ownedCourseIds` conditions. The risk is that a teacher who currently sees all students may lose access to students they legitimately teach, if the scope is too restrictive. The remediation must be tested with both admin and teacher sessions, and a positive-ownership test must be added alongside the negative-IDOR test.

---

## Test Coverage Review

The test suite (1330 passing) currently has no tests that verify a teacher is **blocked** from accessing a student they do not teach. The existing `user-management.test.ts` and `sprint6a-hardening.test.ts` tests verify role blocking (e.g., teacher blocked from admin-only endpoints) but do not verify cross-teacher IDOR on the students endpoints.

**Missing test assertions:**

| Scenario | Coverage |
|---|---|
| Teacher A blocked from `GET /students/:id` owned by Teacher B | Missing |
| Teacher A blocked from `PATCH /students/:id` owned by Teacher B | Missing |
| Teacher A blocked from `DELETE /students/:id` owned by Teacher B | Missing |
| Admin retains global access to all student records | Missing |
| Any authenticated non-admin blocked from `GET /admin/db-status` | Missing |
| Any authenticated non-admin blocked from `POST /admin/test-db` | Missing |
| Student session cannot reach `/settings` page admin endpoints | Missing |

Without these tests, both vulnerabilities can silently regress after any future refactor.

---

## Launch Security Verdict

### FAIL

Neither S-01 nor S-02 has been remediated. The code at HEAD is identical to the state that produced the Critical and High findings in the previous audit. A student or teacher session can probe arbitrary database hosts through `POST /admin/test-db` and read, update, or delete any student record regardless of enrollment. Neither finding is acceptable for a pilot deployment.
