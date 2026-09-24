# SMART — Sidebar & Topbar UI Handoff Spec

**Audience:** MRF team. This document describes the shell chrome (left sidebar + top header) so you can reproduce the exact design with your own navigation content, labels, routes, and logo.

**Source of truth (read these if in doubt):**
- `src/layouts/AdminLayout.tsx` — reference implementation (most complete; collapsible groups, badges, disabled items)
- `src/layouts/TeacherLayout.tsx`, `src/layouts/RegistrarLayout.tsx` — same design, simpler nav
- `src/components/layout/IntegratedSystemsNav.tsx` — lower nav group variant
- `src/components/layout/NotificationBell.tsx` — topbar bell
- `src/components/layout/PixelGridBackground.tsx` — page backdrop
- `src/index.css` — fonts, tokens, scrollbar

**Stack used:** React 19 + Tailwind CSS v4 + `lucide-react` icons. The design is plain Tailwind utility classes plus CSS custom properties — no component library required to copy it.

---

## 1. Fonts

| Purpose | Font | Source | Weights |
|---|---|---|---|
| Everything (app, body, sidebar, topbar) | **DM Sans** (variable) | Google Fonts | 100–1000 (variable), italics included |
| Fallback in sidebar inline style | **Poppins** → `sans-serif` | — (only a fallback; not actually loaded) | — |
| Headings/UI declared in `index.html` | Geist / Geist Mono | Google Fonts | 100–900 (declared but **not** the rendered app font; legacy, safe to omit) |
| Mono (code/rare) | `SF Mono`, `ui-monospace`, `Consolas` | system | — |

**Google Fonts import (root CSS, exact):**
```css
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,100..1000;1,9..40,100..1000&display=swap');
```

**Global type setup (exact):**
```css
:root {
  --sans: 'DM Sans', system-ui, -apple-system, sans-serif;
  font: 16px/1.6 var(--sans);      /* base size / line-height 1.6 */
  letter-spacing: -0.011em;        /* global slight tightening */
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
  font-feature-settings: 'cv02','cv03','cv04','cv11';
}
@media (max-width: 640px) { :root { font-size: 15px; } }

@theme inline { --font-sans: 'DM Sans', sans-serif; }  /* Tailwind v4 theme font */
```

**Sidebar additionally hard-sets (inline style on `<aside>`):**
```tsx
style={{ fontFamily: "'DM Sans', 'Poppins', sans-serif" }}
```
Keep this so the sidebar never inherits a different font if your app overrides body font.

**Type sizes actually used in the chrome:**

| Element | Size | Weight | Treatment |
|---|---|---|---|
| Sidebar group label (OPERATIONS, ACADEMICS…) | `0.625rem` (10px) | 700 | uppercase, `tracking-normal`, color `#0F1729` @ 60% |
| Sidebar nav item | `14px` | 500 | `truncate` |
| Sidebar nested child | `13px` | 500 | `truncate` |
| Sidebar user name | `12px` (`text-xs`) | 700 | `truncate`, leading-none |
| Sidebar user role | `10px` | 700 | uppercase, `#0F1729` @ 50% |
| Sidebar school name | `14px` (`text-sm`) | 700 | uppercase, `tracking-tight`, max 160px wide |
| Topbar portal label ("Admin Portal") | `12px` (`text-xs`) | 500 | uppercase, `tracking-wider`, slate-500 |
| Topbar page title | `16px` (`text-base`) | 700 | slate-900, `-mt-1` (tight stack under label) |
| Topbar user name | `14px` (`text-sm`) | 700 | slate-900 |
| Topbar role pill / S.Y. badge | `10px` | 500 / 700 | see §4 |

---

## 2. Icons

**Library:** `lucide-react` v1.7.0 (`package.json`).

