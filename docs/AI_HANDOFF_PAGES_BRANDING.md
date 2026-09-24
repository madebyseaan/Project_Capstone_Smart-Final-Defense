# AI Handoff — SMART Pages & Branding for MRF

**How to use this document:** paste it into the MRF-side AI coding agent as the task brief. It is fully self-contained: the agent does not need access to the SMART repository. MRF supplies its own pages, content, and organization identity; the page scaffolding, header component, loading gate, and runtime branding system must match this spec.

**Scope: Admin and MRF staff portals only.** MRF's landing/login page serves students and teachers — it must **not** be modified by this handoff.

Companion docs: `AI_HANDOFF_TABLES.md` · `AI_HANDOFF_MODALS_DRAWERS.md` · `AI_HANDOFF_NOTIFICATIONS_FEEDBACK.md` · `AI_HANDOFF_FORMS_CONTROLS.md` · `AI_HANDOFF_DATA_DISPLAY.md` (the shell/topbar/sidebar handoff was already delivered and defines the global fonts, tokens, and icon rules used here)

---

## 0. Task brief for the agent

Implement MRF's page-level shell pieces inside the authenticated Admin/MRF portal:

1. **Page scaffolding** — consistent page root, spacing, max width, entrance animation.
2. **PageHeader** — title + optional badge + description + actions.
3. **Loading gate** — full-page loader while auth/session resolves.
4. **Runtime branding** — configurable primary/secondary/accent colors, logo, name; applied via CSS variables; pixel-grid backdrop; document title/favicon.

Out of scope: MRF's landing/login page (student and teacher entry point) stays untouched. Do not restyle, wrap, or share components with it.

---

## 1. Hard rules

### 1.1 KEEP (do not alter)
- Page root: `space-y-6` vertical rhythm, centered `max-w-[1400px]` content width, `0.4s ease-out` fade-in entrance on mount.
- Page title: **24px bold** (`text-2xl font-bold tracking-tight text-foreground`).
- Page description: 14px `muted-foreground`, hidden on mobile when it competes with actions.
- Actions cluster: `flex items-center gap-3`; primary page action is a small button with a 16px icon and `mr-1.5`.
- Content inside main is padded 16px mobile / 32px desktop by the shell (do not re-add page padding).
- Branding is runtime-configurable: one `--theme-primary` variable drives accents everywhere; the app never hardcodes a brand hex outside defaults.
- Background: `#f8fafc` base with an 8%-alpha primary pixel grid at 80×80 tiles (authenticated portal backdrop only).

### 1.2 REPLACE (MRF content)
- Page names/descriptions, logo, organization name.
- Branding defaults (SMART defaults to emerald; MRF picks its own).

