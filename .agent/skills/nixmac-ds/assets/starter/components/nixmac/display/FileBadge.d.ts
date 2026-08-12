import type * as React from "react";
/** Monospace chip for file paths, store paths, commands, and hashes. */
export interface FileBadgeProps extends React.ComponentProps<"code"> {
  /** Optional leading icon node (12px). */
  icon?: React.ReactNode;
}
export function FileBadge(props: FileBadgeProps): React.JSX.Element;
