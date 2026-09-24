# AI Handoff — SMART Buttons & Inputs for MRF

**How to use this document:** paste it into the MRF-side AI coding agent as the task brief. It is fully self-contained: the agent does not need access to the SMART repository. MRF supplies its own actions, labels, and data; the control styling, sizes, and states must match this spec.

**Scope: Admin and MRF staff portals only.** MRF has no data-entry forms, so this document covers only the shared controls used by tables, modals, toolbars, and the shell: **buttons, text inputs, textareas, and selects**. Form-specific patterns (labels, checkboxes, help tooltips, multi-field validation layouts) are intentionally excluded.

Companion docs: `AI_HANDOFF_PAGES_BRANDING.md` · `AI_HANDOFF_TABLES.md` · `AI_HANDOFF_MODALS_DRAWERS.md` · `AI_HANDOFF_NOTIFICATIONS_FEEDBACK.md` · `AI_HANDOFF_DATA_DISPLAY.md` (shell/topbar/sidebar already delivered)

---

## 0. Task brief for the agent

Implement the control primitives used across MRF's list views, modals, and toolbars:

1. `Button` — variants and sizes for table actions, modal footers, toolbar actions, and icon buttons.
2. `Input` — search fields and modal text fields.
3. `Textarea` — multi-line note/description fields where used.
4. `Select` — table filters and the rows-per-page control.

Use MRF's own labels and data. Reference code is embedded in §6.

Stack used by the reference: React + Tailwind + `class-variance-authority` (button variants) + `@base-ui/react` primitives wrapped shadcn-style. Radix or native elements are fine — keep the class strings.

---

## 1. Hard rules

### 1.1 KEEP (do not alter)
- Default control height **32px** (`h-8`); comfortable height **36px** (`h-9`); large/hero height **44px** (`h-11`); toolbar selects **32px** (`h-8`) / default **40px** (`h-10`).
- Radius **12px** (`rounded-lg`) for buttons, inputs, textareas; **6–8px** for select triggers/popups per §5.
- Buttons are **14px / medium (500)**; small buttons **12.8px** (`text-[0.8rem]`); icon buttons are perfectly square.
- Focus ring: **3px ring at 50% of `--ring`** (`focus-visible:ring-3 ring-ring/50`) plus border color switch to `--ring`.
- Invalid/error state (where validated): border `destructive`, ring `destructive/20` via `aria-invalid`.
- Disabled: `opacity 50%`, `pointer-events: none` on buttons; `cursor-not-allowed` + 50% on inputs.
- Placeholder color is `muted-foreground`; input text is `foreground`.
- Press feedback on buttons: `translateY(1px)` (`active:translate-y-px`); icon buttons may use `active:scale-95`.

### 1.2 REPLACE (MRF content)
- Button labels, icons, search placeholders, filter options.

### 1.3 DO NOT
- Do not use pill (`rounded-full`) buttons except for explicit chip/filter patterns.
- Do not use heights above 32px for toolbar/dense-table actions, or below 32px for primary actions.
- Do not color borders with raw palette classes; use `border-input`, `border-ring`, `border-destructive`.
- Do not place labels inside inputs (floating labels).
- Do not add checkbox, radio, or help-tooltip primitives — MRF has no forms; if a future flow needs them, port them from the source system separately.

---

## 2. Tokens

| Element | Height | Radius | Padding | Text |
|---|---|---|---|---|
| Button default | 32px | 12px | 10px horizontal | 14px / 500 |
| Button `sm` | 28px | 12px | 10px horizontal | 12.8px / 500 |
| Button `lg` | 36px | 12px | 10px horizontal | 14px / 500 |
| Button `xs` | 24px | 10px | 8px horizontal | 12px / 500 |
| Icon button | 32px (`icon`), 28px (`icon-sm`), 24px (`icon-xs`), 36px (`icon-lg`) | 10–12px | — | — |
| Input | 32px | 12px | 10px horizontal, 4px vertical | 16px mobile → 14px `md:` |
| Textarea | min 64px | 12px | 12px horizontal, 8px vertical | same as input |
| Search input (page/toolbar) | 36px | 12px | `pl-8`, width 224px | 12px |
| Select trigger | 40px default / 32px `sm` | 6px | 12px horizontal | 14px / 500 |

Color tokens (semantic only): `border-input`, `bg-transparent`/`bg-background`, `text-foreground`, `placeholder:text-muted-foreground`, `ring-ring/50`, `bg-primary`/`text-primary-foreground`, `bg-destructive/10` + `text-destructive`, `bg-muted` hover, `focus:bg-accent` for menu/popup rows.

Motion: controls transition colors/box-shadow at default speed; press feedback is instant.

---

## 3. Buttons

### 3.1 Variants

| Variant | Classes (visual) | Use for |
|---|---|---|
| `default` | `bg-primary text-primary-foreground` | Primary action (one per view) |
| `outline` | `border-border bg-background hover:bg-muted hover:text-foreground` | Secondary actions, Cancel, Retry, paging |
| `secondary` | `bg-secondary text-secondary-foreground hover:bg-secondary/80` | Tertiary emphasis |
| `ghost` | `hover:bg-muted hover:text-foreground` | Icon actions, dismiss, row actions |
| `destructive` | `bg-destructive/10 text-destructive hover:bg-destructive/20` | Delete/remove |
| `link` | `text-primary underline-offset-4 hover:underline` | Inline links |

### 3.2 Base recipe

