-- Migration: 0001_integrity_constraints
-- Created: Sprint 9 Chunk 3
--
-- Adds missing foreign key constraints and query-critical indexes.
-- All statements are idempotent: safe to run against a database that
-- was previously managed by "drizzle-kit push".
--
-- FK constraints: use a DO block to skip if the constraint already exists.
-- Indexes: use CREATE INDEX IF NOT EXISTS.
--
-- Affected tables: assignments, assessments, announcements, notes, courses, activity


-- ── Foreign Keys: assignments ─────────────────────────────────────────────────

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'assignments_course_id_courses_id_fk'
  ) THEN
    ALTER TABLE assignments
      ADD CONSTRAINT assignments_course_id_courses_id_fk
      FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'assignments_student_id_students_id_fk'
  ) THEN
    ALTER TABLE assignments
      ADD CONSTRAINT assignments_student_id_students_id_fk
      FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE;
  END IF;
END $$;


-- ── Foreign Keys: assessments ─────────────────────────────────────────────────

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'assessments_course_id_courses_id_fk'
  ) THEN
    ALTER TABLE assessments
      ADD CONSTRAINT assessments_course_id_courses_id_fk
      FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'assessments_student_id_students_id_fk'
  ) THEN
    ALTER TABLE assessments
      ADD CONSTRAINT assessments_student_id_students_id_fk
      FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE;
  END IF;
END $$;


-- ── Foreign Keys: announcements ───────────────────────────────────────────────

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'announcements_course_id_courses_id_fk'
  ) THEN
    ALTER TABLE announcements
      ADD CONSTRAINT announcements_course_id_courses_id_fk
      FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE;
  END IF;
END $$;


-- ── Foreign Keys: notes ───────────────────────────────────────────────────────

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'notes_course_id_courses_id_fk'
  ) THEN
    ALTER TABLE notes
      ADD CONSTRAINT notes_course_id_courses_id_fk
      FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE;
  END IF;
END $$;


-- ── Indexes: assignments ──────────────────────────────────────────────────────
-- Benefit: teacher/student portal list queries filtered by student_id or course_id.
-- Benefit: soft-delete WHERE deleted_at IS NULL scans.

CREATE INDEX IF NOT EXISTS ix_assignments_student_id ON assignments (student_id);
CREATE INDEX IF NOT EXISTS ix_assignments_course_id ON assignments (course_id);
CREATE INDEX IF NOT EXISTS ix_assignments_deleted_at ON assignments (deleted_at);


-- ── Indexes: assessments ──────────────────────────────────────────────────────
-- Benefit: teacher/student portal list queries filtered by student_id or course_id.
-- Benefit: progress analytics aggregation and timeline queries.

CREATE INDEX IF NOT EXISTS ix_assessments_student_id ON assessments (student_id);
CREATE INDEX IF NOT EXISTS ix_assessments_course_id ON assessments (course_id);
CREATE INDEX IF NOT EXISTS ix_assessments_deleted_at ON assessments (deleted_at);


-- ── Indexes: announcements ────────────────────────────────────────────────────
-- Benefit: student/teacher portal list queries filtered by course_id.

CREATE INDEX IF NOT EXISTS ix_announcements_course_id ON announcements (course_id);
CREATE INDEX IF NOT EXISTS ix_announcements_deleted_at ON announcements (deleted_at);


-- ── Indexes: notes ────────────────────────────────────────────────────────────
-- Benefit: student/teacher portal list queries filtered by course_id.

CREATE INDEX IF NOT EXISTS ix_notes_course_id ON notes (course_id);
CREATE INDEX IF NOT EXISTS ix_notes_deleted_at ON notes (deleted_at);


-- ── Indexes: courses ──────────────────────────────────────────────────────────
-- Benefit: teacher-scoped course queries (WHERE teacher_id = ?).
-- Benefit: soft-delete exclusion filters across dashboard and portal.

CREATE INDEX IF NOT EXISTS ix_courses_teacher_id ON courses (teacher_id);
CREATE INDEX IF NOT EXISTS ix_courses_deleted_at ON courses (deleted_at);


-- ── Indexes: activity ─────────────────────────────────────────────────────────
-- Benefit: dashboard recent-activity queries filtered by course_id.

CREATE INDEX IF NOT EXISTS ix_activity_course_id ON activity (course_id);
