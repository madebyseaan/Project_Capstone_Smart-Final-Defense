# AI Handoff — Accessibility Text Size Fix: Per-User Scoping (for MRF)

**How to use this document:** paste it into the MRF-side AI coding agent as a task brief. Supersedes §5 and §6 of `AI_HANDOFF_ACCESSIBILITY_TEXT_SIZE.md` (the original feature spec) — everything else in that document still applies. Fully self-contained.

**The bug MRF found:** the text-size preference was stored under one browser-wide key (`smart_text_scale`), so if User A changes the text size, **every other user and every portal on that browser inherits it** — wrong for shared school computers.

**The fix in one line:** store the preference **per user account** (`smart_text_scale:<userId>`), bind it to the signed-in user while their portal is open, and reset to 100% when signed out.

---

## 0. Symptom → root cause

| | |
|---|---|
| Symptom | Registrar sets 130% → Admin/Teacher logging into the same browser also see 130%. |
| Root cause | Single shared `localStorage` key: `smart_text_scale`. Sessions are per-tab/per-user, but the scale was per-browser. |
| Correct model | The preference belongs to the **user account**, not the browser, not the role/portal. |

---

## 1. The fix — design rules

### 1.1 KEEP (unchanged from the original spec)
- Steps `[90, 100, 110, 120, 130, 140, 150]`, default 100.
- Root scaling via `--text-scale` + `calc()`; print pin `@media print { :root { --text-scale: 1 !important; } }`.
- No flash: apply before paint (`useLayoutEffect`).
- Invalid/corrupt stored value → 100. Live percent announced via `role="status"`.

### 1.2 CHANGE (the user-scoping)
- **Storage key** becomes `smart_text_scale:<userId>` (MRF: prefix with your own key).
- **Bind/unbind lifecycle**: the widget takes a `userId` prop; while mounted it calls `bindUser(userId)`; on unmount (logout, layout teardown) it calls `bindUser(null)`.
  - Bind runs in `useLayoutEffect` → the user's stored scale applies on the first frame after login (no 100% flash).
  - Unbind resets the page to 100% → login/SSO pages always render at 100%.
- **Signed out = 100%.** Never apply a previous user's stored value pre-login.
- **Write path**: changes save to the bound user's scoped key only. Signed out, changes are in-memory only.
- **Cross-tab sync**: the `storage` listener only reacts to the **currently bound user's key** — tab sync works within one user, never across users.
- **Legacy migration (one-time)**: on first bind, if no scoped key exists but the old global `smart_text_scale` does, adopt its value for that user, then **delete the legacy key** so it can never leak to the next account.

### 1.3 DO NOT
- Do NOT fall back to a shared/global key for reads or writes.
- Do NOT key by role/portal (`_teacher`, `_admin`) — roles are not users; two teachers sharing a computer are different people.
- Do NOT persist the preference in `sessionStorage` — it should survive logout/login on the same machine for the same account.
- Do NOT store it server-side in v1 — this is a per-device display preference.

---

## 2. Updated `TextScaleContext.tsx` (full replacement)

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
 * Print is pinned to 100% in CSS, so official documents never change size.
 *
 * The preference is USER-scoped: stored under `smart_text_scale:<userId>` and
 * bound by the AccessibilityMenu to the signed-in user. Signing out resets the
 * page to 100%; another user on the same browser never inherits the setting.
 */

const TEXT_SCALE_STEPS = [90, 100, 110, 120, 130, 140, 150] as const;
const STORAGE_PREFIX = "smart_text_scale"; // MRF: use your own prefix, e.g. "mrf_text_scale"
const LEGACY_STORAGE_KEY = "smart_text_scale";
const DEFAULT_PERCENT = 100;

interface TextScaleContextType {
  percent: number;
  canDecrease: boolean;
  canIncrease: boolean;
  decrease: () => void;
  increase: () => void;
  reset: () => void;
  /** Bind the preference to a signed-in user (null when signed out). */
  bindUser: (userId: string | null) => void;
}

function keyForUser(userId: string): string {
  return `${STORAGE_PREFIX}:${userId}`;
}

function normalizePercent(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return (TEXT_SCALE_STEPS as readonly number[]).includes(parsed) ? parsed : DEFAULT_PERCENT;
}

function readStoredPercentForUser(userId: string): number {
  try {
    const scoped = localStorage.getItem(keyForUser(userId));
    if (scoped !== null) return normalizePercent(scoped);

    // One-time migration: adopt the legacy browser-wide value for the first
    // user who signs in, then remove it so it cannot leak to anyone else.
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy !== null) {
      const migrated = normalizePercent(legacy);
      localStorage.setItem(keyForUser(userId), String(migrated));
      localStorage.removeItem(LEGACY_STORAGE_KEY);
      return migrated;
    }
  } catch {
    /* storage unavailable — fall through to default */
  }
  return DEFAULT_PERCENT;
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
  bindUser: () => {},
});

export function useTextScale() {
  return useContext(TextScaleContext);
}

