# DATABASE_CERTIFICATION.md
## Sprint 13 Chunk 2 — Database Integrity Certification

**Date:** July 6, 2026  
**Certified by:** Sprint 13 Chunk 2 automated + manual audit  
**Status:** ✅ **GO FOR PRODUCTION**

---

## 1. Foreign Key Audit

### Summary

All foreign keys are declared in the Drizzle schema, exist in the database, are captured in the migration baseline, and align with drizzle relations.

### Complete FK Matrix

| Table | Column | References | Policy | Schema | DB | Migration |
|-------|--------|-----------|--------|--------|-----|-----------|
| activity | course_id | courses.id | SET NULL | ✅ | ✅ | ✅ |
| announcements | course_id | courses.id | CASCADE | ✅ | ✅ | ✅ |
| announcements | created_by | users.id | SET NULL | ✅ | ✅ | ✅ |
| announcements | updated_by | users.id | SET NULL | ✅ | ✅ | ✅ |
| announcements | deleted_by | users.id | SET NULL | ✅ | ✅ | ✅ |
| assessments | student_id | students.id | CASCADE | ✅ | ✅ | ✅ |
| assessments | course_id | courses.id | CASCADE | ✅ | ✅ | ✅ |
| assessments | created_by | users.id | SET NULL | ✅ | ✅ | ✅ |
| assessments | updated_by | users.id | SET NULL | ✅ | ✅ | ✅ |
| assessments | deleted_by | users.id | SET NULL | ✅ | ✅ | ✅ |
| assignments | student_id | students.id | CASCADE | ✅ | ✅ | ✅ |
| assignments | course_id | courses.id | CASCADE | ✅ | ✅ | ✅ |
| assignments | created_by | users.id | SET NULL | ✅ | ✅ | ✅ |
| assignments | updated_by | users.id | SET NULL | ✅ | ✅ | ✅ |
| assignments | deleted_by | users.id | SET NULL | ✅ | ✅ | ✅ |
| course_enrollments | student_id | students.id | CASCADE | ✅ | ✅ | ✅ |
| course_enrollments | course_id | courses.id | RESTRICT | ✅ | ✅ | ✅ |
| course_enrollments | enrolled_by | users.id | RESTRICT | ✅ | ✅ | ✅ |
| course_enrollments | dropped_by | users.id | SET NULL | ✅ | ✅ | ✅ |
| courses | teacher_id | users.id | RESTRICT | ✅ | ✅ | ✅ |
| courses | created_by | users.id | SET NULL | ✅ | ✅ | ✅ |
| courses | updated_by | users.id | SET NULL | ✅ | ✅ | ✅ |
| courses | deleted_by | users.id | SET NULL | ✅ | ✅ | ✅ |
| notes | course_id | courses.id | CASCADE | ✅ | ✅ | ✅ |
| notes | created_by | users.id | SET NULL | ✅ | ✅ | ✅ |
| notes | updated_by | users.id | SET NULL | ✅ | ✅ | ✅ |
| notes | deleted_by | users.id | SET NULL | ✅ | ✅ | ✅ |
| role_permissions | role_id | roles.id | CASCADE | ✅ | ✅ | ✅ |
| role_permissions | permission_id | permissions.id | CASCADE | ✅ | ✅ | ✅ |
| role_permissions | granted_by | users.id | RESTRICT | ✅ | ✅ | ✅ |
| student_guardians | student_id | students.id | CASCADE | ✅ | ✅ | ✅ |
| student_guardians | user_id | users.id | CASCADE | ✅ | ✅ | ✅ |
| student_guardians | created_by | users.id | RESTRICT | ✅ | ✅ | ✅ |
| students | user_id | users.id | SET NULL | ✅ | ✅ | ✅ |
| students | created_by | users.id | SET NULL | ✅ | ✅ | ✅ |
| students | updated_by | users.id | SET NULL | ✅ | ✅ | ✅ |
| students | deleted_by | users.id | SET NULL | ✅ | ✅ | ✅ |
| user_roles | user_id | users.id | CASCADE | ✅ | ✅ | ✅ |
| user_roles | role_id | roles.id | RESTRICT | ✅ | ✅ | ✅ |
| user_roles | granted_by | users.id | RESTRICT | ✅ | ✅ | ✅ |
| user_roles | revoked_by | users.id | RESTRICT | ✅ | ✅ | ✅ |
| users | created_by | users.id | SET NULL | ✅ | ✅ | ✅ |
| users | updated_by | users.id | SET NULL | ✅ | ✅ | ✅ |

