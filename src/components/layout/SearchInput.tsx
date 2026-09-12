import type { Ref } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  inputRef?: Ref<HTMLInputElement>;
}

/**
 * Canonical search box — relative wrapper with an inset Search icon and the
 * registrar input recipe. Pair with `TableToolbar` or page-level filters.
 */
export function SearchInput({
  value,
  onChange,
  placeholder = "Search...",
  className,
  inputClassName,
  inputRef,
}: SearchInputProps) {
  return (
    <div className={cn("relative", className)}>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
      <Input
        ref={inputRef}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn("pl-8 h-9 w-56 rounded-lg text-xs", inputClassName)}
      />
    </div>
  );
}
