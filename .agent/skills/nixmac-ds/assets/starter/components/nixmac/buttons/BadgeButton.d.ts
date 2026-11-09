import type * as React from "react";

/**
 * A pill chip-button — a rounded-full bordered ghost button for prompt
 * suggestions, filter chips, and inline quick-actions.
 */
export interface BadgeButtonProps extends React.ComponentProps<"button"> {
  /** Border/emphasis treatment. @default "default" */
  badgeVariant?: "default" | "muted" | "teal";
  /** Optional leading icon node (rendered at 12px). */
  icon?: React.ReactNode;
  disabled?: boolean;
}

export function BadgeButton(props: BadgeButtonProps): React.JSX.Element;
