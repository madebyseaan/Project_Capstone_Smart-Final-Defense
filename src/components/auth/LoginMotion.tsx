import type { ReactNode } from "react";
import { LazyMotion, domAnimation, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

export function LoginMotionShell({ children }: { children: ReactNode }) {
  return <LazyMotion features={domAnimation}>{children}</LazyMotion>;
}

export function useLoginEntrance() {
  const reduce = useReducedMotion() ?? false;

  const fadeUp = (delay = 0, distance = 10, scale = 1) => {
    if (reduce) {
      return { initial: false as const };
    }
    return {
      initial: { opacity: 0, y: distance, scale },
      animate: { opacity: 1, y: 0, scale: 1 },
      transition: { duration: 0.5, delay, ease: EASE },
    };
  };

  return { reduce, fadeUp };
}

export function LoginAurora({ variant }: { variant: "brand" | "card" }) {
  const tone = variant === "brand" ? "login-aurora-brand" : "login-aurora-card";
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <div className={cn("login-aurora login-aurora-a", tone)} />
      <div className={cn("login-aurora login-aurora-b", tone)} />
    </div>
  );
}
