# AI Handoff Pack — SMART UI Design for MRF

**What this is:** a complete, self-contained UI design extraction of the SMART system for the MRF team. Each document is written as a **task brief for an AI coding agent** — it embeds the actual reference code, exact class strings, tokens, motion values, and an acceptance checklist. MRF keeps its own content, data, routes, and auth; the **design must match**.

**Scope: Admin and MRF staff portals only.** MRF's landing/login page serves students and teachers — it must **not** be modified. No shared components, routes, or styles for that page are part of this handoff.

**Already delivered:** `AI_HANDOFF_SIDEBAR_TOPBAR.md` (app shell, fonts, global tokens, icon rules). Do not resend — the parts below assume it has been applied.

---

## What to send

**`AI_HANDOFF_MRF_MASTER.md`** — send this single file. It merges the prompt, **anti-hallucination rules**, the **four-gate verification protocol**, and all six parts below into one attachment. The per-part files listed here are sources only; do not attach them.

---

## Parts (inside the master file, in order)

| # | File | Covers | MRF replaces |
|---|---|---|---|
| 1 | `AI_HANDOFF_PAGES_BRANDING.md` | Page scaffolding, `PageHeader`, loading gate, runtime branding (theme colors/logo/name, pixel-grid backdrop, favicon/title) | Page copy, brand defaults, org identity |
| 2 | `AI_HANDOFF_TABLES.md` | `DataTable` family: toolbar, column API, states (loading/empty/error), pagination, cell/row conventions | Columns, rows, data source, filters |
| 3 | `AI_HANDOFF_MODALS_DRAWERS.md` | Standard dialog, rich `AppModal` system (+ InfoCard/StatTile/AlertBanner/StepCards/ModalSection), `ConfirmDialog`, 440px sheet + 1100px vault drawer | Modal/drawer content, tabs, handlers |
| 4 | `AI_HANDOFF_NOTIFICATIONS_FEEDBACK.md` | Notification bell + dropdown panel, severity model, dismiss persistence, Sonner toasts, inline banners, loading indicators, `PageError` | Notification rules, messages, links, toasts |
| 5 | `AI_HANDOFF_BUTTONS_INPUTS.md` | Buttons (variants/sizes), Input, Textarea, Select (filters + page size), search-field recipe — controls used by tables, modals and toolbars | Actions, labels, filter options |
| 6 | `AI_HANDOFF_DATA_DISPLAY.md` | Card family, `StatCard` + count-up, Badge, Avatar, Tabs, DropdownMenu, Separator, ScrollArea | Card/stat/tab/menu content |

---

## How to run the handoff

1. Attach `AI_HANDOFF_MRF_MASTER.md` and say: *“Implement per the attached master handoff for the Admin/MRF portal. Start with Part 1: give a short implementation plan, then implement.”*
2. The agent must pass **Gate 0** (plan, no code) before starting, and **Gate 1** per part (verbatim checklist + build/lint evidence + `path:line` table).
3. It must not proceed past a part with FAIL/unknown items — those are reported as `PARTIAL` with blockers, or fixed first.
4. After all parts, require **Gate 2** (banned-pattern searches, duplicate-primitive check, landing-page `git diff` gate) and **Gate 3** (final rollup table: 63 checklist items total).
5. If the agent's report shows fewer items than a part's count (Part 1: 9, Part 2: 13, Part 3: 11, Part 4: 12, Part 5: 9, Part 6: 9), it skipped items — send it back.

---

## Foundation facts (already applied via the delivered shell handoff)

- **Font:** DM Sans (Google Fonts variable, weights 100–1000), `16px/1.6`, `letter-spacing: -0.011em`; root drops to 15px below 640px; sidebar hard-sets the family.
- **Icons:** `lucide-react`; nav 20px / nested 16px at `strokeWidth 2.2`; chrome icons default stroke.
- **Accent:** one runtime variable `--theme-primary` (+ `--theme-primary-rgb`, `--theme-primary-text` for contrast). Never hardcode a brand hex in components.
- **Neutrals:** sidebar `#fafafa`; nav text `#0F1729` with 70/60/50% opacity tiers; hover `white/80`; borders `slate-200`/`slate-100`; topbar `white/80` + 12px blur.
- **Layout:** sidebar 280/70px, logo header 96px, topbar 64px, main padding 16/32px, content max-width 1400px.
- **Motion:** shell 200ms `cubic-bezier(0.4,0,0.2,1)`; dialogs/menus 100ms zoom+fade; drawers 200ms slide; count-up 800ms cubic; page fade 400ms.
- **Radii:** pills `9999px`, cards 16.8px, buttons/inputs 12px, badges 20px height pills.
- **Stack reference:** React + Tailwind + `@base-ui/react` (shadcn-style wrappers) + `class-variance-authority` + `lucide-react` + Sonner. Any equivalent stack is fine — the documents specify classes and computed values so they port.

---

## What is intentionally NOT included

- **MRF's student/teacher landing & login page** — explicitly out of scope, kept as-is.
- Form-specific primitives (labels, checkbox/radio, help tooltips, multi-field validation layouts) — MRF has no data-entry forms; the controls they do need are covered in `AI_HANDOFF_BUTTONS_INPUTS.md`.
- Domain-specific layouts: class-record ledger grid, SF form grids, Excel viewer, attendance sheets — these are SMART content, not reusable design.
- Backend, auth flows, data-fetching patterns, API contracts.
- Dark mode (the app currently ships light-only chrome; dark tokens exist but the shell does not use them).
