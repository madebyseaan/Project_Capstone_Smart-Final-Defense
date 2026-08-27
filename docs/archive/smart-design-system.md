# SMART Dashboard — Design System & Component Specifications

> Reference document for the ATLAS sister application. All values are extracted directly from the SMART codebase (React 19 + Tailwind CSS v4 + shadcn/ui base-nova).

---

## 1. Global Tokens & Typography

### Font Families

| Token | Value | CSS Variable |
|-------|-------|--------------|
| Primary / Sans | `'Inter', 'Instrument Sans', 'Geist Variable', sans-serif` | `--font-sans` |
| Heading | `'Geist', 'Geist Variable', 'Inter', system-ui, -apple-system, sans-serif` | `--heading` |
| Monospace | `'Geist Mono', ui-monospace, 'SF Mono', Consolas, monospace` | `--mono` |

**Source:** `src/index.css:34-36` (CSS variables), `src/index.css:430` (`@theme inline` maps `--font-sans`).

The Geist font is loaded via `@fontsource-variable/geist` and Inter via Google Fonts.

### Base Font Sizes

| Context | Size | Notes |
|---------|------|-------|
| Root `<html>` | `16px` (1rem) | `font: 16px/1.6 var(--sans)` at `src/index.css:38` |
| Mobile `<640px>` | `15px` | `src/index.css:49-51` |
| Body line-height | `1.6` | `src/index.css:38` |
| Headings line-height | `1.25` | `src/index.css:163` |
| Letter-spacing (global) | `-0.011em` | `src/index.css:39` |
| Letter-spacing (headings) | `-0.025em` | `src/index.css:162` |

### Heading Scale

| Element | Size | Weight | Letter-spacing |
|---------|------|--------|----------------|
| `h1` | `clamp(1.875rem, 4vw, 2.5rem)` | 700 | `-0.03em` |
| `h2` | `clamp(1.25rem, 2.5vw, 1.5rem)` | 600 | `-0.025em` |
| `h3` | `clamp(1.125rem, 2vw, 1.25rem)` | 600 | `-0.025em` |
| `h4`–`h6` | inherit 600 weight | 600 | `-0.025em` |

### Spacing Scale

The project uses Tailwind's default spacing scale. Standard layout values observed in practice:

| Usage | Tailwind Class | Value |
|-------|---------------|-------|
| Page horizontal padding (mobile) | `p-4` | `1rem` (16px) |
| Page horizontal padding (desktop) | `p-4 lg:p-8` | `1rem` → `2rem` (16px → 32px) |
| Page container max-width | `max-w-[1440px]` | 1440px (via `.page-container`) |
| Card internal padding | `px-6 py-5` (default), `px-4 py-3` (sm) | 24px/20px, 16px/12px |
| Card header padding | `px-6 py-4` (default), `px-4 py-3` (sm) | 24px/16px, 16px/12px |
| Table cell padding | `px-4 py-3` | 16px/12px |
| Sidebar nav item padding | `px-4 py-1.5` | 16px/6px |
| Gap between stat cards | `gap-4` | `1rem` (16px) |
| Section vertical spacing | `space-y-6` or `space-y-8` | 24px or 32px |
| Inline element gaps | `gap-1.5` to `gap-3` | 6px to 12px |

### Border Radius Scale

Base radius: `--radius: 0.75rem` (12px).

| Token | Computed Value | px (at 16px root) |
|-------|---------------|-------------------|
| `--radius-sm` | `0.75rem * 0.6` | 7.2px |
| `--radius-md` | `0.75rem * 0.8` | 9.6px |
| `--radius-lg` | `0.75rem` | 12px |
| `--radius-xl` | `0.75rem * 1.4` | 16.8px |
| `--radius-2xl` | `0.75rem * 1.8` | 21.6px |
| `--radius-3xl` | `0.75rem * 2.2` | 26.4px |
| `--radius-4xl` | `0.75rem * 2.6` | 31.2px |

**Component radius usage:**

