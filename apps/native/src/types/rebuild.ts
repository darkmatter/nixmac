// Rebuild state for showing progress inline in the widget

import type { RebuildErrorCode } from "@/lib/errors";

export type RebuildErrorType = RebuildErrorCode;

export interface RebuildLine {
  id: number;
  text: string;
  type: "stdout" | "stderr" | "info";
}

/**
 * User-facing guidance surfaced when a build-log line matches a known pattern.
 *
 * Produced by the generic log-trigger registry (`@/viewmodel/log-triggers`) and
 * folded into `rebuildLog.notices`, so the overlay can render actionable
 * instructions (e.g. how to grant a macOS permission) without coupling the UI
 * to any single error.
 */
export interface RebuildNotice {
  /** Stable trigger id; also used to de-duplicate repeated matches in one run. */
  id: string;
  title: string;
  body: string;
  /**
   * When set, the notice renders a button that deep-links to this macOS
   * permission's Settings pane via the existing permissions request flow.
   */
  permissionId?: string;
  /** Label for the deep-link button; defaults to "Open System Settings". */
  actionLabel?: string;
}

export type RebuildContext = "rollback" | "apply";

interface RebuildState {
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

const initialRebuildState: RebuildState = {
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
