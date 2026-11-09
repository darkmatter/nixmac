import type * as React from "react";
/** Multi-line text field. The prompt composer's core input. */
export interface TextareaProps extends React.ComponentProps<"textarea"> {
  /** Render in Geist Mono (for config / diff text). @default false */
  mono?: boolean;
}
export function Textarea(props: TextareaProps): React.JSX.Element;