**Rules:**
- Sidebar nav icons: `w-5 h-5` (20px), **`strokeWidth={2.2}`** (Lucide default is 2 — we override to 2.2 for a slightly bolder, friendlier look).
- Nested/dropdown child icons: `w-4 h-4` (16px), `strokeWidth={2.2}`.
- Chevron for expandable groups: `ChevronDown` `w-4 h-4`, `opacity-60`, rotates `180°` when open.
- Topbar hamburger: `Menu` `w-5 h-5` (default stroke).
- Topbar bell: `Bell` `w-5 h-5`.
- Close (mobile logo bar): `X` `w-5 h-5`.
- Logout: `LogOut` `w-4 h-4`.
- Icons always sit inside a fixed **24×24px box** (`w-6 h-6 flex items-center justify-center`) so glyphs never shift when the sidebar collapses.

**Icons in our current content (replace with yours; style stays):**
`LayoutDashboard, BookOpen, FileText, Users, Sliders, Calendar, Settings, Shield, Activity` (nav) · `Menu, Bell, X, LogOut, ChevronDown` (chrome) · notification severities `AlertCircle, AlertTriangle, Info` · integrated systems `ArrowUpRight, CalendarClock, FlaskConical, CheckCircle2, Loader2, Wrench`.

Placeholder brand marks when no logo is uploaded: `Shield` (Admin), `GraduationCap` (Teacher/Registrar), rendered at `w-6 h-6` in `var(--theme-primary)`.

---

## 3. Sidebar

### 3.1 Shell

| Property | Value |
|---|---|
| Position | `fixed inset-y-0 left-0`, `z-50`, `flex flex-col` |
| Width expanded | **280px** (`w-[280px]`) |
| Width collapsed (≥1024px) | **70px** (`lg:w-[70px]`) |
| Mobile (<1024px) | stays 280px, hidden off-canvas (`-translate-x-full`), slides in with backdrop |
| Background | `#fafafa` |
| Border | right border `1px` `slate-200` |
| Shadow | `shadow-sm` |
| Transition | `width, transform` **200ms** `cubic-bezier(0.4, 0, 0.2, 1)` + `will-change-[width,transform]` |
| Z layering | sidebar `z-50`, mobile backdrop `z-40` (`bg-black/50`), topbar `z-30` |

### 3.2 Anatomy (top → bottom)

**A. Logo header — height 96px (`h-24`)**
- Expanded: `px-6`, horizontal row.
  - Logo tile: **48×48px** (`w-12 h-12`), `rounded-lg` (8px), `bg-white`, `border border-slate-100`, `shadow-sm`, `p-1`; image `object-contain`; fallback icon `Shield` 24px in theme primary.
  - School name: `ml-3`, `text-sm font-bold uppercase tracking-tight`, theme primary color, `max-w-[160px]`, `leading-tight`.
- Collapsed: `px-0 justify-center`; logo tile scales to `scale-[0.85]`.
- Mobile-only close button on the right: `ml-auto p-2 rounded-lg hover:bg-slate-100 text-slate-400`, `X` 20px.

**B. Navigation — `flex-1 overflow-y-auto py-2 px-3 overflow-x-hidden custom-scrollbar`**
- Groups (`OPERATIONS`, `ACADEMICS`, `MANAGEMENT`, `SYSTEM`, `INTEGRATED SYSTEMS`): wrapper `mb-5 first:mt-2`.
  - Group label: `px-4 mb-1` + the 10px style from §1. Hidden entirely when collapsed.
  - Items stack: `space-y-1`.
