import * as React from "react";
import { cn } from "@/lib/utils";

interface ResponsivePageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}

export function ResponsivePageHeader({
  title,
  subtitle,
  actions,
  className,
  children,
}: ResponsivePageHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between",
        className
      )}
      data-testid="responsive-page-header"
    >
      <div className="min-w-0">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight truncate" data-testid="text-page-title">
          {title}
        </h1>
        {subtitle && (
          <p className="text-sm text-muted-foreground mt-0.5" data-testid="text-page-subtitle">
            {subtitle}
          </p>
        )}
      </div>
      {(actions || children) && (
        <div className="flex flex-wrap items-center gap-2 shrink-0" data-testid="page-header-actions">
          {actions}
          {children}
        </div>
      )}
    </div>
  );
}
