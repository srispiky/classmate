-- Migration: 0002_add_push_token
--
-- Adds push_token column to users table to support Expo push notifications
-- for parent users. The column is nullable; non-parent users simply never
-- populate it.
--
-- Idempotent: safe to run against a database that already has the column.

ALTER TABLE users ADD COLUMN IF NOT EXISTS push_token text;