- **Item (top level)** — a `Link` (or `button` for dropdown/action):
  - Shape: **full pill** `rounded-full`.
  - Padding: `px-4 py-1.5`; collapsed: `px-0 justify-center h-10 w-10 mx-auto`.
  - Text: `text-[14px] font-medium`.
  - Row: 24px icon box (`w-6 h-6`) then label with `ml-4` gap (`gap` is effectively 16px; for nested children it's `gap-3` = 12px).
  - **Default:** text `#0F1729`, icon `#0F1729` @ 70%.
  - **Hover:** background `bg-white/80`; icon darkens to `#0F1729`. `transition-all duration-200`.
  - **Active:** background `var(--theme-primary)`, text `white`, icon `white`, `shadow-sm`.
  - **Disabled:** `opacity-40 cursor-not-allowed select-none`, `title="Name (Unavailable)"`.
  - Collapsed: label fades/slides away — `opacity-0 scale-90 -translate-x-4 w-0 m-0 pointer-events-none origin-left`, transition `200ms cubic-bezier(0.4,0,0.2,1)`; icon box stays centered; native tooltip via `title`.
- **Expandable group (dropdown header)**
  - Same pill as above + `ChevronDown` on the right (`opacity-60`, rotate-180 when open).
  - Parent with an active child: translucent primary background `rgba(var(--theme-primary-rgb), 0.1)`.
  - Open state is persisted (we use `localStorage`).
- **Nested children** (only rendered when open and not collapsed):
  - Container: `mt-0.5 space-y-0.5 pl-4 ml-7 border-l border-slate-100` (+ subtle enter animation).
  - Row: `flex items-center gap-3 rounded-full text-[13px] font-medium px-4 py-1.5`.
  - **Active:** solid `var(--theme-primary)` bg, white text/icon (`16px` icon).
  - **Inactive:** transparent, `#0F1729` text, icon `#0F1729` @ 60%.
- **Special row style (Integrated Systems group):** two-line rows — label `14px` + sub-label `10px font-normal` in `#0F1729` @ 50% (e.g. “EnrollPro / School management hub”). Same pill/active rules; non-current companions are `opacity-40 cursor-not-allowed`.

**C. "In Dev" badge** (optional status chip on items)
- `inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase whitespace-nowrap`
- Default: `bg-amber-100 text-amber-700` with a `h-1.5 w-1.5 rounded-full bg-current opacity-80` dot.
- On active (primary) background: `bg-white/20 text-white/90`.

**D. User profile footer**
- Container: `p-4 border-t border-slate-100 bg-white/20 overflow-hidden` (collapsed: `px-2 py-4`).
- Avatar: **36×36px** (`w-9 h-9`), `border border-white shadow-sm`; fallback `bg-slate-100 text-slate-700 font-bold text-xs uppercase` with first initial.
- Name: `text-xs font-bold text-[#0F1729] truncate leading-none mb-1`.
- Role: `text-[10px] font-bold text-[#0F1729]/50 uppercase tracking-tight` (e.g. `ADMIN`).
- Logout button: `p-1.5 rounded-lg text-slate-400`, hover `bg-white text-red-600`, `LogOut` 16px, tooltip “Sign Out”.
- Collapsed: avatar scales to `0.9`, name/role/logout hidden with the same fade-slide transition.

### 3.3 Scrollbar (sidebar only)
```css
.custom-scrollbar::-webkit-scrollbar { width: 4px; }
.custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
.custom-scrollbar::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 4px; }
.custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #cbd5e1; }
```

### 3.4 Collapse behavior
- Desktop toggle button lives in the **topbar** (hamburger). At `window.innerWidth >= 1024` it toggles collapse; below that it opens the off-canvas drawer.
- State is persisted (`adminSidebarCollapsed`, etc. in `localStorage`).
- Collapsed rail keeps: logo tile (scaled), icon-only pills (`40×40px` centered), footer avatar. Labels are removed from layout (width 0), not just visually hidden — no layout jump.
- Main content compensates with `lg:pl-[280px]` / `lg:pl-[70px]`, same 200ms ease.

---

## 4. Topbar (header)

| Property | Value |
|---|---|
| Position | `sticky top-0 z-30` |
| Height | **64px** (`h-16`) |
| Background | `bg-white/80` + `backdrop-blur-md` (frosted glass over content) |
| Border | bottom `1px` `slate-200` |
| Padding | `px-4 lg:px-6` |
| Layout | single row, `flex items-center justify-between`, `h-full` |

**Left cluster — `flex items-center gap-4`:**
1. **Menu button** — `p-2 rounded-xl text-slate-600 hover:bg-slate-100 transition-all active:scale-95`; `Menu` 20px. (12px radius; press feedback via `active:scale-95`.)
2. **Title stack** — `flex flex-col`:
   - Portal label: `text-xs font-medium text-slate-500 uppercase tracking-wider` — e.g. `ADMIN PORTAL`.
   - Page title: `text-base font-bold text-slate-900 -mt-1` — resolved from the current route (our nav data), e.g. “Class Assignments”.

**Right cluster — `flex items-center gap-3`:**
1. **Notification bell** — `relative p-2 rounded-xl hover:bg-accent text-muted-foreground transition-all active:scale-95`; `Bell` 20px. Unread count badge: `absolute top-0.5 right-0.5 min-w-4 h-4 px-1 rounded-full bg-destructive text-white text-[10px] font-bold flex items-center justify-center` (caps at `9+`). Dropdown panel `w-80`, aligned end.
2. **School year badge** — `hidden sm:inline-flex items-center gap-1 text-[10px] font-bold tracking-wider px-2 py-1 rounded-lg bg-slate-100 text-slate-600`, content `S.Y. 2026–2027`.
3. **User block** — `flex items-center gap-3 pl-3 border-l border-slate-100`:
   - Name + status (hidden below `sm`): name `text-sm font-bold text-slate-900 leading-none`; status pill `text-[10px] font-medium px-1.5 py-0.5 rounded-md mt-1`:
     - Admin: `text-emerald-600 bg-emerald-50` (“Online”)
     - Registrar: `text-blue-600 bg-blue-50` (“Registrar”)
     - Teacher: theme primary text at 10% alpha background (inline style: `color: colors.primary; backgroundColor: colors.primary + '10'`)
   - **Avatar:** 36×36px, `ring-2 ring-slate-100 ring-offset-2`; fallback `bg-slate-200 text-slate-700 text-sm font-bold` with initial.

**Page content** sits under the header: `<main className="p-4 lg:p-8 flex-1">`.

---

## 5. Page backdrop (behind the shell)

`PixelGridBackground` — a fixed, `-z-10`, pointer-events-none layer:
```tsx
backgroundImage: "linear-gradient(to bottom right, #f8fafc 0%, rgba(var(--theme-primary-rgb), 0.08) 50%, rgba(var(--theme-primary-rgb), 0.06) 100%)"
// + inline SVG pattern, 80×80 tile, 4 rounded squares (36×36, rx 2, stroke 1.5)
//   stroke: var(--theme-primary), container opacity 0.08
```
Reproduce if you want the shell to feel identical; it is subtle but visible through the frosted topbar.

---

## 6. Color tokens & theming

The shell is **white-label**: the accent is a runtime school-configurable color.

```css
--theme-primary: #10b981;        /* default emerald-500; set from school settings */
--theme-primary-rgb: 16, 185, 129;
--theme-primary-light / -dark:   /* auto ±40 per channel */
--theme-primary-text: #1f2937 | #ffffff;  /* auto contrast */
```
- Active nav pill, school name, logo fallback icon, and teacher role pill all read from `var(--theme-primary)`.
- Hover surfaces in the sidebar are warm-white (`bg-white/80`), not gray — this is intentional against the `#fafafa` sidebar.
- Fixed neutrals used in the chrome (hand this list to your dev as-is):
  - Sidebar bg `#fafafa`, border `slate-200`
  - Nav text/icon base `#0F1729` (70% icons, 60% group labels, 50% sub-text)
  - Topbar title `slate-900`, portal label `slate-500`, icon buttons `slate-600`
  - Dividers `slate-100`; badges `slate-100/slate-600`; destructive badge = `--destructive`
- Global radius token: `--radius: 0.75rem (12px)`. Chrome uses: pills `rounded-full`, logo/role badge/bell `rounded-lg` (8px), topbar icon buttons `rounded-xl` (12px).

---

## 7. Motion summary

| Animation | Duration | Easing |
|---|---|---|
| Sidebar width/transform, content padding | 200ms | `cubic-bezier(0.4, 0, 0.2, 1)` |
| Label fade/slide (collapse) | 200ms | `cubic-bezier(0.4, 0, 0.2, 1)`, `origin-left` |
| Nav hover/active colors | 200ms | default ease |
| Chevron rotate | 200ms | default |
| Dropdown children reveal | 200ms | fade-in + slide-from-top-1 |
| Button press | instant | `active:scale-95` |
| Logo scale when collapsed | 200ms | ease-out |

---

## 8. Responsive rules

| Breakpoint | Behavior |
|---|---|
| `< 640px` (`sm`) | Topbar hides school-year badge and name/status text; avatar only. Root font drops 16→15px. |
| `< 1024px` (`lg`) | Sidebar off-canvas (`-translate-x-full`), opened as drawer with `bg-black/50` backdrop (z-40) that closes on tap; hamburger opens it. Content has no left padding. |
| `≥ 1024px` (`lg`) | Sidebar pinned, hamburger toggles 280px ↔ 70px collapse; content padding `lg:pl-[280px]` / `lg:pl-[70px]`. |

---

## 9. Accessibility notes (keep these when re-implementing)

- Topbar icon buttons: give `aria-label` (we do on the bell: “Notifications, N active”).
- Disabled/coming-soon items: use a non-interactive element (not a `<Link>`), with `title` explaining why, plus visual `opacity-40`.
- Active nav item is conveyed by background + white text; also match `location.pathname` with `startsWith` so deep routes keep the parent highlighted.
- Collapsed rail tooltips use native `title` attributes. If you want richer tooltips, keep the same pill geometry.
- Global focus ring: `:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }`.

---

## 10. Copy-paste reference (core classes)

**Sidebar shell**
```
fixed inset-y-0 left-0 z-50 bg-[#fafafa] border-r border-slate-200 shadow-sm
flex flex-col will-change-[width,transform]
transition-[width,transform] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)]
w-[280px]  |  lg:w-[70px]
```

**Nav item — default/inactive**
```
flex items-center rounded-full text-[14px] font-medium transition-all duration-200
group overflow-hidden py-1.5 px-4 text-[#0F1729] hover:bg-white/80
```

**Nav item — active**
```
(text-white shadow-sm)  bg-color: var(--theme-primary)
```

**Nav item — collapsed**
```
px-0 justify-center h-10 w-10 mx-auto
label: opacity-0 scale-90 -translate-x-4 pointer-events-none w-0 m-0 origin-left
```

**Topbar**
```
sticky top-0 z-30 h-16 bg-white/80 backdrop-blur-md border-b border-slate-200 px-4 lg:px-6
```

---

## 11. "Keep your own content" checklist for MRF

1. Copy the shell structure and class strings from §10 — do **not** copy our `navigationGroups` data.
2. Keep the same geometry: 280px / 70px rail, 96px logo header, 64px topbar, 24px icon boxes, full-pill items, 200ms cubic-bezier(0.4,0,0.2,1).
3. Load **DM Sans** (variable) from Google Fonts and set it as the app font + hard-set it on the sidebar element.
4. Use **Lucide** icons at 20px / 16px with `strokeWidth 2.2` for nav; keep icon size consistent so collapse animation is stable.
5. Drive the accent from one CSS variable (our `--theme-primary`) — active pill, school name, and logo fallback all read from it. Derive a `-rgb` variant for the 10% translucent active-parent background and backdrop tint.
6. Keep the fixed neutrals list in §6 verbatim if you want pixel parity.
7. Reuse the interaction rules: frosted sticky topbar, warm-white hover, white-on-primary active, opacity-40 disabled, persisted collapse state, off-canvas mobile drawer with 50% black scrim.
8. Optional but recommended: `custom-scrollbar` 4px styles (§3.3) and the pixel-grid backdrop (§5).
