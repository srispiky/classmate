---
name: NSSM AppEnvironmentExtra password encoding
description: NSSM does not percent-decode environment variable values; pg URL parser does — causing a mismatch for passwords with @ or other special chars.
---

## Rule
When setting DATABASE_URL in NSSM's AppEnvironmentExtra, **use a password with no special characters** (no `@`, `%`, `+`, etc.). Do not rely on percent-encoding.

## Why
NSSM stores the AppEnvironmentExtra string verbatim in the Windows registry. The Node.js pg library URL-parses DATABASE_URL using the WHATWG URL parser, which decodes `%40` → `@`. However, when pg's bundled `pg-connection-string` parses the decoded URL, some versions fail to authenticate if the password contains `@` that was stored as `%40` — the bundled build strips or double-decodes, causing SCRAM-SHA-256 auth to fail silently as a "Failed query" from Drizzle ORM.

The actual failure symptom is Drizzle throwing "Failed query: select ... from users where username = $1 limit $2" with no further detail — misleadingly looking like a permissions error, not an auth/connection error.

## How to apply
- In `classmate-upgrade.sql`: `ALTER USER classmate_user PASSWORD 'ClassmateDB2026';` (no special chars)
- In `Upgrade-Classmate.ps1`: hardcode `DATABASE_URL=postgresql://classmate_user:ClassmateDB2026@localhost:5432/classmate_db`
- In NSSM AppEnvironmentExtra: set `DATABASE_URL` with a plain alphanumeric+digits password only

## Confirmed working setup (Windows Server, PostgreSQL 18, NSSM)
- classmate_user password: `ClassmateDB2026`
- DATABASE_URL: `postgresql://classmate_user:ClassmateDB2026@localhost:5432/classmate_db`
- NODE_ENV: `production` (required — pino-pretty worker thread crashes on Windows without it)
- PORT: `3001` (8080 occupied by EDB PEM Apache)
