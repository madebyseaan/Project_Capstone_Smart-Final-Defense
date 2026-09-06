import { useEffect, useRef, useState, type RefObject } from "react";

export function useElementHeight(
  ref: RefObject<HTMLElement | null>,
  enabled: boolean = true
): number {
  const [height, setHeight] = useState(0);
  const prevHeightRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      prevHeightRef.current = 0;
      setHeight(0);
      return;
    }

    const node = ref.current;
    if (!node) {
      prevHeightRef.current = 0;
      setHeight(0);
      return;
    }

    const update = () => {
      const next = node.offsetHeight || 0;
      if (next !== prevHeightRef.current) {
        prevHeightRef.current = next;
        setHeight(next);
      }
    };
    update();

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(update);
      observer.observe(node);
    }
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [ref, enabled]);

  return height;
}