**Total: 43 FK constraints — all present and enforced.**

### Design Notes

- `activity.course_id` is nullable + SET NULL — correct: activity log entries survive course deletion, preserving the audit trail with null course reference.
- `course_enrollments.course_id` uses RESTRICT (not CASCADE) — deliberate: prevents accidental course deletion when students are still enrolled. The course must be dropped from all enrollments first.
- `courses.teacher_id` uses RESTRICT — deliberate: prevents deleting a teacher account while they own courses.
- Student deletion cascades to assignments, assessments, and student_guardians — correct: a student's data has no meaning without the student record.

---

## 2. Index Coverage Audit

### Index Matrix

| Table | Index | Type | Columns | Purpose | Status |
|-------|-------|------|---------|---------|--------|
| activity | ix_activity_course_id | btree | course_id | Dashboard recent-activity WHERE course_id | ✅ |
| announcements | ix_announcements_course_id | btree | course_id | List by course WHERE course_id | ✅ |
| announcements | ix_announcements_deleted_at | partial btree | deleted_at WHERE NOT NULL | Soft-delete maintenance scans | ✅ |
| assessments | ix_assessments_student_id | btree | student_id | Progress/AI routes WHERE student_id | ✅ |
| assessments | ix_assessments_course_id | btree | course_id | Grade breakdown, course report WHERE course_id | ✅ |
| assessments | ix_assessments_deleted_at | partial btree | deleted_at WHERE NOT NULL | Soft-delete maintenance scans | ✅ |
| assignments | ix_assignments_student_id | btree | student_id | Progress routes WHERE student_id | ✅ |
| assignments | ix_assignments_course_id | btree | course_id | Assignment list WHERE course_id | ✅ |
| assignments | ix_assignments_deleted_at | partial btree | deleted_at WHERE NOT NULL | Soft-delete maintenance scans | ✅ |
| course_enrollments | ix_course_enrollments_student_id | partial btree | student_id WHERE is_active=true | Active enrollment lookup | ✅ |
| course_enrollments | ix_course_enrollments_course_id | partial btree | course_id WHERE is_active=true | Course roster lookup | ✅ |
| course_enrollments | uq_course_enrollments_active | unique partial | (student_id, course_id) WHERE is_active | Prevents duplicate active enrollment | ✅ |
| courses | ix_courses_teacher_id | btree | teacher_id | Teacher-scoped course list | ✅ |
| courses | ix_courses_deleted_at | partial btree | deleted_at WHERE NOT NULL | Soft-delete maintenance scans | ✅ |
| notes | ix_notes_course_id | btree | course_id | Notes list WHERE course_id | ✅ |
| notes | ix_notes_deleted_at | partial btree | deleted_at WHERE NOT NULL | Soft-delete maintenance scans | ✅ |
| session | IDX_session_expire | btree | expire | Session expiry cleanup | ✅ |
| student_guardians | ix_student_guardians_user_id | btree | user_id | Parent portal lookup by user | ✅ |
| student_guardians | uq_student_guardians | unique | (student_id, user_id) | Prevents duplicate guardian links | ✅ |
| students | students_email_unique | unique | email | Email uniqueness + login lookup | ✅ |
| students | uq_students_user_id | unique partial | user_id WHERE NOT NULL | One student account per user | ✅ |
| user_roles | ix_user_roles_user_id | btree | user_id | Role lookup by user (RBAC) | ✅ |
| user_roles | uq_user_roles_active | unique partial | (user_id, role_id) WHERE not revoked | Prevents duplicate active role | ✅ |

**Total: 23 indexes — all present and correctly defined.**

### Query Scalability Notes

