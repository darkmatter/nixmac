import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { MouseEventHandler, ReactNode } from "react";

export function AnalyzeButton({
  onClick,
  disabled,
  children,
  className,
}: {
  onClick?: MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={disabled}
      className={cn(
        "h-auto gap-[3px] px-[7px] py-0.5 text-[10px] text-neutral-500 hover:bg-transparent hover:text-neutral-300",
        className,
      )}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}