| Component | Radius Class / Value |
|-----------|---------------------|
| Card | `rounded-xl` (16.8px) |
| Button (default) | `rounded-lg` (12px) |
| Button (xs/sm) | `rounded-[min(var(--radius-md),10px/12px)]` |
| Input | `rounded-lg` (12px) |
| Badge | `rounded-4xl` (31.2px) — pill shape |
| Select trigger | `rounded-md` (9.6px) |
| Nav items (sidebar) | `rounded-full` — pill shape |
| Code blocks | `6px` hardcoded |

### Color Palette

#### Core Semantic Colors (Light Mode)

All colors use `oklch` format in the CSS. Approximate hex equivalents provided for reference.

| Token | oklch Value | Approx. Hex | Tailwind Class |
|-------|------------|-------------|----------------|
| `--background` | `oklch(0.99 0 0)` | `#fcfcfc` | `bg-background` |
| `--foreground` | `oklch(0.145 0 0)` | `#262626` | `text-foreground` |
| `--card` | `oklch(1 0 0)` | `#ffffff` | `bg-card` |
| `--card-foreground` | `oklch(0.145 0 0)` | `#262626` | `text-card-foreground` |
| `--primary` | `oklch(0.696 0.17 162.48)` | `#10b981` | `bg-primary` |
| `--primary-foreground` | `oklch(0.985 0 0)` | `#fafafa` | `text-primary-foreground` |
| `--secondary` | `oklch(0.97 0.005 240)` | `#f5f5f5` | `bg-secondary` |
| `--secondary-foreground` | `oklch(0.205 0 0)` | `#333333` | `text-secondary-foreground` |
| `--muted` | `oklch(0.97 0 0)` | `#f5f5f5` | `bg-muted` |
| `--muted-foreground` | `oklch(0.48 0 0)` | `#8a8a8a` | `text-muted-foreground` |
| `--accent` | `oklch(0.97 0 0)` | `#f5f5f5` | `bg-accent` |
| `--accent-foreground` | `oklch(0.205 0 0)` | `#333333` | `text-accent-foreground` |
| `--destructive` | `oklch(0.577 0.245 27.325)` | `#dc2626` | `bg-destructive` |
| `--border` | `oklch(0.922 0 0)` | `#ebebeb` | `border-border` |
| `--input` | `oklch(0.93 0 0)` | `#ededed` | `border-input` |
| `--ring` | `oklch(0.696 0.17 162.48)` | `#10b981` | `ring-ring` |

#### Sidebar Colors

| Token | Value |
|-------|-------|
| `--sidebar` | `oklch(0.99 0 0)` — near-white |
| `--sidebar-foreground` | `oklch(0.145 0 0)` |
| `--sidebar-primary` | `oklch(0.696 0.17 162.48)` — emerald |
| `--sidebar-accent` | `oklch(0.97 0.01 165)` — faint green tint |
| `--sidebar-border` | `oklch(0.935 0 0)` |

#### Non-Token Hardcoded Colors (Frequently Used)

| Color | Usage |
|-------|-------|
| `#fafbfc` / `#fafafa` | App canvas background, sidebar background |
| `#f8fafc` | Table header gradient start |
| `#f1f5f9` | Table header gradient end, skeleton base |
| `#e2e8f0` | Input borders, skeleton shimmer, scrollbar thumb |
| `#cbd5e1` | Scrollbar thumb hover |
| `#94a3b8` | Placeholder text, muted text |
| `#0f172a` / `#0F1729` | Sidebar text color, headings in dark mode |
| `#10b981` | Primary brand (emerald-500), focus rings, accent glow |
| `#059669` | Primary hover (emerald-600) |
| `#111827` | Page titles |
| `#1e293b` | Slate-700, dark mode borders |
| `slate-100` (`bg-slate-100`) | Admin page canvas background |
| `slate-200` | Card borders, avatar fallback backgrounds |
| `slate-500` | Navbar portal label text |

#### Chart Colors

| Token | oklch Value |
|-------|------------|
| `--chart-1` | `oklch(0.696 0.17 162.48)` — emerald |
| `--chart-2` | `oklch(0.6 0.2 250)` — blue |
| `--chart-3` | `oklch(0.65 0.18 310)` — pink |
| `--chart-4` | `oklch(0.7 0.18 50)` — amber |
| `--chart-5` | `oklch(0.55 0.2 200)` — teal |

