import type * as React from "react";

/**
 * nixmac primary action button — solid, quiet, and inline treatments matching
 * the desktop app's shadcn button. Composes into toolbars, dialogs, and the
 * prompt bar.
 *
 * @startingPoint section="Buttons" subtitle="Action button with all variants & sizes" viewport="700x150"
 */
export interface ButtonProps extends React.ComponentProps<"button"> {
  /** Visual treatment. @default "default" */
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
  /** Size / shape. @default "default" */
  size?: "default" | "sm" | "lg" | "icon" | "icon-sm" | "icon-lg";
  disabled?: boolean;
}

export function Button(props: ButtonProps): React.JSX.Element;
