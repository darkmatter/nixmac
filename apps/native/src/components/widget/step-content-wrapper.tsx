"use client";

import type { ReactNode } from "react";

interface StepContentWrapperProps {
  children: ReactNode;
}

export function StepContentWrapper({ children }: StepContentWrapperProps) {
  return (
    <div className="relative flex min-h-0 flex-1 gap-4 flex-col overflow-y-scroll px-4 pt-4 xs:px-8 xs:pt-8 sm:px-12 pb-0">
      {children}
    </div>
  );
}
