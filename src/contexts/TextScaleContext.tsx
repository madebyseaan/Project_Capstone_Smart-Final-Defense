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
 * Only rem-based text grows; fixed px text (ledger, form grids) is untouched.
 * Print is pinned to 100% in CSS, so official forms never change size.
 *
 * The preference is USER-scoped: stored under `smart_text_scale:<userId>` and
 * bound by the AccessibilityMenu to the signed-in user. Signing out resets the
 * page to 100%; another user on the same browser never inherits the setting.
 */

const TEXT_SCALE_STEPS = [90, 100, 110, 120, 130, 140, 150] as const;
const STORAGE_PREFIX = "smart_text_scale";
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
