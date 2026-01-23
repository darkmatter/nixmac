import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";

type IconBadgeProps = {
  icon: LucideIcon;
  children: React.ReactNode;
  trailingIcon?: boolean;
}

export function IconBadge({ icon: Icon, children, trailingIcon }: IconBadgeProps) {
  return (
    <Badge
      className="mb-4 border border-zinc-700 bg-zinc-800/50 text-zinc-300"
      variant="secondary"
    >
      {!trailingIcon && <Icon className="mr-1 size-3" />}
      {children}
      {trailingIcon && <Icon className="ml-1 size-3" />}
    </Badge>
  );
}