import { useEffect, useState, type RefObject } from "react";

export function useElementHeight(
  ref: RefObject<HTMLElement | null>,
  enabled: boolean = true
): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setHeight(0);
      return;
    }

    const node = ref.current;
    if (!node) {
      setHeight(0);
      return;
    }

    const update = () => setHeight(node.offsetHeight || 0);
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
