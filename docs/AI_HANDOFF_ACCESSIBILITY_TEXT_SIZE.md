# AI Handoff — SMART Accessibility Text Size for MRF

**How to use this document:** paste it into the MRF-side AI coding agent as the task brief. It is fully self-contained: the agent does not need access to the SMART repository. MRF supplies its own storage key, icon placement, and primitive wiring; the behavior, formulas, and edge-case handling must match this spec exactly.

> **Update (per-user scoping):** the storage model below was revised after MRF reported that one user's setting leaked to every account on the same browser. Preferences are now stored per user (`<key>:<userId>`) with a bind/unbind lifecycle. See **`AI_HANDOFF_ACCESSIBILITY_TEXT_SIZE_USER_SCOPED.md`**, which supersedes §5–§6 of this document.

**What this is:** the accessibility "Text Size" control shipped in every SMART portal header — a small φ popover with a −/+ stepper that scales the app's text from 90% to 150% (default 100%), persists per browser, syncs across tabs, and never affects printed documents.

Companion docs: `AI_HANDOFF_SIDEBAR_TOPBAR.md` · `AI_HANDOFF_BUTTONS_INPUTS.md` · `AI_HANDOFF_TABLES.md` · `AI_HANDOFF_MODALS_DRAWERS.md` · `AI_HANDOFF_DATA_DISPLAY.md`

---

## 0. Task brief for the agent

Implement four things in MRF:

1. **CSS**: a `--text-scale` custom property that drives the root font size via `calc()`, plus a print-media pin so official printouts never scale.
2. **`TextScaleProvider`** (context): reads/persists the preference, clamps to allowed steps, applies before first paint (no flash), syncs across tabs.
3. **`AccessibilityMenu`** (header widget): icon trigger + popover containing "Accessibility" title, "Text Size" row with live percent, −/+ buttons, and a Reset row when ≠ 100%.
4. **Wiring**: provider at the app root (above routes); widget mounted in every portal/role header (next to the notification bell).

Full source is embedded in §5 and §6. Copy verbatim, then apply §1.2 replacements.

---

## 1. Hard rules

### 1.1 KEEP (do not alter)

- **Steps**: `[90, 100, 110, 120, 130, 140, 150]` — default `100`, step `10`. No free-form values.
- **Scaling formula**: root font size = `calc(16px * var(--text-scale))`; mobile (≤640px) base = `calc(15px * var(--text-scale))`. JS writes only `--text-scale` (`percent / 100`).
- **Default = zero change**: at 100%, `calc(16px * 1)` must equal the pre-feature value byte-for-byte. Never ship a visible difference at default.
- **Print pin**: `@media print { :root { --text-scale: 1 !important; } }`. An author `!important` declaration beats the inline style JS sets — this is what guarantees print is unaffected at any user scale. Verify it (see §8 step 3).
- **Persistence**: localStorage, try/catch on both read and write. Invalid/corrupt/missing value → 100. Storage key must be MRF-prefixed (e.g. `mrf_text_scale`).
- **No flash**: apply the stored scale in `useLayoutEffect` (runs after DOM commit, before first paint).
- **Clamping**: − disabled at 90; + disabled at 150. Buttons must use `disabled` + `aria-disabled` semantics via the primitive.
- **Menu behavior**: stays open while clicking −/+/Reset (do not let the menu close on item activation). Escape closes. Percent is announced via a live region (`role="status"`).
- **Trigger a11y**: real `<button>`, `aria-label` = `"Accessibility settings"` or `"Accessibility settings, text size N%"` when ≠ 100. Show a small indicator dot on the trigger when ≠ 100.
- **Only rem-based text scales.** Never touch px-fixed dimensions (dense tables, form grids, ledger). Those staying fixed is intended and is what keeps dense layouts from breaking.
- **This widget is an enhancement** — browser zoom remains the WCAG baseline. Do not claim it replaces zoom.

### 1.2 REPLACE (MRF content)

