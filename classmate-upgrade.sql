-- ============================================================
-- Classmate Upgrade Script
-- Run as: psql -U classmate_user -d classmate_db -f classmate-upgrade.sql
-- ============================================================

-- 1. Users table (login accounts)
CREATE TABLE IF NOT EXISTS users (
    id              SERIAL PRIMARY KEY,
    username        TEXT NOT NULL UNIQUE,
    password_hash   TEXT NOT NULL,
    display_name    TEXT NOT NULL,
    role            TEXT NOT NULL DEFAULT 'teacher',
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 2. Session table (express-session storage)
CREATE TABLE IF NOT EXISTS "session" (
    sid     VARCHAR NOT NULL PRIMARY KEY,
    sess    JSON NOT NULL,
    expire  TIMESTAMP(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");

-- 3. Default admin user
--    Username : admin
--    Password : classmate123
--    (stored as AES-256-GCM encrypted bcrypt hash — change after first login)
INSERT INTO users (username, password_hash, display_name, role)
VALUES (
    'admin',
    '96gHmYmfl7atbO36vcl56qKK/G57OLMd+mGCDvoCbWCIQNdgox/UUjl8H+1iISe5nsQKB+i6ZwiRdoHbs7JfGHhWHQarJFJB/yAiKee55NT2N9nI3uak+w==',
    'Administrator',
    'admin'
)
ON CONFLICT (username) DO UPDATE
    SET password_hash = EXCLUDED.password_hash,
        display_name  = EXCLUDED.display_name,
        is_active     = TRUE;

SELECT 'Upgrade complete.' AS status;
