# PLAN — Audit Log Enhancement (device + network context)

## Goal
Turn audit logs from "what happened" into "**who** did it, **from where**, on **what device**".
Simple, scannable admin UI on top of the registrar-aligned design system.
No external services, no secrets, no writes to external systems.

## Decisions (locked)
1. **Where-from depth** — IP + network classification + device identity parsed from User-Agent.
   No external geolocation, no Tailscale CLI resolution.
2. **Storage** — structured, nullable, indexed columns + Prisma migration.
3. **Session tracking** — none. Per-event context only.
4. **UI** — enhanced `DataTable` + click-row detail dialog (`app-modal`).

## Current state
- `AuditLog` (`server/prisma/schema.prisma:323`): `action, userId, userName, userRole, target, targetType, targetId, details, ipAddress, severity, metadata, createdAt`.
- `createAuditLog()` (`server/src/lib/audit.ts`) — positional args; ~50 call sites mostly pass `req.ip`.
- `trust proxy` already set (`server/src/app.ts:24`, `server/src/index.ts:45`).
- `userAgent`, browser, OS, device type are **never captured**.
- API (`server/src/routes/admin-sub/audit.ts`) returns `ipAddress` but the UI never shows it.
- SSE broadcast via `broadcastLog()` (`server/src/lib/sseManager.ts`).
- Frontend type `AdminAuditLog` (`src/lib/api.ts:1396`); UI `src/pages/admin/AuditLogs.tsx`.

---

## Backend

### 1. Schema (`server/prisma/schema.prisma` → `model AuditLog`)
Add nullable fields:
| Field | Type | Purpose |
|---|---|---|
| `userAgent` | `String?` | raw UA (forensics) |
| `browser` | `String?` | e.g. "Chrome 131" |
| `os` | `String?` | e.g. "Windows 11" |
| `deviceType` | `String?` | `Desktop` / `Mobile` / `Tablet` / `Bot` / `Unknown` |
| `network` | `String?` | `Tailscale` / `School LAN` / `Localhost` / `Public Internet` / `Unknown` |
| `outcome` | `String?` | `success` / `failure` |
| `requestMethod` | `String?` | `POST` |
| `requestPath` | `String?` | `/api/grades/...` |

Indexes: `@@index([network])`, `@@index([deviceType])`, `@@index([outcome])`, `@@index([createdAt, action])`.

Migration (repo uses timestamped folders, latest `20260911000000_add_exam_scores`):
```
npx prisma migrate dev --name audit_log_device_context
# or add server/prisma/migrations/20260912000000_audit_log_device_context/
```
All columns nullable → additive, safe on existing rows.

### 2. Request context lib (`server/src/lib/requestContext.ts` — NEW)
- `normalizeIp(raw)` — first hop of `x-forwarded-for`, strip `::ffff:`, map `::1` → `127.0.0.1`.
- `classifyNetwork(ip)` — `100.64.0.0/10` → `Tailscale`; `10/8`, `172.16/12`, `192.168/16` → `School LAN`;
  `127.0.0.1`/`::1` → `Localhost`; else `Public Internet`; invalid → `Unknown`.
- `parseUserAgent(ua)` → `{ browser, os, deviceType }` (small local regex parser, zero deps).
- `buildAuditContext(req)` → `{ ip, userAgent, browser, os, deviceType, network, method, path }`.
- `AsyncLocalStorage<AuditContext>` with `runWithAuditContext(ctx, fn)` and `getAuditContext()`.

### 3. Middleware (`server/src/middleware/auditContext.ts` — NEW)
Registered in `app.ts` after `express.json()` / `cookieParser`, before routes:
`app.use(auditContextMiddleware)` → `als.run(buildAuditContext(req), () => next())`.

### 4. `createAuditLog` (`server/src/lib/audit.ts`)
- Read `getAuditContext()`; fill device/network/request fields automatically.
- `ipAddress` = explicit arg (still wins) ?? context ip.
- Add trailing optional `outcome: "success" | "failure" = "success"` param.
- Extend `broadcastLog()` payload with the new fields (SSE live rows render them).

