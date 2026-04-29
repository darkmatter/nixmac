import type { LucideIcon } from "lucide-react";

export function FileBadge({
  icon: Icon,
  children,
}: {
  icon?: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <code className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
      {Icon && <Icon className="h-3 w-3" />}
      {children}
    </code>
  );
}
