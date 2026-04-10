import type { ReactNode } from "react";

export function BadgeList({ children }: { children: ReactNode }) {
  return (
    <div className="mt-[6px] flex flex-wrap gap-1">
      {children}
    </div>
  );
}
