import { useEffect, useState } from "react";
import { advisoryApi } from "@/lib/api";

const STORAGE_PREFIX = "teacher_has_advisory";

// Keyed per teacher so switching accounts in the same tab never shows a
// stale answer (sessionStorage survives re-login without an explicit logout).
function getCacheKey(): string | null {
  try {
    const raw = sessionStorage.getItem("user_teacher");
    if (!raw) return null;
    const id = JSON.parse(raw)?.id;
    return typeof id === "string" && id ? `${STORAGE_PREFIX}:${id}` : null;
  } catch {
    return null;
  }
}

/**
 * Whether the logged-in teacher has an advisory class (assigned via EnrollPro
 * sync). `null` while unknown. Cached per session so the sidebar doesn't
 * flash. Fails open (stays visible) when the check errors — hiding features
 * on a temporary backend hiccup would be worse than showing a page that
 * itself can't load data.
 */
export function useHasAdvisory(): boolean | null {
  const [hasAdvisory, setHasAdvisory] = useState<boolean | null>(() => {
    const key = getCacheKey();
    if (!key) return null;
    const cached = sessionStorage.getItem(key);
    return cached === null ? null : cached === "true";
  });

  useEffect(() => {
    let cancelled = false;
    advisoryApi
      .getMyAdvisory()
      .then((res) => {
        if (cancelled) return;
        const value = res.data?.hasAdvisory !== false;
        const key = getCacheKey();
        if (key) sessionStorage.setItem(key, String(value));
        setHasAdvisory(value);
      })
      .catch(() => {
        // Keep cached/unknown state (fail open)
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return hasAdvisory;
}
