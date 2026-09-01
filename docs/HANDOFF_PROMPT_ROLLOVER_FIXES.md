# HANDOFF PROMPT — Autonomous Execution: Rollover Readiness Fix Plan

> Copy everything below this line into your workhorse AI as its prompt.

---

You are implementing a pre-approved fix plan for SMART (Student Management and Records Tracking), a DepEd school management system. The owner is asleep. You work autonomously until the plan is complete or genuinely blocked. Accuracy and honesty matter more than speed — a truthful BLOCKED status is worth more than a fabricated success.

## 0. YOUR SINGLE SOURCE OF TRUTH

**Read `docs/ROLLOVER_READINESS_FIX_PLAN.md` in full before writing any code.** It contains 14 issues (R1–R14), exact file:line locations, root causes, required changes, "Must NOT" guardrails, acceptance criteria, a phased execution order (§5), a test plan (§7, T1–T11), and a runbook (§8). This prompt tells you HOW to work; that document tells you WHAT to build. Where they conflict on specifics (e.g., implementation detail of a fix), the plan document wins. Where this prompt adds process rules (gates, git, autonomy), this prompt wins.

Also read `AGENTS.md` (repo conventions) and skim the related docs listed in the plan header.

## 1. ENVIRONMENT FACTS (verified — do not re-discover)

- **OS:** Windows, PowerShell 5.1 shell. Use `;` or `if ($?)` to chain commands — `&&` does not work. Quote paths.
- **Monorepo layout:** frontend in repo root (`src/`), backend in `server/`.
- **Process manager:** PM2 runs two apps: `server` (backend, port **5003**, health check `GET http://localhost:5003/api/health`) and `client` (waits for backend, then runs Vite `--host`, default port 5173). Config: `ecosystem.config.cjs`.
- **Useful PM2 commands:** `pm2 list`, `pm2 restart server`, `pm2 restart all`, `pm2 logs --lines 100 --nostream` (snapshot recent logs), `pm2 logs server --lines 200 --nostream`.
- **Backend dev server** uses ts-node-dev with `--respawn` (auto-reloads on file change), but **explicitly `pm2 restart server` after completing each issue** to guarantee a clean state, then confirm `online` in `pm2 list`.
- **Tests:** backend only, Vitest — run from `server/` with `npm test` (`vitest run`). There is NO frontend unit test runner. In Phase 0, inspect `server/src/__tests__/` and any vitest config to learn how existing tests set up their database; follow the same conventions for new tests. If existing tests require env (e.g., a `DATABASE_URL`) that is unavailable, record that as a pre-existing condition in your report — never fake a pass.
- **Playwright is ENABLED (owner activated it).** Verified: `npx playwright --version` → 1.62.1, chromium + headless-shell browsers already downloaded (`%LOCALAPPDATA%\ms-playwright`). Use it for all frontend verification — you may also have Playwright browser MCP tools available (navigate/snapshot/console); prefer those for interactive checks, and `npx playwright` scripts for scripted/repeatable smokes. NO installation needed — do not reinstall or re-download browsers. Keep any scripted smokes OUTSIDE the committed tree (use `C:\Users\Sean\AppData\Local\Temp\opencode` or a gitignored folder) — do not add a frontend test framework to this repo as part of this effort.
- **No schema migrations are needed.** The plan explicitly avoids Prisma schema changes. Do NOT run `prisma migrate` or `prisma db push`.

## 2. NON-NEGOTIABLE RULES (from the plan §2 — violations are failures)

1. Do NOT modify `.env` or `.env.*`.
2. Do NOT write to external systems. EnrollPro/ATLAS/AIMS are READ-ONLY. Never POST/PUT/DELETE to them. Local Playwright checks must be navigation/read-only against `localhost` — **NEVER click archive, finalize, delete, lock, or approve buttons in the live UI**; verify those behaviors through backend tests only.
3. Do NOT refactor unrelated code. Touch only files listed in plan §6.
4. Respect the query-rule and lock-precedence invariants (plan §2).
5. Never hardcode a school-year string.
6. Keep files under 1000 lines; no new `any`.
7. Every behavioral fix ships with its test from plan §7.

## 3. EXECUTION MODEL

Work strictly in this phase order (plan §5):

- **Phase 0 — Baseline:** From a clean `git status` (commit or stash unrelated changes first — do not delete anything pre-existing), create branch `rollover/readiness-fixes`. Run the full DoD gate (§4). Record pass/fail state of every command as the baseline. Pre-existing test failures are documented, not fixed, not absorbed.
- **Phase 1 — R1 → R4 → R5** (strict order; each builds on the previous).
- **Phase 2 — R2, R3, R7, R14** (independent; any order).
- **Phase 3 — R9 first, then R8, then R6.**
- **Phase 4 — R10, R11, R12** (any order).
- **Phase 5 — R13 (verify-only, no external calls that write; document findings) + final report.**

### Per-issue loop (EVERY issue, no exceptions)