```
inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent
bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none
focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50
active:not-aria-[haspopup]:translate-y-px
disabled:pointer-events-none disabled:opacity-50
[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4
```

Sizes: `default h-8 gap-1.5 px-2.5` · `xs h-6 gap-1 px-2 text-xs` · `sm h-7 gap-1 px-2.5 text-[0.8rem]` · `lg h-9 gap-1.5 px-2.5` · `icon size-8` · `icon-xs size-6` · `icon-sm size-7` · `icon-lg size-9`.

### 3.3 Rules
- One `default` (primary) button per view/section; everything else is `outline`/`ghost`.
- Destructive confirmation always uses `ConfirmDialog` where the confirm button is a **solid red** (`#dc2626`) or primary filled at modal scale — inline destructive buttons use the `destructive` variant.
- Loading: prepend `Loader2` spinner 16px with `mr-2`, keep the button disabled.
- Icon + label: icon first, 6px gap (`gap-1.5`); trailing icon only for disclosure chevrons.
- Small table actions: `size="sm" variant="outline" className="h-8 text-xs"`.
- Icon-only buttons require `aria-label`; topbar-style icon buttons use `p-2 rounded-xl` with `hover:bg-slate-100`/`hover:bg-accent`.

---

## 4. Text inputs, textareas, search fields

Base input:

```
h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base
transition-colors outline-none
placeholder:text-muted-foreground
focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50
disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50
aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20
md:text-sm
```

Base textarea:

```
flex min-h-16 w-full rounded-lg border border-input bg-transparent px-3 py-2 text-base
transition-colors outline-none placeholder:text-muted-foreground
focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50
disabled:cursor-not-allowed disabled:opacity-50
aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20
md:text-sm
```

Search input recipe (page headers, table toolbars):

```tsx
<div className="relative">
  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
  <Input placeholder="Search..." className="pl-8 h-9 w-56 rounded-lg text-xs" />
</div>
```

Toolbar variant (inside card headers) uses a 16px icon and `pl-9 w-full sm:w-64` — see the tables doc.

---

## 5. Select

Required classes (canonical, semantic):

```
trigger:  flex w-full items-center justify-between gap-2 rounded-md border border-border
          bg-background py-2 px-3 text-sm font-medium whitespace-nowrap shadow-sm
          transition-all outline-none select-none
          hover:border-ring/60 focus:ring-1 focus:ring-ring focus:border-ring
          disabled:cursor-not-allowed disabled:opacity-50
          data-placeholder:text-muted-foreground
          default height 40px (h-10) · sm height 32px (h-8)
popup:    z-50 max-h-(--available-height) w-(--anchor-width) min-w-(--anchor-width)
          rounded-md bg-popover border border-border shadow-md ring-1 ring-foreground/10
          overflow-y-auto duration-100 (slide 8px + fade + zoom-95)
item:     relative flex w-full cursor-default items-center gap-1.5 rounded-md py-1.5 pr-8 pl-2.5
          text-sm outline-hidden select-none
          focus:bg-accent focus:text-accent-foreground
          disabled:pointer-events-none disabled:opacity-50
indicator: absolute right-2 size-4 CheckIcon on the selected row
search:   when options > 6, show a sticky search row (border-b, 12px icon, 12px input)
```

Notes:
- The SMART legacy trigger uses `zinc`/`blue` classes — **do not copy**; use the semantic recipe above.
- Chevron icon: 16px, muted, pointer-events none.
- Toolbar filters are 144px wide (`w-36`); pagination rows-per-page select is 80px (`w-20`, size `sm`).
- Used only for filtering and page-size control in MRF — no form validation states required.

---

## 6. Reference code

`Button`:

```tsx
import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
        outline: "border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80 aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost: "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground",
        destructive: "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        icon: "size-8",
        "icon-xs": "size-6 rounded-[min(var(--radius-md),10px)] [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7 rounded-[min(var(--radius-md),12px)]",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
)

function Button({ className, variant = "default", size = "default", ...props }: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return <ButtonPrimitive data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />
}

export { Button, buttonVariants }
```

`Input`:

```tsx
import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"
import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Input }
```

`Textarea`:

```tsx
import * as React from "react"
import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex min-h-16 w-full rounded-lg border border-input bg-transparent px-3 py-2 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
```

---

## 7. Acceptance criteria

- [ ] Default control height is 32px; comfortable 36px; large 44px; radius 12px; icon buttons are square.
- [ ] Buttons: one primary per view; `outline` for secondary/cancel/retry; `ghost` for icon actions; `destructive` for inline deletes; press shifts down 1px; disabled at 50% with no pointer events.
- [ ] Focus visible on every control as a 3px ring at 50% `--ring` plus border-color change.
- [ ] Inputs show `muted-foreground` placeholders; disabled inputs are non-interactive at 50% opacity.
- [ ] Textareas are at least 64px tall with 12px horizontal padding.
- [ ] Search fields use the inset-icon recipe (14px icon, `pl-8`, 36px tall, 224px wide) or the toolbar variant (16px icon, `pl-9`, 256px wide).
- [ ] Select trigger is 40px default / 32px small, `bg-background`, `border-border`, semantic tokens only (no zinc/blue), with a 16px muted chevron and an 8px-offset popup with a check indicator; filters are 144px wide and the page-size select is 80px.
- [ ] Table and modal docs' button usages (row actions, pagination, footers) match §3 exactly.
- [ ] No form-specific primitives were added (no checkbox/radio/help-tooltip), and MRF's landing/login page is untouched.
