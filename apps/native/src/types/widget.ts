/**
 * Widget step state - updated by useEffect based on app state.
 */
export type WidgetStep =
  | "permissions"
  | "nix-setup"
  | "setup"
  | "begin"
  | "evolve"
  | "commit"
  | "manualEvolve"
  | "manualCommit"
  | "history"
  | "filesystem";
