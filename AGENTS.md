# AGENTS.md — The AI Guardrails

> This file MUST be read by the AI before writing a single line of code.
> The rules here are binding. If they conflict with chat instructions,
> this file wins unless the user explicitly overrides it.

## 1. General Principles

- Don't guess: if a requirement is ambiguous, ASK first or write down
  your assumptions explicitly in `TASK_INSTRUCTION.md` before proceeding.
- Small changes > big changes. One PR/phase = one goal.
- Don't refactor files unrelated to the current task.
- Comment and commit language: follow the existing repo (default: English).

## 2. Packages & Dependencies

- **FORBIDDEN** to install new packages without user approval.
- If a new package is needed: explain why, compare 2 alternatives,
  wait for the user to choose.
- Don't upgrade major versions of dependencies unless asked.
- Always pin versions in `package.json` / `requirements.txt` / equivalent.

## 3. TypeScript (adapt if not using TS)

- **FORBIDDEN** to use the `any` type. Use `unknown` + type guards,
  or define proper types.
- Enable `strict: true` in `tsconfig.json`.
- No `// @ts-ignore`. If stuck, use `@ts-expect-error` with a clear
  comment explaining why.
- All public functions must have typed parameters and return types.

## 4. Code Style

- Follow the repo's existing linter/formatter (ESLint, Prettier, Ruff, etc).
- If none exists, propose setting one up before writing code.
- Functions max ~50 lines. Longer than that = split into smaller functions.
- Descriptive variable/function names, no cryptic abbreviations.
- No dead code (commented-out code) and no leftover debugging
  `console.log` in the final result.

## 5. Action Boundaries

- **FORBIDDEN**: deleting files / database migrations without explicit confirmation.
- **FORBIDDEN**: writing credentials, tokens, or API keys in code.
- **FORBIDDEN**: changing CI/CD, Dockerfile, or infra unless asked.
- Read `SECURITY.md` before touching auth, payments, or user data.
- Read `ARCHITECTURE.md` before creating new files/folders.

## 7. Project Adaptations (Chess + UNO Arena, 2026-10-05)

Template ini dipakai untuk proyek game multiplayer kecil. Adaptasi yang disetujui misi (via Arona/Sensei):
- **Plain JS, bukan TS**: §3 diadaptasi (tanpa build step agar mudah dijalankan Sensei).
- **`ws` diizinkan**: misi menyebut eksplisit "pakai `ws`, ringan" = user approval (override §2).
- **Tanpa ESLint**: diganti `node --check` untuk semua file JS (zero-config).
- **Komentar kode English; teks UI Bahasa Indonesia** (misi).
- **Tanpa Zod/Yup**: validasi terpusat di `game/validate.js` + engine (lihat SECURITY.md §2).
- Fungsi tetap diusahakan ≤ ~50 baris; engine catur pengecualian seperlunya (kompleksitas aturan) dengan sub-fungsi kecil.

## 6. How to Work per Task

1. Read `TASK_INSTRUCTION.md` for the phase being worked on.
2. Work ONLY on that phase's checklist items.
3. When done: run lint + tests (see `TESTING.md`).
4. Report: files changed, tests run, and what's still unfinished.
5. Don't move to the next phase without user confirmation.
