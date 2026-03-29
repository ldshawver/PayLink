import * as React from "react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";

export interface ColumnDef<T> {
  key: string;
  header: string;
  render: (row: T, index: number) => React.ReactNode;
  hideOnMobile?: boolean;
  mobileLabel?: string;
}

interface ResponsiveTableOrCardsProps<T> {
  columns: ColumnDef<T>[];
  data: T[];
  keyExtractor: (row: T, index: number) => string | number;
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
  className?: string;
  cardClassName?: string;
}

export function ResponsiveTableOrCards<T>({
  columns,
  data,
  keyExtractor,
  onRowClick,
  emptyMessage = "No data available",
  className,
  cardClassName,
}: ResponsiveTableOrCardsProps<T>) {
  const isMobile = useIsMobile();

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground text-sm" data-testid="text-empty-table">
        {emptyMessage}
      </div>
    );
  }

  if (isMobile) {
    return (
      <div className={cn("space-y-3", className)} data-testid="responsive-cards-container">
        {data.map((row, index) => (
          <Card
            key={keyExtractor(row, index)}
            className={cn(
              "overflow-hidden",
              onRowClick && "cursor-pointer active:bg-muted/50",
              cardClassName
            )}
            onClick={() => onRowClick?.(row)}
            data-testid={`card-row-${keyExtractor(row, index)}`}
          >
            <CardContent className="p-4 space-y-2">
              {columns
                .filter((col) => !col.hideOnMobile)
                .map((col) => (
                  <div key={col.key} className="flex items-start justify-between gap-2 text-sm">
                    <span className="text-muted-foreground shrink-0 font-medium">
                      {col.mobileLabel || col.header}
                    </span>
                    <span className="text-right min-w-0">{col.render(row, index)}</span>
                  </div>
                ))}
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className={cn("w-full", className)} data-testid="responsive-table-container">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((col) => (
              <TableHead key={col.key}>{col.header}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((row, index) => (
            <TableRow
              key={keyExtractor(row, index)}
              className={cn(onRowClick && "cursor-pointer")}
              onClick={() => onRowClick?.(row)}
              data-testid={`row-${keyExtractor(row, index)}`}
            >
              {columns.map((col) => (
                <TableCell key={col.key}>{col.render(row, index)}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
