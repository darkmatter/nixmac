import type * as React from "react";
import { cn } from "@/lib/utils";

export interface IconTitleDescriptionCardProps extends React.ComponentProps<"div"> {
  icon: React.ReactNode;
  title: string;
  description: string;
  variant?: "default" | "info" | "warning" | "success";
}

const variantStyles = {
  default: "border-border bg-secondary/30",
  info: "border-primary/20 bg-primary/5",
  warning: "border-amber-500/20 bg-amber-500/5",
  success: "border-console-success/20 bg-console-success/5",
} as const;

const iconStyles = {
  default: "text-primary",
  info: "text-primary",
  warning: "text-amber-600",
  success: "text-console-success",
} as const;

export function IconTitleDescriptionCard({
  icon,
  title,
  description,
  variant = "default",
  className,
  ...props
}: IconTitleDescriptionCardProps) {
  return (
    <div
      className={cn(
        "rounded-lg border p-4",
        variantStyles[variant],
        className
      )}
      {...props}
    >
      <div className="flex gap-3">
        <div className={cn("mt-0.5 size-5 flex-shrink-0", iconStyles[variant])}>
          {icon}
        </div>
        <div className="flex-1">
          <h4 className="mb-1 font-medium text-sm">{title}</h4>
          <p className="text-muted-foreground text-xs leading-relaxed">
            {description}
          </p>
        </div>
      </div>
    </div>
  );
}