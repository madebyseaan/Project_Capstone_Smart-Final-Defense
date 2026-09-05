import { useState, useEffect, useCallback } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { TableFilter } from "./types";

interface TableToolbarProps {
  searchPlaceholder?: string;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  filters?: TableFilter[];
  actions?: React.ReactNode;
}

function useDebouncedValue(value: string, delay = 300) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}

export function TableToolbar({
  searchPlaceholder = "Search...",
  searchValue: controlledSearch,
  onSearchChange,
  filters,
  actions,
}: TableToolbarProps) {
  const [internalSearch, setInternalSearch] = useState("");
  const isControlled = controlledSearch !== undefined && onSearchChange !== undefined;
  const searchValue = isControlled ? controlledSearch : internalSearch;

  const debouncedSearch = useDebouncedValue(searchValue);

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (isControlled) {
        onSearchChange(e.target.value);
      } else {
        setInternalSearch(e.target.value);
      }
    },
    [isControlled, onSearchChange]
  );

  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder={searchPlaceholder}
            value={searchValue}
            onChange={handleSearchChange}
            className="pl-9 w-full sm:w-64"
          />
        </div>
        {filters?.map((filter) => (
          <Select
            key={filter.label}
            value={filter.value}
            onValueChange={(val) => val && filter.onChange(val)}
          >
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {filter.options.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ))}
      </div>
      {actions && <div className="flex items-center gap-3">{actions}</div>}
    </div>
  );
}