### Shadow / Elevation Scale

| Token | Value |
|-------|-------|
| `--shadow-xs` | `0 1px 2px rgba(0,0,0,0.04)` |
| `--shadow-sm` | `0 2px 4px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.06)` |
| `--shadow-md` | `0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -1px rgba(0,0,0,0.04)` |
| `--shadow-lg` | `0 10px 15px -3px rgba(0,0,0,0.06), 0 4px 6px -2px rgba(0,0,0,0.04)` |
| `--shadow-xl` | `0 20px 25px -5px rgba(0,0,0,0.06), 0 10px 10px -5px rgba(0,0,0,0.03)` |
| `--shadow-2xl` | `0 25px 50px -12px rgba(0,0,0,0.15)` |
| `--shadow-glow` | `0 0 40px rgba(16,185,129,0.15)` |
| `--shadow-emerald` | `0 10px 30px -5px rgba(16,185,129,0.25)` |

### Focus Ring

```css
/* Global focus ring */
*:focus-visible {
  outline: 2px solid #10b981;  /* emerald-500 */
  outline-offset: 2px;
}
```

shadcn components use: `focus-visible:ring-3 focus-visible:ring-ring/50` with `ring` = `#10b981`.

---

## 2. Dashboard Layout Architecture

### App Shell Dimensions

| Element | Dimension | Tailwind Class |
|---------|-----------|----------------|
| Sidebar width (expanded) | `280px` | `w-[280px]` |
| Sidebar width (collapsed) | `70px` | `lg:w-[70px]` |
| Top navbar height | `64px` (h-16) | `h-16` |
| Sidebar logo area height | `96px` (h-24) | `h-24` |
| Mobile sidebar backdrop | Full viewport | `fixed inset-0 bg-black/50` |

**Source:** `src/layouts/AdminLayout.tsx:179,503`

### Canvas Backgrounds

| Surface | Color | Notes |
|---------|-------|-------|
| Main app canvas (body) | `linear-gradient(135deg, #fafbfc 0%, #f0fdf4 50%, #ecfdf5 100%)` | Gradient with green tint |
| Admin page canvas | `bg-slate-100` | Applied to the `min-h-screen` wrapper |
| Sidebar | `bg-[#fafafa]` | Near-white |
| Top navbar | `bg-white/80 backdrop-blur-md` | Glassmorphism with blur |
| Elevated content (cards) | `bg-white` (Card) or `oklch(1 0 0)` (CSS var) | Pure white |
| Card header | `bg-zinc-50/60` | Faint gray tint |
| Card footer | `bg-muted/50` | Muted background at 50% opacity |

### Page Container

```css
/* From App.css */
.page-container {
  max-width: 1440px;
  margin: 0 auto;
  padding: 0 1.5rem;  /* 24px horizontal */
}
```

**Main content area padding:** `p-4 lg:p-8` (16px mobile → 32px desktop).

**Standard responsive grid for stat cards:** `grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4`.

### Sidebar Styling

```
Background:     bg-[#fafafa]
Border:         border-r border-slate-200
Shadow:         shadow-sm
Nav items:      rounded-full, text-[14px] font-medium
Active item:    bg-[var(--theme-primary)] text-white shadow-sm
Inactive item:  text-[#0F1729] hover:bg-white/80
Group labels:   text-[0.625rem] font-bold text-[#0F1729]/60 uppercase tracking-normal
Nav item icon:  w-5 h-5, strokeWidth={2.2}
Collapsed icon: w-5 h-5, centered in h-10 w-10 container
User section:   bg-white/20, border-t border-slate-100
```

### Top Navbar Styling

```
Height:         h-16 (64px)
Background:     bg-white/80 backdrop-blur-md
Border:         border-b border-slate-200
Position:       sticky top-0 z-30
Padding:        px-4 lg:px-6
Portal label:   text-xs font-medium text-slate-500 uppercase tracking-wider
Page title:     text-base font-bold text-slate-900
School badge:   text-[10px] font-bold tracking-wider px-2 py-1 rounded-lg bg-slate-100 text-slate-600
```

---

## 3. Core Component Styling

### Cards / Containers

