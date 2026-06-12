// Rebuild state for showing progress inline in the widget

export type RebuildErrorType =
  | "infinite_recursion"
  | "evaluation_error"
  | "build_error"
  | "full_disk_access"
  | "user_cancelled"
  | "authorization_denied"
  | "generic_error";

export interface RebuildLine {
  id: number;
  text: string;
  type: "stdout" | "stderr" | "info";
}

export type RebuildContext = "rollback" | "apply";

export interface RebuildState {
  isRunning: boolean;
  context: RebuildContext;
  lines: RebuildLine[];
  rawLines: string[];
  exitCode?: number;
  success?: boolean;
  errorType?: RebuildErrorType;
  errorMessage?: string;
  systemUntouched?: boolean;
}

export const initialRebuildState: RebuildState = {
  isRunning: false,
  context: "apply",
  lines: [],
  rawLines: [],
  exitCode: undefined,
  success: undefined,
  errorType: undefined,
  errorMessage: undefined,
  systemUntouched: undefined,
};
