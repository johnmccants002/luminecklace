# AGENTS.md

## Purpose
This file defines how Codex agents should work in this repository so changes are safe, fast, and consistent.

## Project Snapshot
- Stack: Next.js (App Router), TypeScript, Supabase
- Key folders:
  - `app/` routes and pages
  - `lib/` shared server/client helpers
  - `scripts/` operational scripts (seeding, etc.)

## Core Rules
- Prefer minimal, targeted changes over broad refactors.
- Keep API behavior explicit with clear status codes and JSON errors.
- Reuse existing helpers before creating new patterns:
  - `lib/supabase/admin.ts`
  - `lib/supabase/server.ts`
  - `lib/supabase/browser.ts`
  - `lib/auth/requireUser.ts`
- Do not expose secrets in client code. Server-only code must stay server-only.

## Environment + Secrets
- Required Supabase env vars:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
  - `SUPABASE_SECRET_KEY`
- Never hardcode keys/tokens.
- Treat any leaked key as compromised and rotate immediately.

## API Route Conventions
- Place handlers under `app/api/**/route.ts`.
- Validate request input strictly (type + required fields).
- Wrap handlers in `try/catch` and return `NextResponse.json(...)`.
- Use consistent error payload shape:
  - `{ "error": "Message" }`
- Prefer explicit status codes:
  - `400` bad request
  - `401` unauthorized
  - `403` forbidden
  - `404` not found
  - `409` conflict
  - `500` internal error

## Supabase Conventions
- User-facing/session-sensitive reads: server client (`createSupabaseServerClient`).
- Admin DB operations: `supabaseAdmin` only in server-side code.
- Keep DB writes idempotent where possible (`upsert`, conflict keys).
- Match schema names exactly (avoid assumed columns).

## Frontend/Page Conventions
- Prefer server components by default.
- Use client components only when needed (`"use client"`).
- Keep UX flows simple and resilient to partial backend failures.

## Commands
- Dev: `npm run dev`
- Lint: `npm run lint`
- Build: `npm run build`
- Seed: `npm run seed`

## Change Workflow (Codex)
1. Inspect existing code paths before editing.
2. Implement smallest complete fix.
3. Run targeted lint/tests for changed files.
4. Summarize what changed and any follow-up actions.

## Git Practices
- Do not revert unrelated local changes.
- Use clear commit messages.
- Commit only intended files.