**shadcn Card base classes** (`src/components/ui/card.tsx`):

```
Card:
  flex flex-col overflow-hidden rounded-xl bg-white text-sm text-card-foreground
  border border-zinc-200/80
  shadow-[0_2px_8px_-3px_rgba(0,0,0,0.06),0_10px_22px_-6px_rgba(0,0,0,0.04)]
  transition-shadow duration-200
  py-0 gap-0

CardHeader:
  grid auto-rows-min items-start gap-1
  rounded-t-xl px-6 py-4
  bg-zinc-50/60
  border-b border-zinc-100

CardTitle:
  font-heading text-base leading-snug font-semibold tracking-tight text-zinc-900

CardDescription:
  font-mono text-xs tracking-wider font-medium text-zinc-400 uppercase

CardContent:
  px-6 py-5

CardFooter:
  flex items-center rounded-b-xl border-t bg-muted/50 p-4
```

**Size variant (`sm`):** `data-[size=sm]` → CardHeader: `px-4 py-3`, CardContent: `px-4 py-3`, CardFooter: `p-3`.

**Premium elevated card** (from `App.css`):

```css
.card-elevated {
  background: white;
  border-radius: 16px;
  border: 1px solid rgba(0, 0, 0, 0.04);
  box-shadow: 0 1px 3px rgba(0,0,0,0.04), 0 4px 6px -1px rgba(0,0,0,0.05), 0 10px 15px -3px rgba(0,0,0,0.04);
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}
.card-elevated:hover {
  transform: translateY(-4px);
  box-shadow: 0 4px 6px rgba(0,0,0,0.04), 0 10px 15px -3px rgba(0,0,0,0.06), 0 20px 25px -5px rgba(0,0,0,0.06);
}
```

**Card hover utility:**

```css
.card-hover { transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); }
.card-hover:hover { transform: translateY(-4px); box-shadow: var(--shadow-xl); }
```

**Standard stat card class string (copy-paste):**

```jsx
<Card className="border border-slate-200">
  <CardContent className="p-5">
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <p className="text-2xl font-bold text-foreground">{value}</p>
      </div>
      <div className="h-12 w-12 rounded-xl bg-[{colors.primary}]/10 flex items-center justify-center">
        <Icon className="h-6 w-6" style={{ color: colors.primary }} />
      </div>
    </div>
  </CardContent>
</Card>
```

### Tables

**shadcn Table base classes** (`src/components/ui/table.tsx`):

```
Table:
  w-full caption-bottom text-sm

TableHeader:
  [&_tr]:border-b

TableHead:
  h-11 px-4 py-3 text-left align-middle font-semibold text-xs uppercase tracking-wider text-zinc-500 whitespace-nowrap

TableRow:
  border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted

TableCell:
  px-4 py-3 align-middle whitespace-nowrap

TableFooter:
  border-t bg-muted/50 font-medium [&>tr]:last:border-b-0
```

**Premium table header** (from `App.css` `.table-modern`):

```css
.table-modern thead {
  background: linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%);
}
.table-modern tbody tr { transition: all 0.2s ease; }
.table-modern tbody tr:hover { background: rgba(16, 185, 129, 0.03); }
```

**Standard table class string (copy-paste):**

```jsx
<Table>
  <TableHeader>
    <TableRow className="bg-gradient-to-b from-slate-50 to-slate-100">
      <TableHead>Name</TableHead>
      <TableHead>Status</TableHead>
    </TableRow>
  </TableHeader>
  <TableBody>
    <TableRow>
      <TableCell className="font-medium">Item</TableCell>
      <TableCell><Badge>Active</Badge></TableCell>
    </TableRow>
  </TableBody>
</Table>
```

### Buttons

**shadcn Button base classes** (`src/components/ui/button.tsx`):

```
Base:
  inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent
  bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none
  focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50
  active:not-aria-[haspopup]:translate-y-px
  disabled:pointer-events-none disabled:opacity-50
```

#### Variant Classes

