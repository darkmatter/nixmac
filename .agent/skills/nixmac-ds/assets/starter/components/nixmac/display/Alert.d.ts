import type * as React from "react";

/**
 * Contextual message on a card surface: notes and errors. Icon + title +
 * description in a two-column grid.
 */
export interface AlertProps extends React.ComponentProps<"div"> {
  /** @default "default" */
  variant?: "default" | "destructive";
  /** Leading icon node (16px). */
  icon?: React.ReactNode;
  /** Bold title line. */
  title?: React.ReactNode;
}
export function Alert(props: AlertProps): React.JSX.Element;
