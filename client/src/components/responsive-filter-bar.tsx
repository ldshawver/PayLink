import * as React from "react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { Filter, ChevronDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerFooter,
  DrawerClose,
} from "@/components/ui/drawer";

interface ResponsiveFilterBarProps {
  children: React.ReactNode;
  activeFilterCount?: number;
  onClear?: () => void;
  className?: string;
  title?: string;
}

export function ResponsiveFilterBar({
  children,
  activeFilterCount = 0,
  onClear,
  className,
  title = "Filters",
}: ResponsiveFilterBarProps) {
  const isMobile = useIsMobile();
  const [open, setOpen] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);

  if (isMobile) {
    return (
      <>
        <div className={cn("flex items-center gap-2", className)} data-testid="responsive-filter-bar-mobile">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOpen(true)}
            className="gap-2"
            data-testid="button-open-filters"
          >
            <Filter className="h-4 w-4" />
            <span>{title}</span>
            {activeFilterCount > 0 && (
              <span className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                {activeFilterCount}
              </span>
            )}
          </Button>
          {activeFilterCount > 0 && onClear && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onClear}
              className="gap-1 text-muted-foreground"
              data-testid="button-clear-filters"
            >
              <X className="h-3.5 w-3.5" />
              Clear
            </Button>
          )}
        </div>
        <Drawer open={open} onOpenChange={setOpen}>
          <DrawerContent className="max-h-[85vh]" data-testid="filter-drawer">
            <DrawerHeader>
              <DrawerTitle className="flex items-center gap-2">
                <Filter className="h-4 w-4" />
                {title}
              </DrawerTitle>
            </DrawerHeader>
            <div className="px-4 pb-2 space-y-4 overflow-y-auto flex-1">
              {children}
            </div>
            <DrawerFooter className="flex-row gap-2">
              {onClear && (
                <Button
                  variant="outline"
                  onClick={() => {
                    onClear();
                    setOpen(false);
                  }}
                  className="flex-1"
                  data-testid="button-clear-filters-drawer"
                >
                  Clear All
                </Button>
              )}
              <DrawerClose asChild>
                <Button className="flex-1" data-testid="button-apply-filters">
                  Apply
                </Button>
              </DrawerClose>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>
      </>
    );
  }

  return (
    <div className={cn("space-y-3", className)} data-testid="responsive-filter-bar-desktop">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors min-h-[44px] sm:min-h-0"
        data-testid="button-toggle-filters"
      >
        <Filter className="h-4 w-4" />
        {title}
        {activeFilterCount > 0 && (
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
            {activeFilterCount}
          </span>
        )}
        <ChevronDown
          className={cn(
            "h-4 w-4 transition-transform",
            expanded && "rotate-180"
          )}
        />
      </button>
      {expanded && (
        <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-muted/30 p-4">
          {children}
          {activeFilterCount > 0 && onClear && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onClear}
              className="gap-1 text-muted-foreground"
              data-testid="button-clear-filters-desktop"
            >
              <X className="h-3.5 w-3.5" />
              Clear All
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
