# SLOT Engineering Nigeria Limited — BizCore ERP v3.2

React + Vite · Supabase (PostgreSQL) · localStorage offline backup

---

## Architecture

```
Browser
  ├── localStorage  ← always written first (instant, offline)
  └── Supabase      ← synced in background (real-time, cloud)
       └── PostgreSQL (company_data table, JSONB columns)

Offline queue: changes saved locally and auto-pushed on reconnect.
Real-time: another device saving triggers live update in this window.
```

---

## Quick Start

```bash
npm install
cp .env.example .env   # fill in your Supabase keys
npm run dev
```

---

## Testing

A smoke test suite (Vitest + React Testing Library) covers the critical
flows that have broken in production before — Add Staff (Contract Staff
and SLOT Staff), Create Invoice, Create Bill + Record Payment, Trial
Balance/Balance Sheet balancing, and Add Purchase Order (Client and SLOT
types). **Run this before every deploy:**

```bash
npm test          # run once
npm run test:watch  # re-run on file changes while developing
```

If a change breaks one of these flows, the test fails locally instead of
in production. This is not full coverage of the app — it's specifically
the handful of flows with a track record of breaking, kept intentionally
small so it's actually run every time rather than skipped for being slow.
Extend it as new critical flows are added or as new bugs are found and
fixed — a fixed bug without a regression test is a bug that can come back.

---

## 1. Supabase Setup (one-time, ~5 minutes)

### Create project
1. Go to [supabase.com](https://supabase.com) → New Project
2. Name it e.g. `bizcore-slot`
3. Choose a strong database password (save it)
4. Select region closest to Nigeria (e.g. `eu-west-1` London or `us-east-1`)

### Create the table
Open **SQL Editor** in your Supabase dashboard and run:

```sql
-- Main data table (one row per company)
CREATE TABLE company_data (
  id          TEXT PRIMARY KEY,
  db          JSONB        DEFAULT '{}',
  acct_data   JSONB        DEFAULT '{}',
  settings    JSONB        DEFAULT '{}',
  activity    JSONB        DEFAULT '[]',
  updated_at  TIMESTAMPTZ  DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE company_data ENABLE ROW LEVEL SECURITY;

-- Policy: allow all (app manages its own auth)
-- For production you should restrict this to your domain
CREATE POLICY "Allow all operations"
  ON company_data
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Enable real-time for this table
ALTER PUBLICATION supabase_realtime ADD TABLE company_data;
```

### Get your keys
Supabase Dashboard → Settings → API:
- **Project URL** → `VITE_SUPABASE_URL`
- **anon / public key** → `VITE_SUPABASE_ANON_KEY`

### Add to .env
```
VITE_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6...
VITE_COMPANY_DOC=slot-engineering-nigeria
VITE_STORAGE_PREFIX=bc_
```

---

## 2. Deploy — Firebase Hosting (Recommended)

You already have a Firebase project (`yemicoreerp`) which you can use for **hosting only** — the database is now Supabase.

```bash
npm install -g firebase-tools
firebase login
npm run build
firebase deploy --only hosting
```

Live at: **https://yemicoreerp.web.app**

---

## 3. Deploy — Netlify (Easiest)

**Option A — Drag & Drop:**
```bash
npm run build
# Drag the dist/ folder to netlify.com
```

**Option B — Git + Auto Deploy:**
1. Push to GitHub
2. Connect repo in Netlify dashboard
3. Build command: `npm run build`
4. Publish directory: `dist`
5. Add environment variables in Netlify → Site Settings → Environment Variables

---

## 4. Deploy — Vercel

```bash
npm install -g vercel
npm run build
vercel --prod
# Add env vars in Vercel dashboard
```

---

## Sync Behaviour

| Scenario | What happens |
|---|---|
| Online, Supabase up | Writes go to localStorage + Supabase simultaneously |
| Online, Supabase down | Writes go to localStorage, queued for retry |
| Offline | Writes go to localStorage only, auto-synced on reconnect |
| Another device saves | Real-time push updates current browser automatically |
| First load | Loads Supabase first, falls back to localStorage silently |

The topbar shows a live status badge: **Live** · **Offline** · **Syncing…** · **Local**

---

## Default Login

| Username | Password | Role  |
|----------|----------|-------|
| admin    | admin123 | Admin |

**Change admin password immediately in Users module.**

---

## Modules

Contract Staff (NLNG) · Company Staff · Procurement · Inventory ·
Terminal Operations · Fleet & Vehicles · Invoices · Petty Cash ·
Requests · GRN · Fixed Assets · WHT · Accounting · Approvals ·
Analytics · Users · Settings · Backup & Restore

---

Built with React 19 · Vite 8 · Supabase 2 · Recharts 3 · Lucide React
