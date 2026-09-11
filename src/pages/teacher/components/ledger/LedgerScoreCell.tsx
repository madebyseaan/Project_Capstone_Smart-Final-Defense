import React from "react";

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
  return (
    <input
      key={`${String(value ?? "")}-${status ?? ""}`}
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
          const val = e.currentTarget.value === "" ? 0 : Number(e.currentTarget.value);
          onHps(val);
        } else {
          onCommit(e.currentTarget);
        }
      }}
      onKeyDown={(e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        if (isHps) {
          const val = e.currentTarget.value === "" ? 0 : Number(e.currentTarget.value);
          onHps(val);
        } else {
          onCommit(e.currentTarget);
        }
        // Defer focus to after React's batched state updates and re-render,
        // so the next row's input exists in the DOM when we query for it.
        requestAnimationFrame(() => {
          const nextInput = document.querySelector<HTMLInputElement>(
            `[data-row-index="${rowIndex + 1}"][data-cat="${cat}"][data-col="${index}"]`
          );
          nextInput?.focus();
        });
      }}
      data-row-index={isHps ? -1 : rowIndex}
      data-cat={cat}
      data-col={index}
    />
  );
});
