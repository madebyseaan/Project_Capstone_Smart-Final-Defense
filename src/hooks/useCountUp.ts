import { useEffect, useRef, useState } from "react";

export function useCountUp(
  target: number,
  duration = 800,
  enabled = true
): number {
  const [value, setValue] = useState(enabled ? 0 : target);
  const rafRef = useRef<number>(0);
  const startRef = useRef<number>(0);
  const prefersReduced =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    if (!enabled) {
      setValue(target);
      return;
    }

    if (prefersReduced || target === 0) {
      setValue(target);
      return;
    }

    setValue(0);
    startRef.current = performance.now();

    function tick(now: number) {
      const elapsed = now - startRef.current;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(eased * target));

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration, enabled, prefersReduced]);

  return value;
}