export function TextScaleProvider({ children }: { children: ReactNode }) {
  const [percent, setPercent] = useState<number>(DEFAULT_PERCENT);
  const [userId, setUserId] = useState<string | null>(null);

  // Bind/unbind the active user; signed-out pages always render at 100%.
  const bindUser = useCallback((nextUserId: string | null) => {
    setUserId(nextUserId);
    setPercent(nextUserId ? readStoredPercentForUser(nextUserId) : DEFAULT_PERCENT);
  }, []);

  // Apply before first paint so a stored scale never flashes at 100%
  useLayoutEffect(() => {
    applyTextScale(percent);
  }, [percent]);

  const updatePercent = useCallback(
    (next: number) => {
      const normalized = normalizePercent(next);
      setPercent(normalized);
      if (!userId) return;
      try {
        localStorage.setItem(keyForUser(userId), String(normalized));
      } catch {
        /* storage unavailable — scale still applies for this session */
      }
    },
    [userId],
  );

  // Sync across tabs/windows — only for the currently bound user's key.
  useEffect(() => {
    if (!userId) return;
    const key = keyForUser(userId);
    const onStorage = (event: StorageEvent) => {
      if (event.key !== key) return;
      setPercent(normalizePercent(event.newValue));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [userId]);

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
    <TextScaleContext.Provider
      value={{ percent, canDecrease, canIncrease, decrease, increase, reset, bindUser }}
    >
      {children}
    </TextScaleContext.Provider>
  );
}
```

---

## 3. Updated `AccessibilityMenu.tsx` (only the top changes; JSX identical to the original spec)

```tsx
import { useLayoutEffect } from "react";
import { Accessibility, Minus, Plus, RotateCcw } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTextScale } from "@/contexts/TextScaleContext";

interface AccessibilityMenuProps {
  /** Signed-in user id — the text-size preference is stored per user. */
  userId: string | null;
}

export default function AccessibilityMenu({ userId }: AccessibilityMenuProps) {
  const { percent, canDecrease, canIncrease, decrease, increase, reset, bindUser } = useTextScale();

  // Bind before paint so the user's stored scale applies on the first frame.
  // Unbinding (logout / unmount) resets the page to 100%.
  useLayoutEffect(() => {
    bindUser(userId);
    return () => bindUser(null);
  }, [userId, bindUser]);

  // ... rest of the JSX exactly as in AI_HANDOFF_ACCESSIBILITY_TEXT_SIZE.md §6
  // (trigger with aria-label + dot indicator, role="status" percent,
  //  closeOnClick={false} stepper items, conditional Reset row).
}
```

### 3.1 Wiring change
Every header mount now passes the signed-in user's id:

```tsx
<AccessibilityMenu userId={user.id} />
```

If MRF's menu is not mounted per-layout, pass the id wherever the authenticated shell is rendered; the bind/unbind semantics must stay identical (bind on auth, unbind on logout).

---

## 4. Edge-cases handled (and why)

| Case | Behavior | Rationale |
|---|---|---|
| Fresh user, same browser | 100% | No scoped key → default; never inherits another user's value. |
| User A 130 → logout → User B login | B sees 100% | Unbind resets; B has no scoped key. |
| Login/SSO pages | Always 100% | Nothing is bound before auth. |
| Two tabs, same user | Both update (storage event on that user's key) | Cross-tab sync kept, scoped per user. |
| Two tabs, different users (A + B) | Independent | Listener ignores other users' keys. |
| Legacy global key present | Adopted by first user to bind, then deleted | Preserves existing setting once, then removes leak vector. |
| Corrupt value | 100% | `normalizePercent` guard, same as v1. |
| Failed registry right after login | Scale still applies in-memory | Write/read wrapped in try/catch. |

---

## 5. Verification procedure (exactly how SMART proved the fix)

Run on a production-style build. Console/devtools or Playwright:

1. **Fresh state** — clear `localStorage`. Open a page with the widget bound to `user-A`:
   - root font-size `16px`, bar shows `100%`.
2. **Write scope** — click `+` once:
   - root `17.6px`; `localStorage["<prefix>:user-A"] === "110"`; **no** global key exists.
3. **Isolation** — navigate to a page bound to `user-B`:
   - root `16px`, bar `100%`; `user-A` key untouched.
4. **Restore** — back to `user-A`: root `17.6px`, bar `110%`, trigger label `"...text size 110%"`.
5. **Sign-out reset** — navigate to a page with no widget (login): root `16px`.
6. **Legacy migration** — set `localStorage["<prefix>"] = "120"`, delete the scoped key, revisit `user-A`:
   - root `19.2px`; scoped key `"120"`; legacy key **deleted**.
7. **Corrupt value** — scoped key `"abc"` → behaves as 100%, no console errors.
8. CI: typecheck + build + lint with 0 errors.

---

## 6. Done checklist

- [ ] Storage key is `"<prefix>:<userId>"`; no reads or writes ever touch a global/shared key (after migration).
- [ ] Widget takes `userId`; bind on mount, unbind on unmount; bind runs before paint.
- [ ] Signed-out pages render at 100% and changing text size while signed out does not persist.
- [ ] Legacy global key adopted once, then deleted.
- [ ] Cross-tab `storage` listener only reacts to the bound user's key.
- [ ] Steps, scaling formula, print pin, aria-live, clamping all unchanged from the original spec.
- [ ] §5 verification steps pass end-to-end for two different users on the same browser.
