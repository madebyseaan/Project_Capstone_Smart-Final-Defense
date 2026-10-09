import React, { useEffect, useRef } from "react";

// ─── LedgerScoreCell ─────────────────────────────────────────────────────────

interface LedgerScoreCellProps {
  cat: "WW" | "PT" | "QA" | "EX";
  index: number;
  value: string | number;
  status?: string;
  isHps: boolean;
  invalid?: string;
  disabled?: boolean;
  hpsColorClass: string;
  onCommit: (inputEl: HTMLInputElement) => void;
  onHps: (val: number) => void;
  onFocus: () => void;
  rowIndex: number;
  ariaLabel: string;
  aims?: boolean;
}

export const LedgerScoreCell = React.memo(function LedgerScoreCell({
  cat,
  index,
  value,
  status,
  isHps,
  invalid,
  disabled,
  hpsColorClass,
  onCommit,
  onHps,
  onFocus,
  rowIndex,
  ariaLabel,
  aims,
}: LedgerScoreCellProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    if (typeof document !== "undefined" && document.activeElement === el) return;
    const next = value === undefined || value === null ? "" : String(value);
    if (el.value !== next) el.value = next;
    el.dataset.prev = next;
  }, [value, status]);

  const commitIfChanged = (el: HTMLInputElement) => {
    if (el.value === (el.dataset.prev ?? "")) return;
    onCommit(el);
  };

  const moveFocusDown = () => {
    requestAnimationFrame(() => {
      const nextInput = document.querySelector<HTMLInputElement>(
        `[data-row-index="${rowIndex + 1}"][data-cat="${cat}"][data-col="${index}"]`
      );
      nextInput?.focus();
    });
  };

  return (
    <input
      ref={inputRef}
      type={isHps ? "number" : "text"}
      inputMode="decimal"
      defaultValue={value}
      disabled={disabled}
      placeholder="0"
      aria-label={ariaLabel}
      aria-invalid={!!invalid}
      title={invalid}
      className={`w-full text-center text-[11px] font-bold border-0 outline-none bg-transparent tabular-nums ${isHps ? hpsColorClass : (
        status === "A" ? "text-rose-600 bg-rose-500/10 font-bold rounded-lg" :
        status === "E" ? "text-indigo-600 bg-indigo-500/10 font-bold rounded-lg" :
        aims ? "text-[var(--ledger-aims)] font-bold bg-[var(--ledger-aims-bg)]" :
        "text-slate-600"
      )} ${
        invalid ? "ring-1 ring-inset ring-rose-500 bg-rose-50/40 text-rose-700" : ""
      } ${disabled ? "bg-gray-100 cursor-not-allowed opacity-60" : ""}`}
      onFocus={(e) => {
        onFocus();
        e.currentTarget.select();
        e.currentTarget.dataset.prev = e.currentTarget.value;
      }}
      onBlur={(e) => {
        if (isHps) {
          if (e.currentTarget.value === (e.currentTarget.dataset.prev ?? "")) return;
          const val = e.currentTarget.value === "" ? 0 : Number(e.currentTarget.value);
          onHps(val);
        } else {
          commitIfChanged(e.currentTarget);
        }
      }}
      onKeyDown={(e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        if (isHps) {
          if (e.currentTarget.value !== (e.currentTarget.dataset.prev ?? "")) {
            const val = e.currentTarget.value === "" ? 0 : Number(e.currentTarget.value);
            onHps(val);
            e.currentTarget.dataset.prev = e.currentTarget.value;
          }
        } else {
          commitIfChanged(e.currentTarget);
        }
        // Focus the next learner in the same column. Inputs are no longer remounted
        // on value changes, so the next input already exists in the DOM.
        moveFocusDown();
      }}
      data-row-index={isHps ? -1 : rowIndex}
      data-cat={cat}
      data-col={index}
    />
  );
});
