# Plan: EnrollPro Rollover Detection & Notification

Status: **PLANNING — for approval. No code changes yet.**
Date: 2026-09-29
Related: `docs/ENROLLPRO-SCHOOL-YEAR-LIFECYCLE.md`, `docs/ROLLOVER_READINESS_PLAN.md`,
`docs/SYNC_OUTAGE_GUARDRAIL_FIX_PLAN.md`

## Question

Do we need an event broker (Kafka/RabbitMQ/etc.)? How does SMART know when EnrollPro suddenly
rolls over to a new school year? What should we add?

## Answer: no broker

- The EnrollPro↔SMART integration is **read-only, low-volume, and already pull-based** with
  idempotent reconciliation and stale-marking. That is the resilient pattern for this scale.
- EnrollPro **has no cross-service event bus**. Its SSE stream is explicitly browser-only
  (`ENROLLPRO-SCHOOL-YEAR-LIFECYCLE.md` §Classes Ongoing), and its webhook is documented as a
  best-effort *refresh hint*, not a data channel.
- A broker would only reduce notification latency, and it adds infra/ops failure modes. A
  60-second watchdog poll + the documented webhook receiver achieves the same at near-zero cost.

## Current detection (verified in code 2026-09-29)

| Mechanism | Where | Latency |
|---|---|---|
| Unified sync cycle — first step resolves EnrollPro active year live, then `ensureSchoolYearFromEnrollPro` detects a year change and runs `handleYearChangeRollover` | `syncCoordinator.ts:51-58,574-618`; `enrollproSync.ts:169-190`; `schoolYearResolver.ts:114-215`; `rollover.ts:240` | ≤ 5 min (default `SYNC_INTERVAL_MS=300000`) |
| EnrollPro reconnect guard — drops `enrollpro:schoolYear:` cache + immediate sync when EP comes back online | `syncCoordinator.ts:36-44` | seconds after outage recovery |
| Webhook receiver `POST /api/integration/enrollpro-webhook` | **NOT IMPLEMENTED** (no route; only a CSRF-exempt path pattern in `middleware/csrf.ts:62`) | n/a |
| Rollover failure handling (R0a) — archive error reverts active year, audit log, `rolloverBlocked` skips Atlas/branding/profiles/prune until fixed | `schoolYearResolver.ts:157-211`; `syncCoordinator.ts:311-436` | retry next cycle |
| EnrollPro SSE `/api/events/stream` | explicitly **not** a cross-service bus | n/a |
| SMART SSE `SCHOOL_YEAR_ROLLOVER` event | broadcast server-side (`rollover.ts:225,304,333`) but `useSyncStream.ts` only handles `SYNC_COMPLETE`/`SYNC_SKIPPED` — UI ignores it | n/a |
| `GET /admin/rollover-status` / registrar variant — shows local current vs previous year + blockers (unfinalized sections, snapshot gaps) and manual archive | `admin-sub/system.ts:501`; `RolloverStatusCard.tsx` | on demand |

### Risk window (what can go wrong between EnrollPro rollover and SMART detection)

1. SMART keeps the old year active for up to ~5 min; grades/attendance can be written into the
   old year.
2. If the previous year has unfinalized sections/gaps, the auto-archive is blocked: SMART reverts
   the active year (R0a), writes an audit log, and continues old-year operation until an admin
   fixes EOSY — correct, but only visible in Activity Logs and the manual Rollover card.
3. No UI banner tells teachers/admins "EnrollPro is on a new year; SMART has not rolled over yet."

## Plan

### Phase A — faster detection (small, no broker)

1. **School-year watchdog** — a lightweight timer (default 60s, `SCHOOL_YEAR_WATCH_INTERVAL_MS`)
   that calls `GET /integration/v1/school-year` (one tiny request), compares to the local active
   year, and on mismatch:
   - invalidates the `enrollpro:schoolYear:` cache,
   - calls `triggerImmediateSync('school-year-change')` (add to `ALWAYS_ALLOWED_SOURCES` so the
     60s debounce cannot swallow it),
   - emits a `YEAR_MISMATCH_DETECTED` SSE event + audit entry (`rollover.ts` currently audits only
     archive success/failure, not detection).
   Fail-soft when EnrollPro is offline (reuse `externalState`), skip while a rollover is already
   in progress.
2. **Implement the documented webhook receiver** `POST /api/integration/enrollpro-webhook`
   (`server/src/routes/integration.ts`): `x-api-key` service auth (same pattern as
   `sync-grades`), CSRF-exempt (already whitelisted by path), rate-limited. Body is a refresh hint
   (`{ topics, timestamp }`): invalidate caches and, when topics include
   `school-year`/`enrollment`/`sectioning`, `triggerImmediateSync('enrollpro-webhook')`.
   - Ask EnrollPro to actually fire it on rollover **and** sectioning — their lifecycle doc says
     the sectioning commit does not currently call the external SMART webhook.

### Phase B — safe state during transition

3. Add `yearMismatch` / `rolloverState` (`idle | detected | blocked | archived`) to
   `UnifiedSyncResult` next to `rolloverBlocked`, and broadcast it in `SYNC_COMPLETE` payloads.
4. Frontend:
   - `useSyncStream` handles `SCHOOL_YEAR_ROLLOVER` and the new mismatch event.
   - Global banner (admin + teacher): "EnrollPro rolled over to SY X. SMART is finishing rollover."
     or "Rollover blocked — N sections need EOSY finalization."
   - `RolloverStatusCard`: show "EnrollPro: X vs SMART: Y", last detection time, last attempt result.
5. Decide the write policy during `detected`/`blocked` (owner decision): warn-only vs block grade
   and attendance writes until resolved. (Recommend: warn + audit initially; blocking is a bigger
   behavioral change.)

### Phase C — verification gates

6. Tests: mock active-year flip → watchdog detects once, triggers sync, audit written; blocked
   archive reverts + `rolloverBlocked`; webhook 401/403/200 + trigger; no trigger storm
   (debounce/dedupe). Year-switch fixture per `DEFENSE_READINESS_PLAN.md` RL-8.
7. Runbook section: what to do when blocked (finish EOSY finalization → manual archive via
   Rollover card), how to force a resync.

## Explicitly out of scope

- Event broker (no Kafka/RabbitMQ).
- Polling EnrollPro's `systemPhase` for pre-rollover warnings — optional Phase D only if needed.
- Changing the archive/rollover rules themselves (guarded by existing R0a/RL-6 behavior and tests).