- Storage key prefix (`smart_text_scale` → MRF's own).
- File paths/locations to match MRF's structure.
- Icon choice (SMART uses lucide `Accessibility`, `Minus`, `Plus`, `RotateCcw`) — keep `lucide-react` if MRF already uses it.
- Header placement order (SMART puts it immediately left of the notification bell, same gap cluster).
- Wording is reusable as-is ("Accessibility", "Text Size", "Reset to 100%") — change only if MRF's locale requires it.

### 1.3 DO NOT

- Do NOT use CSS `zoom` or `transform: scale()` on the root (breaks portaled menus/dialogs, sticky/fixed headers, and print).
- Do NOT set computed inline `font-size` on `<html>`/`<body>` from JS — use the CSS variable + `calc()` so the print override and the mobile base size both keep working.
- Do NOT convert px-fixed text to rem as part of this task (that is a separate, much larger sweep).
- Do NOT add font-family, dyslexia font, or contrast options in this version. Scope is text size only.

---

## 2. Behavior spec

| Item | Value |
|---|---|
| Percent steps | 90, 100, 110, 120, 130, 140, 150 |
| Default | 100 (applies to every first-time user) |
| Effect at 100 | 16px root (15px ≤640px) — identical to no feature |
| Effect at 130 | 20.8px root; `text-sm` 14px → 18.2px |
| Range clamp | − disabled at 90, + disabled at 150 |
| Persistence | localStorage, per device/browser |
| Cross-tab | `storage` event listener updates other open tabs |
| Corrupt value | Falls back to 100 (never throws) |
| Print/PDF | Always 100% — pinned by `!important` in `@media print` |
| Applies to | All authenticated portals AND login/SSO screens (provider sits above the router) |
| Announcements | `role="status"` on the percent; trigger aria-label carries current % |

---

## 3. Why root font-size scaling (decision record)

| Option | Verdict | Reason |
|---|---|---|
| Root `font-size` + CSS var | **Chosen** | Default is byte-identical; cannot touch layout math, charts, portals, or print; trivial rollback (remove provider + 4 mounts + 2 CSS lines). |
| CSS `zoom` on `<html>` | Rejected | Scales px text too, but risks portaled popups, fixed/sticky chrome, and print fidelity; needs print reset anyway. |
| px → rem sweep of all text | Deferred | Total coverage, but ~600+ call sites; separate task with its own QA. |
| Per-component font scaling | Rejected | Unmaintainable. |

Known accepted limitation: hardcoded px text (small badges, ledger, form grids) does not grow. Document it to MRF's team up front.

---

## 4. CSS changes (exact)

Inside the root rule (SMART uses `:root`). If your root sets a `font:` shorthand, declare `font-size` **after** it — the later declaration wins.

```css
:root {
  /* Accessibility text scale (1 = 100%) — driven by TextScaleContext / AccessibilityMenu */
  --text-scale: 1;

  font: 16px/1.6 var(--sans);        /* existing */
  font-size: calc(16px * var(--text-scale));

  @media (max-width: 640px) {
    font-size: calc(15px * var(--text-scale));
  }
}
```

If MRF does not use CSS nesting, write the mobile rule as a separate `@media (max-width: 640px) { :root { font-size: calc(15px * var(--text-scale)); } }`.

Print pin — inside the existing print stylesheet (create one if absent):

```css
@media print {
  /* Official printouts stay at a fixed size — the on-screen text scale never affects print */
  :root {
    --text-scale: 1 !important;
  }
}
```

---

## 5. `TextScaleContext.tsx` (copy verbatim; rename the storage key)

```tsx
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
  type ReactNode,
} from "react";

/**
 * TextScaleContext — global accessibility text-size preference.
 *
 * Scales the root font size via the `--text-scale` CSS variable (index.css).
 * Only rem-based text grows; fixed px text is untouched.
 * Print is pinned to 100% in CSS, so official forms never change size.
 */

const TEXT_SCALE_STEPS = [90, 100, 110, 120, 130, 140, 150] as const;
const STORAGE_KEY = "smart_text_scale"; // MRF: use your own key, e.g. "mrf_text_scale"
const DEFAULT_PERCENT = 100;

interface TextScaleContextType {
  percent: number;
  canDecrease: boolean;
  canIncrease: boolean;
  decrease: () => void;
  increase: () => void;
  reset: () => void;
}

function normalizePercent(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return (TEXT_SCALE_STEPS as readonly number[]).includes(parsed) ? parsed : DEFAULT_PERCENT;
}

function readStoredPercent(): number {
  try {
    return normalizePercent(localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_PERCENT;
  }
}

function applyTextScale(percent: number) {
  document.documentElement.style.setProperty("--text-scale", String(percent / 100));
}

const TextScaleContext = createContext<TextScaleContextType>({
  percent: DEFAULT_PERCENT,
  canDecrease: false,
  canIncrease: false,
  decrease: () => {},
  increase: () => {},
  reset: () => {},
});

export function useTextScale() {
  return useContext(TextScaleContext);
}

export function TextScaleProvider({ children }: { children: ReactNode }) {
  const [percent, setPercent] = useState<number>(readStoredPercent);

  // Apply before first paint so a stored scale never flashes at 100%
  useLayoutEffect(() => {
    applyTextScale(percent);
  }, [percent]);

  const updatePercent = useCallback((next: number) => {
    const normalized = normalizePercent(next);
    setPercent(normalized);
    try {
      localStorage.setItem(STORAGE_KEY, String(normalized));
    } catch {
      /* storage unavailable — scale still applies for this session */
    }
  }, []);

  // Sync across tabs/windows
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) return;
      setPercent(normalizePercent(event.newValue));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const index = (TEXT_SCALE_STEPS as readonly number[]).indexOf(percent);
  const canDecrease = index > 0;
  const canIncrease = index < TEXT_SCALE_STEPS.length - 1;

  const decrease = () => {
    if (canDecrease) updatePercent(TEXT_SCALE_STEPS[index - 1]);
  };
  const increase = () => {
    if (canIncrease) updatePercent(TEXT_SCALE_STEPS[index + 1]);
  };
  const reset = () => updatePercent(DEFAULT_PERCENT);

  return (
    <TextScaleContext.Provider value={{ percent, canDecrease, canIncrease, decrease, increase, reset }}>
      {children}
    </TextScaleContext.Provider>
  );
}
```

---

## 6. `AccessibilityMenu.tsx` (copy; adapt primitives per §6.1)

```tsx
import { Accessibility, Minus, Plus, RotateCcw } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTextScale } from "@/contexts/TextScaleContext";

/**
 * AccessibilityMenu — header accessibility controls shared by all portals.
 * Exposes the global Text Size preference (90–150%, default 100%).
 */
export default function AccessibilityMenu() {
  const { percent, canDecrease, canIncrease, decrease, increase, reset } = useTextScale();

  const triggerLabel =
    percent === 100 ? "Accessibility settings" : `Accessibility settings, text size ${percent}%`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={triggerLabel}
            className="relative p-2 rounded-xl hover:bg-accent text-muted-foreground transition-all active:scale-95"
          />
        }
      >
        <Accessibility className="w-5 h-5" />
        {percent !== 100 && (
          <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-primary" aria-hidden="true" />
        )}
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-64 p-3">
        <div className="flex items-center gap-2 pb-2 border-b border-border">
          <Accessibility className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-semibold text-foreground">Accessibility</span>
        </div>

        <div className="flex items-center justify-between pt-3 pb-2">
          <span className="text-sm text-foreground">Text Size</span>
          <span className="text-sm font-semibold text-muted-foreground" role="status">
            {percent}%
          </span>
        </div>

        <div className="flex items-center gap-2">
          <DropdownMenuItem
            closeOnClick={false}
            disabled={!canDecrease}
            onClick={decrease}
            aria-label="Decrease text size"
            className="flex-1 h-9 justify-center border border-border bg-background px-0"
          >
            <Minus className="w-4 h-4" />
          </DropdownMenuItem>
          <DropdownMenuItem
            closeOnClick={false}
            disabled={!canIncrease}
            onClick={increase}
            aria-label="Increase text size"
            className="flex-1 h-9 justify-center border border-border bg-background px-0"
          >
            <Plus className="w-4 h-4" />
          </DropdownMenuItem>
        </div>

        {percent !== 100 && (
          <DropdownMenuItem
            closeOnClick={false}
            onClick={reset}
            className="mt-2 justify-center gap-1.5 text-xs text-muted-foreground"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset to 100%
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

### 6.1 Primitive adaptation (only this part changes per stack)

| MRF stack | Trigger | Keep menu open on −/+/Reset | Notes |
|---|---|---|---|
| `@base-ui/react` menu (SMART) | `render={<button ... />}` | `closeOnClick={false}` on each item | Exactly as shown. |
| Radix DropdownMenu | `asChild` on `DropdownMenuTrigger` | `onSelect={(e) => e.preventDefault()}` on each `DropdownMenuItem` | Radix closes menus on item select by default. |
| Headless UI `Menu` | `Menu.Button` | Render −/+/Reset as plain `<button>`s inside `Menu.Items` | Headless closes on click — wrap the controls in a panel that stops propagation, or use `Popover` instead of `Menu`. |
| Any popover primitive | Native `<button>` | Buttons don't close popovers by default | Keep `aria-label`s and `role="status"`; ensure Escape closes. |

Rules that apply to every stack:
- The −/+ controls are real focusable buttons reachable by keyboard (Enter/Space activate).
- Clicking −/+/Reset must not dismiss the panel.
- Escape always closes.
- The percent node keeps `role="status"` (live region) wherever it lives.

---

## 7. Wiring

**App root** — the provider goes above the router so login/SSO screens honor a stored scale too:

```tsx
<ThemeProvider>
  <TextScaleProvider>
    <RouterOrRoutes />
  </TextScaleProvider>
</ThemeProvider>
```

**Header** — mount in each authenticated layout's right-hand header cluster, immediately left of the notification bell, preserving the existing gap class:

```tsx
<div className="flex items-center gap-3">
  <AccessibilityMenu />
  <NotificationBell ... />
  {/* school-year badge, avatar, etc. unchanged */}
</div>
```

Rollback if ever needed: delete the four mount lines, the provider wrap, and the §4 CSS block. Nothing else depends on any of it.

---

## 8. Verification procedure (how SMART proved no regression)

Run against a production-style build (`vite preview` or equivalent). Use browser devtools or a Playwright script.

1. **Default state** — fresh profile, open any page:
   - `getComputedStyle(document.documentElement).fontSize === "16px"`
   - `localStorage.getItem("<KEY>") === null`
2. **Persistence + scaling** — `localStorage.setItem("<KEY>", "130")`, reload:
   - root font size `20.8px` (`16 × 1.3`)
   - a `text-sm` element (14px) computes to `18.2px`
3. **Print pinned** — emulate print media (`page.emulateMedia({ media: "print" })`) while scale is 130:
   - root font size is back to `16px` (the `!important` print pin beats the inline style)
4. **Corrupt storage** — set value `"abc"`, reload → behaves as 100, no console errors.
5. **Widget interactions** — open the menu:
   - `role="status"` shows the current %
   - each + / − click updates the % and root size, and the menu stays open
   - + is disabled at 150; − is disabled at 90
   - Reset appears only when ≠ 100; clicking it returns to 100 and the Reset row disappears
   - Escape closes
6. **Keyboard** — focus the trigger, press Enter (opens), ArrowDown (moves focus), Enter (activates) → percent changes.
7. **CI** — typecheck, production build, and lint must pass with 0 errors.

QA matrix for sign-off: all three portals × scales 100/130/150 × light/dark × mobile ≤640px; open a modal and a dropdown at 150% (portals must not clip); print-preview an official form at 130% and confirm it is identical to the 100% print.

---

## 9. Done checklist

- [ ] `--text-scale` var + root/mobile `calc()` font sizes in place; default renders identically to pre-feature.
- [ ] Print pin `:root { --text-scale: 1 !important }` inside `@media print`, verified with print emulation.
- [ ] `TextScaleProvider` sourced verbatim (MRF storage key), no-flash via `useLayoutEffect`, cross-tab sync, corrupt-value fallback.
- [ ] `AccessibilityMenu` mounted in every portal header; stays open while adjusting; Escape closes.
- [ ] −/+ disabled at bounds; Reset row only when ≠ 100; trigger dot + aria-label reflect current %.
- [ ] `role="status"` announces the percent; all controls keyboard-reachable.
- [ ] §8 verification steps all pass; CI (typecheck/build/lint) green.
- [ ] Known limitation documented to MRF team: hardcoded px text does not scale.
