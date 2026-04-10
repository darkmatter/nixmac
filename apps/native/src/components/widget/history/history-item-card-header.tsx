import type { ReactNode } from "react";

interface CardContentWrapperProps {
  header: ReactNode;
  actions: ReactNode;
  children?: ReactNode;
}

export function CardContentWrapper({ header, actions, children }: CardContentWrapperProps) {
  return (
    <div>
      <div className="flex items-start justify-between gap-[10px]">
        <div className="min-w-0 flex-1">{header}</div>
        <div className="flex shrink-0 flex-col items-end gap-1">{actions}</div>
      </div>
      {children}
    </div>
  );
}
