import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

const listClass =
  "w-full justify-start gap-2 p-0 bg-transparent group-data-horizontal/tabs:h-auto overflow-x-auto";
const triggerClass =
  "flex-1 gap-2 px-4 py-2.5 text-sm font-semibold whitespace-nowrap border border-border bg-card text-foreground shadow-xs transition-colors hover:bg-muted/60 data-active:border-primary data-active:bg-primary data-active:text-primary-foreground data-active:shadow-sm data-active:hover:border-primary data-active:hover:bg-primary data-active:hover:text-primary-foreground dark:border-border dark:bg-card dark:text-foreground dark:data-active:border-primary dark:data-active:bg-primary dark:data-active:text-primary-foreground dark:data-active:hover:border-primary dark:data-active:hover:bg-primary dark:data-active:hover:text-primary-foreground";

export interface FilterTabItem {
  value: string;
  label: string;
  icon?: LucideIcon;
}

interface FilterTabsProps {
  value: string;
  onValueChange: (value: string) => void;
  items: FilterTabItem[];
  children?: ReactNode;
  header?: ReactNode;
  className?: string;
  listClassName?: string;
}

export function FilterTabs({
  value,
  onValueChange,
  items,
  children,
  header,
  className,
  listClassName,
}: FilterTabsProps) {
  return (
    <Tabs value={value} onValueChange={onValueChange} className={className}>
      <div className={cn("flex w-full flex-col gap-3 lg:flex-row lg:items-center", header && "lg:justify-between")}>
        <TabsList className={cn(listClass, listClassName)}>
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <TabsTrigger key={item.value} value={item.value} className={triggerClass}>
                {Icon && <Icon className="w-4 h-4" />}
                {item.label}
              </TabsTrigger>
            );
          })}
        </TabsList>
        {header}
      </div>
      {children}
    </Tabs>
  );
}