| Variant | Classes |
|---------|---------|
| **default** | `bg-primary text-primary-foreground [a]:hover:bg-primary/80` |
| **outline** | `border-border bg-background hover:bg-muted hover:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50` |
| **secondary** | `bg-secondary text-secondary-foreground hover:bg-secondary/80` |
| **ghost** | `hover:bg-muted hover:text-foreground dark:hover:bg-muted/50` |
| **destructive** | `bg-destructive/10 text-destructive hover:bg-destructive/20` |
| **link** | `text-primary underline-offset-4 hover:underline` |

#### Size Classes

| Size | Classes | Effective Height |
|------|---------|-----------------|
| `xs` | `h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs` | 24px |
| `sm` | `h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem]` | 28px |
| **default** | `h-8 gap-1.5 px-2.5` | 32px |
| `lg` | `h-9 gap-1.5 px-2.5` | 36px |
| `icon` | `size-8` | 32×32px |
| `icon-xs` | `size-6 rounded-[min(var(--radius-md),10px)]` | 24×24px |
| `icon-sm` | `size-7 rounded-[min(var(--radius-md),12px)]` | 28×28px |
| `icon-lg` | `size-9` | 36×36px |

**Gradient primary button** (from `App.css`):

```css
.btn-primary-gradient {
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  color: white; border: none; border-radius: 12px; font-weight: 600;
  box-shadow: 0 4px 14px -3px rgba(16, 185, 129, 0.4);
}
.btn-primary-gradient:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 20px -4px rgba(16, 185, 129, 0.5);
}
```

### Inputs

**shadcn Input base classes** (`src/components/ui/input.tsx`):

```
h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base
transition-colors outline-none
placeholder:text-muted-foreground
focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50
disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50
md:text-sm
```

**Premium input** (from `App.css` `.input-modern`):

```css
.input-modern {
  border: 1.5px solid #e2e8f0;
  border-radius: 12px;
  padding: 0.75rem 1rem;      /* 12px 16px */
  font-size: 0.9375rem;        /* 15px */
  background: #fafbfc;
}
.input-modern:focus {
  border-color: #10b981;
  box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.12);
  background: white;
}
```

### Select / Dropdown

**SelectTrigger classes** (`src/components/ui/select.tsx`):

```
default:  h-10 rounded-md border border-zinc-200 bg-white py-2 px-3 text-sm font-medium
          text-zinc-800 uppercase tracking-wider shadow-sm
          hover:border-zinc-300 focus:ring-1 focus:ring-blue-500 focus:border-blue-500
sm:       h-8
```

**SelectContent:** `rounded-md bg-white border border-zinc-200 shadow-md ring-1 ring-foreground/10`.

**SelectItem:** `rounded-md py-1.5 pr-8 pl-2.5 text-sm uppercase tracking-wider focus:bg-blue-500 focus:text-white`.

### Badges / Status Indicators

**shadcn Badge base classes** (`src/components/ui/badge.tsx`):

```
Base:
  inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden
  rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap
  transition-all
```

**Height:** `h-5` = 20px. **Padding:** `px-2 py-0.5` = 8px horizontal, 2px vertical. **Font:** `text-xs` (12px). **Radius:** `rounded-4xl` (pill).

#### Badge Variant Classes

| Variant | Classes |
|---------|---------|
| **default** | `bg-primary text-primary-foreground` |
| **secondary** | `bg-secondary text-secondary-foreground` |
| **destructive** | `bg-destructive/10 text-destructive` |
| **outline** | `border-border text-foreground` |
| **ghost** | `hover:bg-muted hover:text-muted-foreground` |

**Glow badge effect** (from `App.css`):

```css
.badge-glow::before {
  content: ''; position: absolute; inset: 0; border-radius: inherit; padding: 1px;
  background: linear-gradient(135deg, #10b981, #059669);
  mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  mask-composite: exclude; -webkit-mask-composite: xor; opacity: 0; transition: opacity 0.3s;
}
.badge-glow:hover::before { opacity: 1; }
```

**Theme-colored status badge pattern** (used in dashboards):

```jsx
<span
  className="inline-flex items-center gap-1 text-[10px] font-bold tracking-wider px-2 py-1 rounded-lg"
  style={{ backgroundColor: `${colors.primary}15`, color: colors.primary }}
>
  {status}
</span>
```

### Pagination

