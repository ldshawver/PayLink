import * as React from "react";
import { cn } from "@/lib/utils";

interface ResponsiveFormGridProps {
  columns?: 1 | 2 | 3 | 4;
  className?: string;
  children: React.ReactNode;
}

export function ResponsiveFormGrid({
  columns = 2,
  className,
  children,
}: ResponsiveFormGridProps) {
  const gridCols: Record<number, string> = {
    1: "grid-cols-1",
    2: "grid-cols-1 sm:grid-cols-2",
    3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
    4: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
  };

  return (
    <div
      className={cn("grid gap-4", gridCols[columns], className)}
      data-testid="responsive-form-grid"
    >
      {children}
    </div>
  );
}

interface FormFieldWrapperProps {
  label?: string;
  required?: boolean;
  span?: 1 | 2 | 3 | 4 | "full";
  className?: string;
  children: React.ReactNode;
}

export function FormFieldWrapper({
  label,
  required,
  span,
  className,
  children,
}: FormFieldWrapperProps) {
  const spanClass = span === "full"
    ? "col-span-full"
    : span === 2
    ? "sm:col-span-2"
    : span === 3
    ? "lg:col-span-3"
    : span === 4
    ? "lg:col-span-4"
    : "";

  return (
    <div className={cn("space-y-1.5", spanClass, className)}>
      {label && (
        <label className="block text-sm font-medium text-foreground">
          {label}
          {required && <span className="text-destructive ml-0.5">*</span>}
        </label>
      )}
      {children}
    </div>
  );
}