**Current state:** All query plans show seq scans. This is expected and correct — tables contain < 20 rows of real data. PostgreSQL's planner correctly chooses seq scans over index lookups when the entire table fits on a single page. The indexes will activate automatically as data grows past the planner's threshold (typically ~100+ rows or 5% of table size).

**Index strategy validated:** Every high-frequency filter column has an index:
- `WHERE student_id = ?` → ix_assignments_student_id, ix_assessments_student_id
- `WHERE course_id = ?` → ix_assignments_course_id, ix_assessments_course_id, ix_notes_course_id, ix_announcements_course_id
- `WHERE teacher_id = ?` → ix_courses_teacher_id
- `WHERE is_active = true AND student_id = ?` → ix_course_enrollments_student_id (partial)
- `WHERE is_active = true AND course_id = ?` → ix_course_enrollments_course_id (partial)

---

## 3. Soft-Delete Consistency Audit

### Tables with soft-delete

| Table | deleted_at | deleted_by | Nullable | Routes filter correctly |
|-------|-----------|-----------|---------|------------------------|
| students | ✅ | ✅ | YES | ✅ |
| courses | ✅ | ✅ | YES | ✅ (via courses.queries) |
| assignments | ✅ | ✅ | YES | ✅ (via assignments.queries) |
| assessments | ✅ | ✅ | YES | ✅ (via assessments.queries) |
| notes | ✅ | ✅ | YES | ✅ (via notes.queries) |
| announcements | ✅ | ✅ | YES | ✅ (via announcements.queries) |

### Tables intentionally without soft-delete

| Table | Reason |
|-------|--------|
| activity | Append-only event log — records are never deleted |
| roles / permissions / role_permissions | RBAC catalog — system rows, hard deletes only |
| user_roles | Role grants use revoked_at/revokedBy instead |
| course_enrollments | Uses droppedAt/droppedBy + isActive=false pattern |
| student_guardians | Hard delete appropriate — guardian link removal is explicit |
| rbac_version | Version tracking row, not a user record |
| users | No soft-delete; account deactivation uses isActive=false |

### Issues Found and Fixed

#### Bug 1 — `/students/:id/progress` included soft-deleted assignments and assessments

**Before:** The progress route fetched all assignments/assessments for a student with no `deletedAt` filter:
```typescript
db.select().from(assignmentsTable).where(eq(assignmentsTable.studentId, studentId))
```
This caused soft-deleted assignments to be counted in `totalAssignments` and to contribute to average score calculations.

**After (fixed):**
```typescript
db.select().from(assignmentsTable).where(
  and(eq(assignmentsTable.studentId, studentId), isNull(assignmentsTable.deletedAt))
)
```

**Impact:** `totalAssignments`, `completedAssignments`, `averageScore`, `completionRate`, `riskLevel`, and `trend` were all inflated by deleted records.

#### Bug 2 — `/students/:id/progress/timeline` fetched soft-deleted rows from DB

**Before:** The timeline route fetched all assignment/assessment rows without a `deletedAt` filter. `buildTimeline()` in the service correctly skipped deleted rows in JS, but all rows were fetched from the database first.

**After (fixed):** DB-level filter added. `buildTimeline()` retains its JS guard as a defence-in-depth check.

**Impact:** No data exposure (JS filter caught it), but unnecessary rows were transferred over the network.

#### Fix location

`artifacts/api-server/src/routes/students.ts` — both the `/progress` and `/progress/timeline` sub-routes.

---

## 4. Relational Integrity Tests

All 6 tests run against the live database. Results:

### FK Enforcement — Invalid IDs

| Test | Operation | Expected | Result |
|------|-----------|---------|--------|
| 1 | INSERT assignment with student_id=999999 | FK violation | ✅ `assignments_student_id_students_id_fk` raised |
| 2 | INSERT assignment with course_id=999999 | FK violation | ✅ `assignments_course_id_courses_id_fk` raised |
| 3 | INSERT assessment with student_id=999999 | FK violation | ✅ `assessments_student_id_students_id_fk` raised |
| 4 | INSERT assessment with course_id=999999 | FK violation | ✅ `assessments_course_id_courses_id_fk` raised |

### Delete Cascade / Restrict Behavior