Pagination buttons use the `Button` component with consistent sizing:

```
All pagination buttons:  h-8 w-8 rounded-lg
Active page button:      variant="default" + bg-blue-600 hover:bg-blue-700
Inactive page buttons:   variant="outline"
```

**Item count text:** `text-sm text-gray-600` with bold values via `font-medium`.

**Standard class string:**

```jsx
<Button variant="outline" size="icon" className="h-8 w-8 rounded-lg">
  <ChevronLeft className="h-4 w-4" />
</Button>
```

---

## 4. Utility Classes & Patterns

### Animation Utilities

| Class | Animation | Duration |
|-------|-----------|----------|
| `animate-fade-in` | `fadeIn` — opacity 0→1 | 0.4s ease-out |
| `animate-slide-up` | `slideUp` — translateY(20px)→0 + fade | 0.5s ease-out |
| `animate-slide-in-right` | `slideInRight` — translateX(20px)→0 + fade | 0.4s ease-out |
| `animate-scale-in` | `scaleIn` — scale(0.95)→1 + fade | 0.3s ease-out |
| `animate-float` | `float` — translateY 0→-8px→0 | 4s infinite |
| `animate-pulse-subtle` | `pulse-subtle` — opacity 1→0.9→1 | 3s infinite |
| `animate-gradient` | `gradient-shift` — background-position cycle | 8s infinite |
| `animate-spin-slow` | 360° rotation | 8s linear infinite |

### Glass Morphism

```css
.glass {
  background: rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.4);
}
```

### Skeleton Loading

```css
.skeleton {
  background: linear-gradient(90deg, #f1f5f9 25%, #e2e8f0 50%, #f1f5f9 75%);
  background-size: 200% 100%;
  animation: skeleton-loading 1.5s ease-in-out infinite;
  border-radius: 8px;
}
```

### Scrollbar Styling

| Context | Width | Track | Thumb | Thumb Hover |
|---------|-------|-------|-------|-------------|
| Global | `8px` | `#f1f5f9`, radius 4px | `#cbd5e1`, radius 4px | `#94a3b8` |
| Sidebar (`.custom-scrollbar`) | `4px` | transparent | `#e2e8f0`, radius 4px | `#cbd5e1` |

### Smooth Transitions (Global)

```css
button, a, input, select, textarea {
  transition-property: color, background-color, border-color, box-shadow, transform, opacity;
  transition-duration: 0.2s;
  transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
}
```

### Gradient Text

```css
.text-gradient {
  background: linear-gradient(135deg, #10b981 0%, #059669 50%, #047857 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
```

### Background Mesh

```css
.bg-mesh {
  background-color: #fafbfc;
  background-image:
    radial-gradient(at 40% 20%, rgba(16, 185, 129, 0.08) 0px, transparent 50%),
    radial-gradient(at 80% 0%, rgba(6, 182, 212, 0.06) 0px, transparent 50%),
    radial-gradient(at 0% 50%, rgba(59, 130, 246, 0.04) 0px, transparent 50%),
    radial-gradient(at 80% 50%, rgba(167, 139, 250, 0.05) 0px, transparent 50%);
}
```

---

## 5. Page-Level Composition Patterns

### Dashboard Page Wrapper

```jsx
<div className="space-y-6 animate-fade-in">
  {/* Header */}
  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
    <div>
      <h1 className="text-3xl font-bold text-gray-900">{title}</h1>
      <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
    </div>
    <div className="flex items-center gap-3">
      {/* Status badges and action buttons */}
    </div>
  </div>

  {/* Stat cards grid */}
  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
    {/* Stat cards */}
  </div>

  {/* Main content cards */}
  <Card>
    <CardHeader>
      <CardTitle>Section Title</CardTitle>
      <CardDescription>OPTIONAL SUBTITLE</CardDescription>
    </CardHeader>
    <CardContent>
      {/* Table or content */}
    </CardContent>
  </Card>
</div>
```

### Stat Card Pattern

