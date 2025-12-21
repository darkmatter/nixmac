import { cn } from "@/lib/utils";
import type * as React from "react";

export interface IconTitleSubProps extends React.ComponentProps<"div"> {
  icon?: React.ReactNode;
  title: string;
  subtitle: string;
  compact?: boolean;
  showIconInCompact?: boolean;
}

export function IconTitleSub({
  icon,
  title,
  subtitle,
  compact = false,
  showIconInCompact = false,
  className,
  ...props
}: IconTitleSubProps) {
  const showIcon = icon && (!compact || showIconInCompact);

  return (
    <div
      className={cn("text-center", compact ? "mb-4" : "mb-8", className)}
      {...props}
    >
      {showIcon && (
        <div className="mb-4 flex items-center justify-center gap-2">
          <div className="flex size-12 items-center justify-center rounded-lg bg-primary">
            {icon}
          </div>
        </div>
      )}
      <h1
        className={
          compact
            ? "mb-1 font-semibold text-lg tracking-tight"
            : "mb-2 font-semibold text-3xl tracking-tight"
        }
      >
        {title}
      </h1>
      <p
        className={
          compact ? "text-muted-foreground text-sm" : "text-muted-foreground"
        }
      >
        {subtitle}
      </p>
    </div>
  );
}
