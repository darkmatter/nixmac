"use client";

import type { ReactNode } from "react";

interface StepActionsHeaderProps {
  label: string;
  children: ReactNode;
}

export function StepActionsHeader({ label, children }: StepActionsHeaderProps) {
  return (
    <div className="flex items-center justify-between py-3">
      <p className="text-muted-foreground text-sm">{label}</p>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}