### 1.3 DO NOT
- Do not touch MRF's landing/login page (student/teacher entry).
- Do not add page-level horizontal padding inside routes (the shell's `main` handles it).
- Do not use breadcrumbs or nested page headers — one `PageHeader` per page.
- Do not hardcode the brand color in components; always read `--theme-primary` (or the branding context).
- Do not use a full-page loader for in-page data; only for the auth/session gate (in-page uses skeletons).

---

## 2. Page scaffolding

```tsx
export default function SomePage() {
  return (
    <div className="space-y-6 animate-fade-in max-w-[1400px] mx-auto w-full">
      <PageHeader title="..." description="..." actions={<Button size="sm">...</Button>} />
      {/* content: DataTable, Cards, forms */}
    </div>
  );
}
```

| Concern | Value |
|---|---|
| Vertical rhythm | 24px between page sections (`space-y-6`) |
| Max content width | 1400px centered |
| Page entrance | `fadeIn 0.4s ease-out forwards` (utility `.animate-fade-in`) |
| Main padding | shell provides `p-4 lg:p-8` |
| Narrow single-column pages | `max-w-[900px]` (forms, lists) or `max-w-[860px]` |
| Dense/wide pages | `max-w-7xl mx-auto pb-12` (teacher portal pattern) |

---

## 3. PageHeader

```tsx
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  badge?: ReactNode;
  className?: string;
}

export function PageHeader({ title, description, actions, badge, className }: PageHeaderProps) {
  return (
    <div className={cn("flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4", className)}>
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{title}</h1>
        {badge}
      </div>
      <div className="flex items-center gap-3">
        {description && (
          <p className="text-sm text-muted-foreground hidden sm:block">{description}</p>
        )}
        {actions}
      </div>
    </div>
  );
}
```

Rules:
- `badge` sits inline after the title (e.g., a count pill or status chip).
- Description hides below 640px to protect the actions; keep it under ~80 characters.
- Actions: primary first (`Button size="sm" className="font-semibold text-xs shadow-sm shadow-primary/20"` + icon), secondary `outline`, icon-only `ghost` with `aria-label`.

---

## 4. Loading gate

While the session/user is resolving, render a centered gate — never a blank screen:

```tsx
<div className="min-h-screen flex items-center justify-center bg-[var(--bg)]">
  <div className="flex flex-col items-center gap-4" role="status" aria-label="Loading">
    <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
    <p className="text-muted-foreground font-medium">Loading...</p>
  </div>
</div>
```

SMART's legacy version uses `bg-slate-100`, an emerald border, and gray text — replace with the semantic recipe above when porting.

In-page data loading uses skeletons, empty states, and page error blocks (see tables/feedback docs).

---

## 5. Runtime branding

### 5.1 Theme contract

Defaults (replace with MRF's):

```ts
const defaultColors = {
  primary: "#10b981",   // emerald-500
  secondary: "#34d399", // emerald-400
  accent: "#6ee7b7",    // emerald-300
};
```

On load (and on settings change), set on `document.documentElement`:

```
--theme-primary, --theme-secondary, --theme-accent        (raw brand colors)
--theme-primary-light / -dark                              (±40 per RGB channel)
--theme-primary-rgb                                        ("16, 185, 129" for alpha math)
--theme-primary-text                                       auto contrast: #1f2937 or #ffffff
--primary, --color-primary, --primary-foreground, --ring   (mirror into Tailwind tokens)
--chart-1                                                  (charts follow the brand)
```

Contrast helper: compute luminance `(0.299R + 0.587G + 0.114B) / 255`; if > 0.5 use dark text, else white.

Branding context exposes: `colors`, `logoUrl`, `schoolName` (org name), plus optional address/division/region/id and current school year. Cache to `localStorage` and apply before first paint to avoid a flash; refresh from a public settings endpoint and subscribe to a realtime settings stream if available.

Document metadata:
- Title: `<org name> | MRF` (fallback `MRF — <tagline>`).
- Favicon: swap `<link rel="icon">` to the uploaded logo when present.

Applying the brand accent to a subtree is done with inline CSS vars (used on scoped screens, not the landing page):

```tsx
style={{ "--primary": "var(--theme-primary)", "--accent": "var(--theme-accent)" } as React.CSSProperties}
```

### 5.2 Pixel grid backdrop (authenticated portal)

```tsx
export default function PixelGridBackground() {
  return (
    <div
      className="pointer-events-none fixed inset-0 -z-10"
      style={{
        backgroundImage:
          "linear-gradient(to bottom right, #f8fafc 0%, rgba(var(--theme-primary-rgb), 0.08) 50%, rgba(var(--theme-primary-rgb), 0.06) 100%)",
      }}
      aria-hidden="true"
    >
      <svg className="absolute inset-0 h-full w-full opacity-[0.08]" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id="app-pixel-grid" x="0" y="0" width="80" height="80" patternUnits="userSpaceOnUse">
            <rect x="2" y="2" width="36" height="36" rx="2" fill="none" stroke="var(--theme-primary)" strokeWidth="1.5" />
            <rect x="42" y="2" width="36" height="36" rx="2" fill="none" stroke="var(--theme-primary)" strokeWidth="1.5" />
            <rect x="2" y="42" width="36" height="36" rx="2" fill="none" stroke="var(--theme-primary)" strokeWidth="1.5" />
            <rect x="42" y="42" width="36" height="36" rx="2" fill="none" stroke="var(--theme-primary)" strokeWidth="1.5" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#app-pixel-grid)" />
      </svg>
    </div>
  );
}
```

---

## 6. Utilities

| Utility | Definition | Use |
|---|---|---|
| `.animate-fade-in` | `fadeIn 0.4s ease-out forwards` (opacity 0→1) | Every page root |
| `.print-hide` | hides element in print | Overlays, drawers, side panels |
| `.custom-scrollbar` | 4px light track/thumb | Sidebar only |
| Font sizes | root 16px, 15px below 640px | Global (defined in the already-delivered shell handoff) |

Fonts: **DM Sans** (Google Fonts, variable) with system fallbacks; sidebar hard-sets it — see the delivered shell handoff.

---

## 7. Acceptance criteria

- [ ] Every page root uses `space-y-6`, is centered with `max-w-[1400px]`, and fades in over 400ms.
- [ ] Main content padding comes only from the shell (`p-4 lg:p-8`).
- [ ] `PageHeader` renders a 24px bold title with optional inline badge, right-aligned actions with 12px gaps, and a 14px muted description that hides below 640px.
- [ ] The loading gate is a centered 48px primary ring spinner with a status label, not a blank screen.
- [ ] Branding: changing the primary color updates the portal buttons, active states, pixel grid, and chart color 1 without touching component code; contrast text flips automatically for light primaries.
- [ ] Logo, org name, and favicon update from the branding source; document title follows `<org> | MRF`.
- [ ] Pixel grid: 80×80 SVG tile, 36px rounded squares (rx 2) with 1.5px primary stroke at 8% opacity over a slate-to-primary gradient.
- [ ] `print-hide` is applied to overlays and drawers; no raw brand hex appears in components (defaults only).
- [ ] MRF's landing/login page (student/teacher entry) is untouched — no shared components, routes, or styles were modified there.
