import type * as React from "react";
/** Toggle switch for booleans (login items, opt-in flags, settings). */
export interface SwitchProps {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  style?: React.CSSProperties;
}
export function Switch(props: SwitchProps): React.JSX.Element;
