import type * as React from "react";
/** Loading spinner. Inherits `currentColor`. */
export interface SpinnerProps extends React.ComponentProps<"svg"> {
  /** Diameter in px. @default 16 */
  size?: number;
}
export function Spinner(props: SpinnerProps): React.JSX.Element;