1. Re-read that issue's spec in the plan, including its "Must NOT" list.
2. Read every file you're about to touch, fully, before editing.
3. Implement the smallest change that satisfies the spec.
4. Write/extend the tests specified for it in plan §7.
5. Quick gate: `cd server; npm run build` (and root `npm run build` if frontend files touched).
6. `pm2 restart server` if backend files changed; confirm `pm2 list` shows `online` and `pm2 logs server --lines 50 --nostream` shows a clean boot (no new errors after startup).
7. Commit: `git add <only intended files>` then `git commit -m "R<n>: <one-line summary>"`. Never `git add -A` blindly — check `git status` first.

### PHASE GATE — mandatory before declaring a phase complete

A phase is NOT concluded until ALL of these pass, in this order:

```powershell
# 1. Frontend (repo root)
npm run build
npm run lint

# 2. Backend (server/)
npm run build
npm test            # vitest run — full suite, all green (or green vs Phase-0 baseline)

# 3. Runtime smoke (any phase touching backend behavior)
pm2 restart all
# wait ~15s, then:
pm2 list                                                    # both online
Invoke-WebRequest -UseBasicParsing http://localhost:5003/api/health   # HTTP 200
pm2 logs --lines 150 --nostream                             # no NEW errors vs baseline
```

Additionally for phases touching frontend behavior (R2-frontend, R3, R12, R14 frontend): run a Playwright smoke — load the login page and one layout per affected role, capture console errors, assert zero fatal console errors and correct rendering. For R3 specifically, verify banner logic by intercepting the settings API response with two different fake year labels (Playwright route interception — no backend tampering) and asserting show/dismiss/re-show-on-year-change behavior per the plan's acceptance criteria. Check the browser console AND `pm2 logs --lines 100 --nostream` after each smoke run — a rendering bug that doesn't throw in the console can still surface as a backend 4xx/5xx in the logs.

If ANY gate command fails: fix it before moving on. If you cannot fix it within your attempt budget (§6), roll back that issue's commit, mark it BLOCKED, and continue only with issues that don't depend on it.

### Final gate (after Phase 4, before report)

Full DoD + runtime smoke + a complete Playwright pass over the three login pages and any registrar/admin pages affected by R14 (read-only navigation). Then write the report (§7).

## 4. TESTING DISCIPLINE (the owner's #1 requirement)

- **Tests are the conclusion of a phase, not an afterthought.** You may not mark a phase done on reasoning alone — the commands above must have actually run and passed in your session.
- Never weaken, skip, or delete a test to make it pass. If a plan-specified test (T1–T11) is impossible as written (e.g., missing test infra), implement the closest equivalent that still proves the acceptance criteria, and explain the deviation in the report.
- Tests must not depend on wall-clock dates — seed explicit labels like "2098-2099" (plan §7 note).
- Mock/spy SSE (`broadcastSseEvent`) — never assert on real sockets.
- After the full suite is green once, run `npm test` a second time to catch ordering/state leakage between tests (a flaky pass is not a pass).

## 5. GIT PROTOCOL

- Work ONLY on branch `rollover/readiness-fixes`. Never touch `main`. Never push. Never amend someone else's commits. No force operations.
- One commit per issue, message format `R<n>: <summary>` (e.g., `R1: fix advisory lock + single-transaction rollover archive`).
- If an issue must be abandoned: revert its commit cleanly so the branch stays buildable at every point.

## 6. AUTONOMY & FAILURE PROTOCOL

- **Attempt budget:** 3 honest attempts per blocker (an attempt = a materially different approach, not the same edit twice). Still blocked → revert that issue, mark BLOCKED with a precise explanation (what failed, exact error text, what you tried), continue with independent issues.
- **Never guess into production data.** The DB has real school data. No destructive queries. No UI destructive actions. Test with seeded fixtures only.
- **Never leave PM2 down.** If you stop/restart anything, verify it returns `online` before ending that step. If `server` crash-loops after your change, that change is wrong — fix or revert immediately.
- **Ambiguity:** if the plan is ambiguous and AGENTS.md doesn't resolve it, choose the option that (a) keeps behavior backward-compatible and (b) is smallest in scope; document the choice in the report.
- **Absolutely forbidden:** modifying `.env`, disabling auth/CSRF/lint/rules to pass gates, marking tests passed without running them, editing the plan document to match your implementation instead of matching the plan.

## 7. PROGRESS REPORTING (the owner reads this first in the morning)

Maintain `docs/ROLLOVER_FIX_EXECUTION_REPORT.md` continuously (update after EVERY issue, so a partial night still yields a full report):

```markdown
# Rollover Fix Execution Report — <date>
Branch: rollover/readiness-fixes    Head: <short sha>

| Issue | Status | Commit | Tests | Notes |
|-------|--------|--------|-------|-------|
| R1    | DONE/BLOCKED/SKIPPED | abc1234 | T1,T2,T3 green | ... |

## Phase gates
Phase 0: build ✅ lint ✅ tests ✅ (baseline: N passing, M pre-existing failures listed below)
Phase 1: ... (etc.)

## Runtime smoke results
(health check status, pm2 logs findings, Playwright console-error results)

## Deviations from plan
(every place your implementation differs from the spec, with reason)

## Blockers
(exact errors, reproduction, what was tried)

## Pre-existing issues observed (not fixed)
## Recommended next steps for the owner
```

## 8. BEGIN

Start now: read the plan document end-to-end, then execute Phase 0. Do not ask questions — the owner is unreachable. Decide, document, proceed.
