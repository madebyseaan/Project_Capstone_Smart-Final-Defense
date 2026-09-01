# SMART Deployment Runbook — 2-School Topology

> **Document type:** Step-by-step deployment guide for each school.
> **Scope:** One school per deployment. Two schools = two fully isolated stacks.
> **Pre-requisite:** Read `docs/HANDOFF_WIPE_RESET.md` and `AGENTS.md`.

---

## Architecture: Two Isolated Stacks

```
School A                              School B
┌─────────────────────┐              ┌─────────────────────┐
│ SMART Server A      │              │ SMART Server B      │
│  └─ .env (School A) │              │  └─ .env (School B) │
│  └─ DB A            │              │  └─ DB B            │
│  └─ Domain A        │              │  └─ Domain B        │
└─────────────────────┘              └─────────────────────┘
        │                                    │
        ▼                                    ▼
   EnrollPro (School A's account)    EnrollPro (School B's account)
   ATLAS (School A's ids)            ATLAS (School B's ids)
```

**NEVER** point two deployments at one DB or one EnrollPro account. The schema is single-tenant — there is no `schoolId` column on any model.

---

## Pre-Flight Checklist (per school)

Collect these before deploying:

| Item | School A | School B |
|------|----------|----------|
| EnrollPro URL | | |
| EnrollPro Account Name | | |
| EnrollPro Password | | |
| EnrollPro Integration Key | | |
| EnrollPro School Year ID (numeric) | | |
| EnrollPro School Year Label (e.g. 2026-2027) | | |
| ATLAS School ID (numeric) | | |
| ATLAS School Year ID (numeric) | | |
| ATLAS System Token | | |
| Domain name | | |
| PostgreSQL connection string | | |
| JWT Secret (64+ hex chars) | | |
| CSRF Secret | | |

---

## Step 1: Provision Database

Create an isolated PostgreSQL database for each school:

```sql
-- Example (adjust for your hosting)
CREATE DATABASE smart_school_a;
-- or
CREATE DATABASE smart_school_b;
```

Record the connection string: `postgresql://user:password@host:5432/smart_school_a`

---

## Step 2: Deploy Application

### 2a. Build

```bash
cd SMART_FINAL_CAPSTONE
npm install
npm run build          # Frontend build

cd server
npm install
npx prisma generate
npm run build          # Backend TypeScript compile
```

### 2b. Configure Environment

Copy `.env.example` to `.env` and fill in ALL values:

```bash
cp server/.env.example server/.env
# Edit server/.env with school-specific values
```

**Critical:** `ENROLLPRO_SCHOOL_YEAR_ID`, `ATLAS_SCHOOL_ID`, `ATLAS_SCHOOL_YEAR_ID` must be THIS school's values. Wrong values = wrong students silently synced.

### 2c. Run Migrations

```bash
cd server
npx prisma migrate deploy
```

### 2d. Start Server

```bash
cd server
npm run start    # production
# or
npm run dev      # development
```

---

## Step 3: First-Run Sequence

After the server boots:

1. **Env guards verify** — if `NODE_ENV=production` and school-scoped vars are missing, server exits immediately with a clear error.

2. **Scheduler auto-syncs** — the background scheduler runs EnrollPro + ATLAS sync within minutes. Alternatively, trigger manual sync:
   ```
   POST /api/admin/system/sync/run
   Authorization: Bearer <admin-jwt>
   ```

3. **Run verification report** — this is the tripwire:
   ```
   GET /api/admin/sync-verification
   Authorization: Bearer <admin-jwt>
   ```

4. **Verify `ok: true`** — the report must return `"ok": true` before go-live. If not:
   - Check anomalies — each has a `code` and `severity`
   - Use the orphan detection to diagnose
   - If contaminated: run `db:wipe` → resync → re-verify

---

## Step 4: Mid-Year Reset ("Fresh Rollover")

If you need to wipe and re-import data mid-year:

> **Never wipe per-table manually.** That caused the original incident.

1. **Fix EnrollPro first** — it's the source of truth. SMART cannot write to EnrollPro.

