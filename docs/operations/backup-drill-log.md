# Backup Drill Log — Classmate Connect

Monthly DR simulation results. See §7 of RUNBOOK-BACKUP.md for the drill procedure.

Format: newest entries first.

---

## 2026-06-28 — Sprint 10 Chunk 7 (initial DR validation)

**Operator:** Automated (agent)
**Environment:** Development (Replit)
**Backup taken:** `classmate_20260628_*_development.dump` + `.json` sidecar
**Restore mode:** Full DR — auto temp database (`RESTORE_CREATE_DB=true`)

**Backup file:** `classmate_20260628_181145_development.dump` (56 KB)
**Sidecar file:** `classmate_20260628_181145_development.json`

**Integrity check results:**

| Check | Expected | Actual | Result |
|-------|----------|--------|--------|
| Tables present | 11 | 11 | PASS |
| Foreign keys | ≥ 36 | 36 | PASS |
| ix_* indexes | ≥ 18 | 18 | PASS |
| Row counts vs sidecar | match | match | PASS |

**Row counts restored:**

| Table | Rows |
|-------|------|
| activity | 13 |
| announcements | 4 |
| assessments | 11 |
| assignments | 14 |
| course_enrollments | 2 |
| courses | 10 |
| notes | 11 |
| session | 76 |
| student_guardians | 0 |
| students | 8 |
| users | 7 |

**Overall result:** PASS ✓

**Drill duration:** ~45 seconds (small dev dataset)

**Notes:**
- First operational DR test for this codebase
- `rolcreatedb = true` confirmed on the application DB user — temp DB creation works
- Sidecar uses exact `COUNT(*)` per table (not `pg_stat_user_tables.n_live_tup` which can be stale before autovacuum)
- pg_restore completed cleanly — no warnings in this environment
- Temp database `classmate_dr_1782670316236` was created and dropped automatically
- Verify-only mode also confirmed PASS against live DATABASE_URL

**Signed off:** Sprint 10 Chunk 7 delivery

---

<!-- Template for future entries:

## YYYY-MM-DD — Monthly drill

**Operator:**
**Environment:**
**Backup taken:**
**Restore mode:**

**Integrity check results:**

| Check | Expected | Actual | Result |
|-------|----------|--------|--------|
| Tables present | 11 | | |
| Foreign keys | ≥ 36 | | |
| ix_* indexes | ≥ 18 | | |
| Row counts (sidecar) | match | | |

**Overall result:**

**Drill duration:**

**Notes:**

**Signed off:**

-->
