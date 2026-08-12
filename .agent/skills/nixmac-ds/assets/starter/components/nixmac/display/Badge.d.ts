import type * as React from "react";

/**
 * Small status/label pill for counts, states, and file kinds.
 */
export interface BadgeProps extends React.ComponentProps<"span"> {
  /** @default "default" */
  variant?: "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "brand";
}
export function Badge(props: BadgeProps): React.JSX.Element;
