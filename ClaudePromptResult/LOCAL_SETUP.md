# Classmate — Local Setup Guide

## Prerequisites

Install these on your laptop before starting:

- **Node.js 20+** — https://nodejs.org
- **pnpm** — `npm install -g pnpm`
- **PostgreSQL 15+** — https://www.postgresql.org/download/

---

## Step 1: Download the Code

In Replit, click the three-dot menu (⋯) in the top right and choose **"Download as zip"**.
Unzip it to a folder on your laptop, e.g. `~/classmate`.

---

## Step 2: Set Up the Database

Open a terminal and run:

```bash
# Start PostgreSQL (Mac with Homebrew)
brew services start postgresql

# Or on Linux
sudo systemctl start postgresql

# Create the database
createdb classmate_db

# Import the data (use the classmate_db_export.sql file you downloaded)
psql classmate_db < classmate_db_export.sql
```

---

## Step 3: Configure Environment Variables

Create a file called `.env` in the root of the project folder:

```bash
# Root .env
DATABASE_URL=postgresql://localhost:5432/classmate_db
```

Also create `.env` files for each service:

**`artifacts/api-server/.env`**
```
PORT=8080
DATABASE_URL=postgresql://localhost:5432/classmate_db
NODE_ENV=development
SESSION_SECRET=your-random-secret-here
```

**`artifacts/classmate/.env`**
```
PORT=3000
BASE_PATH=/
```

---

## Step 4: Install Dependencies

```bash
cd ~/classmate
pnpm install
```

---

## Step 5: Run the App

Open **two terminal windows**:

**Terminal 1 — API Server:**
```bash
pnpm --filter @workspace/api-server run dev
```
The API will be available at http://localhost:8080

**Terminal 2 — Frontend:**
```bash
pnpm --filter @workspace/classmate run dev
```
The app will be available at http://localhost:3000

---

## Step 6: Open in Browser

Go to **http://localhost:3000** and you should see the Classmate dashboard.

---

## Useful Commands

```bash
# Push DB schema changes (if you edit the schema)
pnpm --filter @workspace/db run push

# Regenerate API types (if you edit the OpenAPI spec)
pnpm --filter @workspace/api-spec run codegen

# Build everything
pnpm run build
```

---

## Troubleshooting

- **"DATABASE_URL must be set"** — Make sure your `.env` file in `artifacts/api-server/` is correct.
- **PostgreSQL connection refused** — Make sure PostgreSQL is running (`pg_isready` to check).
- **Port already in use** — Change the PORT in the `.env` file to a different number.
- **pnpm not found** — Run `npm install -g pnpm` first.
