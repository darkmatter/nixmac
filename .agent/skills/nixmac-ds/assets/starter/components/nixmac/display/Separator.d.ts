import type * as React from "react";
/** Hairline divider on `--border`. */
export interface SeparatorProps extends React.ComponentProps<"div"> {
  orientation?: "horizontal" | "vertical";
}
export function Separator(props: SeparatorProps): React.JSX.Element;