```jsx
<Card className="border border-slate-200">
  <CardContent className="p-5">
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <p className="text-2xl font-bold text-foreground stat-number">{value}</p>
      </div>
      <div
        className="h-12 w-12 rounded-xl flex items-center justify-center"
        style={{ backgroundColor: `${colors.primary}15` }}
      >
        <Icon className="h-6 w-6" style={{ color: colors.primary }} />
      </div>
    </div>
    {note && (
      <p className="text-xs text-muted-foreground mt-2">{note}</p>
    )}
  </CardContent>
</Card>
```

### Loading State Pattern

```jsx
<div className="min-h-screen flex items-center justify-center bg-slate-100">
  <div className="flex flex-col items-center gap-4">
    <div
      className="w-12 h-12 border-4 border-t-transparent rounded-full animate-spin"
      style={{ borderColor: colors.primary, borderTopColor: 'transparent' }}
    />
    <p className="text-gray-600 font-medium">Loading...</p>
  </div>
</div>
```

### Error State Pattern

```jsx
<div className="flex flex-col items-center justify-center py-12">
  <AlertTriangle className="w-12 h-12 text-amber-500 mb-4" />
  <p className="text-gray-600 mb-4">{errorMessage}</p>
  <Button onClick={retry}>Try Again</Button>
</div>
```

---

## 6. Theme Integration

The SMART app uses a dynamic theming system via `ThemeContext`. The primary brand color is configurable per-school and applied via CSS custom properties:

| CSS Property | Set By | Example |
|-------------|--------|---------|
| `--theme-primary` | `applyThemeToDocument()` | `#10b981` |
| `--theme-primary-rgb` | `applyThemeToDocument()` | `16, 185, 129` |
| `--primary-color` | `applyThemeToDocument()` | `#10b981` |

**Access in React:** `const { colors } = useTheme()` → `colors.primary` = `"#10b981"`.

**Usage pattern for dynamic theming:**

```jsx
// Background with primary color at 10% opacity
style={{ backgroundColor: `${colors.primary}15` }}

// Text with primary color
style={{ color: colors.primary }}

// Gradient button
style={{ backgroundColor: colors.primary }}
```

**Default/fallback colors:**

```ts
{
  primary: '#10b981',    // emerald-500
  secondary: '#34d399',  // emerald-400
  accent: '#6ee7b7',     // emerald-300
}
```

---

## 7. Summary: Quick Reference Table

| Element | Key Classes / Values |
|---------|---------------------|
| **Page wrapper** | `space-y-6 animate-fade-in` |
| **Page title** | `text-3xl font-bold text-gray-900` |
| **Page subtitle** | `text-sm text-muted-foreground` |
| **Stat grid** | `grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4` |
| **Card** | `rounded-xl bg-white border border-zinc-200/80 shadow-[0_2px_8px_-3px_rgba(0,0,0,0.06),0_10px_22px_-6px_rgba(0,0,0,0.04)]` |
| **Card header** | `px-6 py-4 bg-zinc-50/60 border-b border-zinc-100 rounded-t-xl` |
| **Card content** | `px-6 py-5` |
| **Card title** | `font-heading text-base font-semibold tracking-tight text-zinc-900` |
| **Table head** | `h-11 px-4 py-3 font-semibold text-xs uppercase tracking-wider text-zinc-500` |
| **Table cell** | `px-4 py-3 text-sm` |
| **Table row hover** | `hover:bg-muted/50` or `hover:bg-[rgba(16,185,129,0.03)]` |
| **Button (default)** | `h-8 px-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium` |
| **Button (outline)** | `h-8 px-2.5 rounded-lg border-border bg-background text-sm font-medium` |
| **Input** | `h-8 rounded-lg border border-input px-2.5 py-1 text-base md:text-sm` |
| **Badge** | `h-5 rounded-4xl px-2 py-0.5 text-xs font-medium` |
| **Sidebar** | `w-[280px] bg-[#fafafa] border-r border-slate-200 shadow-sm` |
| **Navbar** | `h-16 bg-white/80 backdrop-blur-md border-b border-slate-200 sticky top-0` |
| **Focus ring** | `outline: 2px solid #10b981; outline-offset: 2px` |
| **Primary color** | `#10b981` (emerald-500) |
| **Canvas bg** | `linear-gradient(135deg, #fafbfc, #f0fdf4, #ecfdf5)` |