2. **Run the wipe** (on the school's server):
   ```bash
   cd server

   # Dry run first
   npm run db:wipe -- --dry-run

   # Production wipe (requires confirmation)
   WIPE_CONFIRM=yes npm run db:wipe -- --i-know-this-wipes-production
   ```

3. **Restart the server** — scheduler will auto-sync.

4. **Re-verify** — run the verification report and confirm `ok: true`.

### Wipe Flags

| Flag | Default | Effect |
|------|---------|--------|
| `--dry-run` | off | Print counts, make no changes |
| `--keep-templates` | **ON** | Keep ExcelTemplate rows (school form templates) |
| `--keep-users` | off | Keep User/Teacher/RefreshToken/AuditLog/GradeEditRequest/ExcelTemplate |
| `--wipe-templates` | off | Include ExcelTemplate in wipe |

---

## Step 5: Two-School Deployment

Repeat Steps 1–4 for School B. Each school gets:

- Its own server process
- Its own PostgreSQL database
- Its own `.env` with school-specific values
- Its own domain name
- Its own JWT/CSRF secrets

---

## Rollback

- **Application rollback:** redeploy the previous build.
- **Database rollback:** NOT scripted. DB backups are the school's ops responsibility.
  - **Recommended:** run `pg_dump` before each wipe operation.
  ```bash
  pg_dump -Fc smart_school_a > backup_$(date +%Y%m%d_%H%M%S).dump
  ```

---

## Troubleshooting

### Server won't start (production)

```
[FATAL] Missing school-scoped environment variables (required in production):
  - ENROLLPRO_SCHOOL_YEAR_ID
  - ATLAS_SCHOOL_ID
```

**Fix:** Set the missing vars in `server/.env` and restart.

### Verification report shows anomalies

| Anomaly Code | What It Means | Fix |
|---|---|---|
| `STUDENT_COUNT_MISMATCH` | DB student count ≠ EnrollPro count | Re-sync, or wipe+resync |
| `MULTIPLE_YEARS_IN_ENROLLMENTS` | Enrollments from multiple years exist | Expected after partial wipe — run full wipe+resync |
| `ORPHAN_STUDENTS` | Students with no active enrollment | Run wipe+resync |
| `UNEXPECTED_USER_ACCOUNTS` | TEACHER users without profile | Run wipe+resync (sync recreates them) |
| `ENROLLPRO_UNREACHABLE` | Can't reach EnrollPro API | Check network/credentials |

### Wipe fails on FK constraint

This shouldn't happen with the script (it uses `deleteMany` in FK-safe order), but if it does:
- Check for custom constraints not in the schema
- Ensure no manual DB triggers or foreign keys exist outside Prisma

---

## Strict SSOT / Auto-Prune

The prune engine enforces EnrollPro as the single source of truth for PEOPLE in the active school year. Every sync cycle (~5 min), it compares local data against EnrollPro and automatically removes stale entries.

### What It Does

| Phase | Authority | Action |
|---|---|---|
| A — Teachers | EP faculty list | Teachers not in EP → SUSPENDED (if has history) or DELETED (no history) |
| B — Orphan users | EP faculty list | TEACHER users with no Teacher profile and not in EP → deleted |
| C — Sections | EP sections | Active-year sections not in EP → deleted (cascades CAs, enrollments, attendance) |
| D — Students | EP learners | Active-year students not in EP → active-year data deleted; student kept if has historical data |
| E — Enrollment pairs | EP learners | Students in wrong section locally → enrollment + section grades deleted |

### Circuit Breaker

If planned deletes exceed 50% of active entities (configurable via `PRUNE_MAX_DELETION_RATIO`), the entire prune ABORTS — nothing is deleted. This protects against partial EP responses.

### EP Empty-Set Guard

If EnrollPro returns zero teachers, learners, or sections (outage), the prune ABORTS. An outage must never look like "everyone left."

### Dry-Run Mode

```bash
# Plan only — no writes, returns what WOULD be deleted
curl -X POST http://localhost:5003/api/admin/prune?dryRun=true \
  -H "Authorization: Bearer <admin-token>"

# Or via JSON body
curl -X POST http://localhost:5003/api/admin/prune \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{"dryRun": true}'
```

### Login Enforcement

- **Local auth:** Teachers not in EP faculty list → 401 (even with correct password)
- **Live EP auth:** Valid EP credentials but not faculty → 401, NO user created
- **EP unreachable:** Falls back to local status check only (never locks out whole school)
- **SUSPENDED accounts:** 403 with message "Your account was removed from EnrollPro"
- **ADMIN/REGISTRAR:** Exempt from faculty check (locally managed)

### Configuration

| Env Var | Default | Description |
|---|---|---|
| `PRUNE_ENABLED` | `true` | Set `false` to disable auto-prune |
| `PRUNE_DRY_RUN` | `false` | Set `true` to plan-only mode globally |
| `PRUNE_MAX_DELETION_RATIO` | `0.5` | Circuit breaker threshold (0–1) |

### Pre-Flight for Deployment

1. Set `DEFAULT_SYNC_PASSWORD` in `.env` to a strong value (not `password123`)
2. Ensure `ENROLLPRO_SCHOOL_YEAR_ID` matches your school's current year
3. After first sync, run `POST /api/admin/prune?dryRun=true` to verify the plan
4. Run a real prune: `POST /api/admin/prune`
5. Verify: `GET /api/admin/sync-verification` → `ok: true`, no `ORPHAN_STUDENTS` or `UNEXPECTED_USER_ACCOUNTS` anomalies