| Test | Operation | Expected | Result |
|------|-----------|---------|--------|
| 5 | DELETE student → check assignments + assessments | Both cascade-deleted | ✅ CASCADE confirmed (0 rows remain) |
| 6 | DELETE course with active enrollment | RESTRICT fires | ✅ FK violation raised — course not deleted |

**All 6 integrity tests passed.**

---

## 5. Query Plan Review

### High-Volume Endpoints

All queries analyzed with EXPLAIN ANALYZE against the live database.

**Note:** Tables currently have < 20 rows. PostgreSQL correctly uses seq scans at this scale. Plans are documented for production readiness tracking — indexes will be selected by the planner automatically as data grows.

#### Dashboard Summary (`GET /api/dashboard/summary`)

| Sub-query | Plan | Notes |
|-----------|------|-------|
| Student count (WHERE deleted_at IS NULL) | Seq Scan → Aggregate | ✅ No N+1. 1 SQL aggregate. |
| Course count (WHERE teacher_id = ? / all) | Seq Scan | ✅ ix_courses_teacher_id will activate at scale |
| Assignment count + avg (WHERE deleted_at IS NULL) | Seq Scan | ✅ Parallel with other 3 queries |
| Assessment avg per student | Seq Scan | ✅ Parallel |

**Pattern:** 4 parallel SQL queries, results aggregated in JS over small result sets. No N+1. No table scan on unbounded data.

#### Student Health (`GET /api/dashboard/student-health`)

| Sub-query | Plan | Notes |
|-----------|------|-------|
| Students (id, name only) | Seq Scan + filter deleted_at IS NULL | ✅ Minimal column selection |
| Assignments (5 cols only) | Seq Scan + filter deleted_at IS NULL | ✅ Minimal column selection (skips JSON) |
| Assessments (4 cols only) | Seq Scan + filter deleted_at IS NULL | ✅ Minimal column selection (skips JSON) |

**Pattern:** 3 parallel queries with explicit column selection — no `SELECT *`. No N+1.

#### Course Report (`GET /api/reports/course-summary`)

```
1 × SELECT course (with soft-delete guard)
1 × SELECT active enrollments WHERE course_id = ? AND is_active = true
3 × Parallel: students (inArray), assignments WHERE course_id, assessments WHERE course_id
Per-student scoring loop in JS over pre-fetched arrays
```

**N+1 risk identified (low priority):** The course report pre-fetches all enrolled student IDs, then fetches all students/assignments/assessments for the course in 3 parallel queries. Per-student filtering is done in JS (`filter(a.studentId === s.id)`). This is safe up to ~500 students/course before the JS loop becomes a concern. **Not optimised in this chunk — documented only.**

#### Student Progress (`GET /api/students/:id/progress`)

```
1 × SELECT student (soft-delete guard)
1 × SELECT enrolled course IDs from course_enrollments (Layer 3 guard)
2 × Parallel: assignments WHERE student_id AND deleted_at IS NULL (FIXED THIS SPRINT)
                assessments WHERE student_id AND deleted_at IS NULL (FIXED THIS SPRINT)
```

**Pattern:** 2 parallel queries after auth check. No N+1.

#### Activity Feed (`GET /api/dashboard/recent-activity`)

```
SELECT * FROM activity ORDER BY timestamp DESC LIMIT 20
```

**Issue identified (low priority):** No index on `timestamp`. At scale this becomes a seq scan + sort. An index on `activity(timestamp DESC)` would convert this to an index scan. **Not added in this chunk — documented only.**

### Findings Summary

| Issue | Severity | Action |
|-------|----------|--------|
| Course report JS per-student filter | Low | Document only — safe up to ~500 students |
| Activity feed: no index on `timestamp` | Low | Document only — seq scan + sort at scale |
| Progress routes: missing deletedAt DB filter | **Medium** | **Fixed this sprint** |
| Timeline route: unnecessary full-table fetch | Low | **Fixed this sprint** (DB filter added) |

---

## 6. Schema Drift Review

### Drift Check Result

```
drizzle-kit generate
→ "No schema changes, nothing to migrate 😴"
```

