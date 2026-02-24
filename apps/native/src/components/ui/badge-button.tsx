"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import type * as React from "react";

interface BadgeButtonProps extends React.ComponentProps<typeof Button> {
  icon?: LucideIcon;
  badgeVariant?: "default" | "muted" | "teal";
}

function BadgeButton({
  children,
  className,
  icon: Icon,
  badgeVariant = "default",
  ...props
}: BadgeButtonProps) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn(
        "h-auto rounded-full border px-2 py-1 text-xs font-medium hover:text-foreground",
        badgeVariant === "default" &&
          "border-border text-muted-foreground hover:bg-muted ",
        badgeVariant === "muted" &&
          "border-border/50 bg-background text-muted-foreground hover:bg-muted/50 ",
        badgeVariant === "teal" &&
          "border-teal-500/20 text-muted-foreground ",
        className,
      )}
      {...props}
    >
      {Icon && <Icon className="h-3 w-3" />}
      {children}
    </Button>
  );
}

export { BadgeButton };
