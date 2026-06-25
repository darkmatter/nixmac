// Rebuild state for showing progress inline in the widget

import type { RebuildErrorCode } from "@/lib/errors";

export type RebuildErrorType = RebuildErrorCode;

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