No edits required at the ~50 existing call sites — they inherit device/network context.
Only failure paths (login failed/blocked, etc.) pass `outcome: "failure"`.

### 5. Audit API (`server/src/routes/admin-sub/audit.ts`)
- `/logs`: return `browser, os, deviceType, network, outcome, requestMethod, requestPath, userAgent`.
- New filters: `network`, `deviceType`, `outcome`, `from`, `to`.
- Search extended to `ipAddress`, `browser`, `os`, `deviceType`.
- `counts`: add `failed` (outcome failure) and `uniqueDevices` (distinct non-null `ipAddress`).
- `/logs/export`: add `Network, Device Type, Browser, OS, Outcome, Method, Path` columns.

### 6. Auth (`server/src/routes/auth.ts`)
- Failed / blocked / invalid-credential logins → `outcome: "failure"`.
- Successful login → `outcome: "success"` (default).

---

## Frontend

### 7. Types (`src/lib/api.ts`)
Extend `AdminAuditLog` with `browser?`, `os?`, `deviceType?`, `network?`, `outcome?`, `requestMethod?`, `requestPath?`, `userAgent?`.
Extend `getLogs` params with `network?`, `deviceType?`, `outcome?`.

### 8. `src/pages/admin/AuditLogs.tsx`
- **Columns:** User (initials avatar + name + role) · Action · What (details + target) · From (network badge + IP) · Device (browser · OS · type) · When (relative, exact on hover) · Severity.
- **Stats:** Total · Today · Failed logins · Unique devices · Critical.
- **Filters:** action, severity, network, device type, outcome; existing search extended.
- **Row click** → detail dialog. SSE live prepend already handled; keep.
- Null-safe: missing fields render `<Dash />`.

### 9. Detail dialog (`src/pages/admin/components/AuditLogDetailDialog.tsx` — NEW)
`app-modal` `size="lg"` `hideFooter`, sections:
- **Identity:** name, role, user ID, outcome badge.
- **Source:** IP, network badge, method + path.
- **Device:** browser, OS, device type, raw User-Agent.
- **Activity:** action, target, targetType, details.
- **Metadata:** formatted JSON (when present).

### 10. Small helpers
- `formatRelativeTime(iso)` (local or `src/lib/utils.ts`).
- Network badge config + device-type icon map (local to AuditLogs / dialog).

---

## Phases
1. Schema + migration + `requestContext.ts` + middleware + `createAuditLog` merge.
2. Audit API fields/filters/export/counts; auth `outcome`.
3. `api.ts` types + `AuditLogs.tsx` columns/filters/stats + detail dialog.
4. Verify.

## Verification
```
cd server; npm run build
npm run build            # root
```
Manual:
- Login via browser → newest row shows correct network (Tailscale/LAN), browser, OS, device type.
- `curl -H "User-Agent: ..."` an admin action → device fields populate.
- Failed login → `outcome: failure`, counted in "Failed logins".
- Old rows (null fields) render `<Dash />` without breaking.
- Mobile ~375px: table scrolls, dialog footer/body fit.

## Risks / guards
- **ALS correctness:** confirm the context is present inside async route handlers; unit-check with one log.
- **Proxy/IP:** `trust proxy: 1`; if deployed behind another hop or direct tailnet, normalize XFF and fall back to `req.socket.remoteAddress`.
- **Privacy:** UA/IP are already collected at login; document retention — pruning already exists (`lib/prune.ts`).
- **No new deps, no `.env` changes, no external calls.**
- Additive migration only; existing callers unchanged.

## File-size budget
- `requestContext.ts` ≤ 200 lines; `AuditLogDetailDialog.tsx` ≤ 300; `AuditLogs.tsx` ≤ 500.
- If exceeded, split column defs into `components/auditColumns.tsx`.

## Out of scope
- Tailscale/LAN name resolution, public-IP geolocation, session `sid` / "who's online", alerting, backend retention changes.
