"use client";

import type { ReactNode } from "react";

interface StepWrapperProps {
  children: ReactNode;
}

export function StepWrapper({ children }: StepWrapperProps) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-10">{children}</div>
  );
}
