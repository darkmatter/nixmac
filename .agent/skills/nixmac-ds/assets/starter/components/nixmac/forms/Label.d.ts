import type * as React from "react";
/** Form field label. 14px medium. */
export interface LabelProps extends React.ComponentProps<"label"> {
  disabled?: boolean;
}
export function Label(props: LabelProps): React.JSX.Element;
