import * as React from "react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface TabItem {
  value: string;
  label: string;
  icon?: React.ReactNode;
}

interface ResponsiveTabsProps {
  tabs: TabItem[];
  activeTab: string;
  onTabChange: (value: string) => void;
  dropdownThreshold?: number;
  className?: string;
}

export function ResponsiveTabs({
  tabs,
  activeTab,
  onTabChange,
  dropdownThreshold = 6,
  className,
}: ResponsiveTabsProps) {
  const isMobile = useIsMobile();
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const activeLabel = tabs.find((t) => t.value === activeTab)?.label || activeTab;

  if (isMobile && tabs.length > dropdownThreshold) {
    return (
      <div className={cn("w-full", className)} data-testid="responsive-tabs-dropdown">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="flex w-full items-center justify-between rounded-lg border bg-muted px-4 py-2.5 text-sm font-medium min-h-[44px]"
              data-testid="responsive-tabs-dropdown-trigger"
            >
              <span className="truncate">{activeLabel}</span>
              <ChevronDown className="ml-2 h-4 w-4 shrink-0" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)] max-h-64 overflow-y-auto">
            {tabs.map((tab) => (
              <DropdownMenuItem
                key={tab.value}
                onClick={() => onTabChange(tab.value)}
                className={cn(
                  "gap-2",
                  tab.value === activeTab && "bg-accent font-medium"
                )}
                data-testid={`responsive-tab-dropdown-${tab.value}`}
              >
                {tab.icon}
                {tab.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className={cn(
        "w-full overflow-x-auto scrollbar-none -mx-1 px-1",
        className
      )}
      data-testid="responsive-tabs-scroll"
    >
      <div className="inline-flex h-9 items-center gap-1 rounded-lg bg-muted p-1 text-muted-foreground min-w-max">
        {tabs.map((tab) => (
          <button
            key={tab.value}
            onClick={() => onTabChange(tab.value)}
            className={cn(
              "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-[44px] sm:min-h-0",
              tab.value === activeTab
                ? "bg-background text-foreground shadow"
                : "hover:bg-background/50 hover:text-foreground"
            )}
            data-testid={`responsive-tab-${tab.value}`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}