**Schema, migration snapshot, and database are fully aligned.**

### Fix Applied: drizzle.config.ts path correction

The `drizzle-kit generate` command was failing with:
```
ENOENT: no such file or directory
path: './/home/runner/workspace/lib/db/migrations/meta/0000_snapshot.json'
```

**Root cause:** `path.join(__dirname, "./migrations")` produced an absolute path. drizzle-kit prepended `./` to the absolute path, creating the malformed `.//home/runner/...` string.

**Fix:** Switched to relative paths in `drizzle.config.ts`:
```typescript
schema: "./src/schema/index.ts",  // was: path.join(__dirname, "./src/schema/index.ts")
out: "./migrations",               // was: path.join(__dirname, "./migrations")
```

drizzle-kit always runs from the package directory so relative paths are correct and portable.

---

## 7. Testing Results

### Schema Smoke Test

```
schema-smoke-test: verifying live DB schema against ORM definitions…

  ✓  users (including push_token)
  ✓  students
  ✓  courses
  ✓  assignments
  ✓  notes
  ✓  assessments
  ✓  activity
  ✓  roles
  ✓  permissions
  ✓  role_permissions
  ✓  user_roles
  ✓  student_guardians
  ✓  course_enrollments
  ✓  rbac_version
  ✓  announcements

schema-smoke-test: 15 passed, 0 failed
schema-smoke-test: all checks passed — DB schema is in sync.
```

### Migration Validation

```
drizzle-kit migrate
→ migrations applied successfully!

drizzle.__drizzle_migrations:
id=1 | hash=9dcbbb41f6096f22... | applied=2026-07-06
```

### Database Integrity Tests

| Test | Result |
|------|--------|
| FK: invalid studentId on assignment | ✅ Rejected |
| FK: invalid courseId on assignment | ✅ Rejected |
| FK: invalid studentId on assessment | ✅ Rejected |
| FK: invalid courseId on assessment | ✅ Rejected |
| CASCADE: delete student removes assignments + assessments | ✅ Confirmed |
| RESTRICT: delete course blocked by active enrollment | ✅ Confirmed |

**6/6 passed.**

---

## 8. Production Certification Verdict

### ✅ GO FOR PRODUCTION

| Certification Area | Finding | Status |
|-------------------|---------|--------|
| FK audit — all 43 constraints | Schema = DB = Migration | ✅ PASS |
| Index coverage — all 23 indexes | All present, partial indexes correct | ✅ PASS |
| Soft-delete consistency | All 6 soft-deletable tables use deletedAt+deletedBy | ✅ PASS |
| Soft-delete route filtering | 2 gaps fixed in progress routes | ✅ FIXED |
| FK enforcement tests | All 4 invalid-FK inserts rejected | ✅ PASS |
| CASCADE delete behavior | Student delete cascades assignments + assessments | ✅ PASS |
| RESTRICT delete behavior | Course delete blocked by active enrollment | ✅ PASS |
| Query scalability | No N+1 on any hot path; minor JS-loop issue documented | ✅ ACCEPTABLE |
| Schema drift check | "No schema changes, nothing to migrate" | ✅ PASS |
| drizzle.config.ts | Path bug fixed; generate now works correctly | ✅ FIXED |
| Schema smoke test | 15/15 tables verified | ✅ PASS |

### Remaining Low-Priority Items (not blocking production)

1. **Activity feed timestamp index** — `SELECT … ORDER BY timestamp DESC LIMIT 20` will seq-scan at scale. Add `ix_activity_timestamp` when activity table exceeds ~10,000 rows.
2. **Course report JS aggregation** — Per-student filter loop is safe up to ~500 enrolled students per course. Switch to SQL GROUP BY when approaching that scale.

---

## 9. Files Modified

| File | Change |
|------|--------|
| `artifacts/api-server/src/routes/students.ts` | Added `isNull(deletedAt)` DB filter to `/progress` and `/progress/timeline` sub-routes |
| `lib/db/drizzle.config.ts` | Switched from `path.join(__dirname, ...)` to relative paths to fix `drizzle-kit generate` |
| `lib/db/DATABASE_CERTIFICATION.md` | This document |
