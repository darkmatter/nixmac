// @ts-nocheck - Storybook 10 factory types resolve story args too narrowly here
import preview from "#storybook/preview";
import { RebuildOverlayPanel } from "@/components/widget/overlays/rebuild-overlay-panel";
import type {
  EtcClobberCheckResult,
  EtcClobberConflict,
  EtcClobberConflictKind,
  RebuildStatus,
} from "@/ipc/types";
import { REBUILD_ERROR_CODES } from "@/lib/errors";
import type { RebuildContext, RebuildLine, RebuildNotice } from "@/types/rebuild";
import { makeRebuildStatus } from "@/utils/test-fixtures";
import { uiActions, viewModelActions } from "@nixmac/state";
import type React from "react";
import { useEffect } from "react";
import { expect, userEvent, within } from "storybook/test";

type RebuildOutcome = "idle" | "running" | "success" | "failure";
type LinePreset = "starting" | "building" | "midBuild" | "completed" | "error" | "many" | "none";

type RebuildOverlayPanelStoryArgs = {
  outcome: RebuildOutcome;
  context: RebuildContext;
  linePreset: LinePreset;
  errorType: RebuildStatus["errorType"] | "none";
  errorMessage: string;
  systemUntouched: boolean | null;
  dismissed: boolean;
  etcClobber: EtcClobberCheckResult | null;
  rawLines: string[];
  notices: RebuildNotice[];
};

const errorTypeOptions = [
  "none",
  REBUILD_ERROR_CODES.INFINITE_RECURSION,
  REBUILD_ERROR_CODES.EVALUATION_ERROR,
  REBUILD_ERROR_CODES.BUILD_ERROR,
  REBUILD_ERROR_CODES.FULL_DISK_ACCESS,
  REBUILD_ERROR_CODES.APP_MANAGEMENT,
  REBUILD_ERROR_CODES.USER_CANCELLED,
  REBUILD_ERROR_CODES.AUTHORIZATION_DENIED,
  REBUILD_ERROR_CODES.ETC_CLOBBER,
  REBUILD_ERROR_CODES.GENERIC_ERROR,
] as const;

const cat = (category: string, description: string) => ({
  description,
  table: { category },
});

const startingLines: RebuildLine[] = [{ id: 1, text: "🚀 Starting rebuild...", type: "info" }];

const buildingLines: RebuildLine[] = [
  { id: 1, text: "🚀 Starting rebuild...", type: "info" },
  { id: 2, text: "📦 Evaluating flake configuration", type: "info" },
  { id: 3, text: "🔨 Building 12 packages", type: "info" },
];

const midBuildLines: RebuildLine[] = [
  { id: 1, text: "🚀 Starting rebuild...", type: "info" },
  { id: 2, text: "📦 Evaluating flake configuration", type: "info" },
  { id: 3, text: "🔨 Building 12 packages", type: "info" },
  { id: 4, text: "📥 Fetching dependencies from cache", type: "info" },
  { id: 5, text: "⚡ Compiling neovim plugins", type: "info" },
];

const completedLines: RebuildLine[] = [
  { id: 1, text: "🚀 Starting rebuild...", type: "info" },
  { id: 2, text: "📦 Evaluating flake configuration", type: "info" },
  { id: 3, text: "🔨 Building 12 packages", type: "info" },
  { id: 4, text: "📥 Fetching dependencies from cache", type: "info" },
  { id: 5, text: "⚡ Compiling neovim plugins", type: "info" },
  { id: 6, text: "🔧 Activating system configuration", type: "info" },
  { id: 7, text: "✅ Rebuild complete!", type: "info" },
];

const errorLines: RebuildLine[] = [
  { id: 1, text: "🚀 Starting rebuild...", type: "info" },
  { id: 2, text: "📦 Evaluating flake configuration", type: "info" },
  { id: 3, text: "❌ Build failed: infinite recursion", type: "stderr" },
];

const manyLines: RebuildLine[] = [
  { id: 1, text: "🚀 Starting rebuild...", type: "info" },
  { id: 2, text: "📦 Evaluating flake configuration", type: "info" },
  { id: 3, text: "🔨 Building 24 packages", type: "info" },
  { id: 4, text: "📥 Fetching from binary cache", type: "info" },
  { id: 5, text: "⚡ Compiling neovim", type: "info" },
  { id: 6, text: "🔧 Building home-manager", type: "info" },
  { id: 7, text: "📦 Installing ripgrep", type: "info" },
  { id: 8, text: "🎯 Configuring git", type: "info" },
  { id: 9, text: "✨ Setting up zsh plugins", type: "info" },
  { id: 10, text: "🔨 Building starship prompt", type: "info" },
];

const linePresets: Record<LinePreset, RebuildLine[]> = {
  starting: startingLines,
  building: buildingLines,
  midBuild: midBuildLines,
  completed: completedLines,
  error: errorLines,
  many: manyLines,
  none: [],
};

function makeConflict(
  kind: EtcClobberConflictKind,
  overrides: Partial<EtcClobberConflict> = {},
): EtcClobberConflict {
  const filename = overrides.target ?? `${kind.replaceAll("_", "-")}.conf`;
  return {
    path: `/etc/${filename}`,
    target: filename,
    expectedStaticPath: `/etc/static/${filename}`,
    currentLinkTarget: null,
    knownSha256Hashes: [],
    kind,
    ...overrides,
  };
}

function makeEtcClobberResult(): EtcClobberCheckResult {
  return {
    ok: false,
    checked: 12,
    conflicts: [
      makeConflict("unrecognized_content", {
        path: "/etc/nix/github-token.conf",
        target: "nix/github-token.conf",
      }),
      makeConflict("non_regular_target", {
        path: "/etc/synthetic.conf",
        target: "synthetic.conf",
        currentLinkTarget: "/private/etc/synthetic.conf",
      }),
      makeConflict("unreadable", {
        path: "/etc/pam.d/sudo_local",
        target: "pam.d/sudo_local",
      }),
    ],
    warnings: [],
  };
}

function deriveStatus(args: RebuildOverlayPanelStoryArgs): RebuildStatus | null {
  if (args.outcome === "idle") {
    return null;
  }

  const isRunning = args.outcome === "running";
  const success =
    args.outcome === "running" ? null : args.outcome === "success" ? true : false;

  return makeRebuildStatus({
    isRunning,
    success,
    exitCode: success === true ? 0 : success === false ? 1 : null,
    errorType: args.outcome === "failure" && args.errorType !== "none" ? args.errorType : null,
    errorMessage: args.outcome === "failure" ? args.errorMessage : null,
    systemUntouched: args.systemUntouched,
  });
}

function RebuildOverlayPanelStory(args: RebuildOverlayPanelStoryArgs) {
  useEffect(() => {
    viewModelActions.setState({
      rebuildStatus: deriveStatus(args),
      rebuildLog: {
        lines: linePresets[args.linePreset],
        rawLines: args.rawLines,
        notices: args.notices,
      },
    });
    uiActions.setState({
      rebuildContext: args.context,
      rebuildPanelDismissed: args.dismissed,
      etcClobber: args.etcClobber,
    });

    return () => {
      viewModelActions.setState({
        rebuildStatus: null,
        rebuildLog: { lines: [], rawLines: [], notices: [] },
      });
      uiActions.setState({
        rebuildContext: "apply",
        rebuildPanelDismissed: false,
        etcClobber: null,
      });
    };
  }, [args]);

  return <RebuildOverlayPanel />;
}

const meta = preview.meta({
  title: "Components/RebuildOverlayPanel",
  component: RebuildOverlayPanelStory,
  parameters: {
    layout: "centered",
    backgrounds: {
      default: "dark",
      values: [{ name: "dark", value: "#1a1a2e" }],
    },
  },
  decorators: [
    (Story: React.ComponentType) => (
      <div style={{ width: 280, height: 400, position: "relative" }}>
        <Story />
      </div>
    ),
  ],
  tags: ["autodocs"],
  argTypes: {
    outcome: {
      control: "select",
      options: ["idle", "running", "success", "failure"],
      ...cat("Rebuild status", "High-level status that maps to `rebuildStatus` visibility."),
    },
    context: {
      control: "select",
      options: ["apply", "rollback"],
      ...cat("Rebuild status", "Whether the overlay is reporting apply or rollback."),
    },
    linePreset: {
      control: "select",
      options: ["starting", "building", "midBuild", "completed", "error", "many", "none"],
      ...cat("Rebuild log", "Structured progress-line preset used by the summary view."),
    },
    rawLines: {
      control: "object",
      ...cat("Rebuild log", "Raw console output; when empty the console falls back to structured lines."),
    },
    notices: {
      control: "object",
      ...cat("Rebuild log", "Actionable notices produced by generic build-log trigger rules."),
    },
    errorType: {
      control: "select",
      options: errorTypeOptions,
      ...cat("Failure", "Structured error code used for title, suggestion, and special panes."),
    },
    errorMessage: {
      control: "text",
      ...cat("Failure", "Failure detail shown for non-`etc_clobber` errors."),
    },
    systemUntouched: {
      control: "select",
      options: [null, true, false],
      ...cat("Failure", "Whether the backend proved the failed apply did not modify the system."),
    },
    etcClobber: {
      control: "object",
      ...cat("Failure", "Structured `/etc` conflicts shown only for `errorType: etc_clobber`."),
    },
    dismissed: {
      control: "boolean",
      ...cat("Panel lifecycle", "Hides completed panels after user dismissal."),
    },
  },
  args: {
    outcome: "running",
    context: "apply",
    linePreset: "building",
    rawLines: [
      "$ darwin-rebuild switch --flake /Users/demo/.darwin#Demo-MacBook-Pro",
      "evaluating flake configuration",
      "building the system configuration...",
    ],
    notices: [],
    errorType: "none",
    errorMessage: "darwin-rebuild failed",
    systemUntouched: null,
    dismissed: false,
    etcClobber: null,
  },
});

export default meta;

/** Interactive playground — Controls can compose every store-backed panel state. */
export const Playground = meta.story({});

/** Initial state when rebuild just started. */
export const Starting = meta.story({
  args: {
    outcome: "running",
    linePreset: "starting",
  },
});

/** Running with a few progress lines. */
export const Building = meta.story({
  args: {
    outcome: "running",
    linePreset: "building",
  },
});

/** Running with more progress and pending skeleton rows. */
export const MidBuild = meta.story({
  args: {
    outcome: "running",
    linePreset: "midBuild",
  },
});

/** Running rebuild after nix-darwin asks for App Management. */
export const AppManagementNotice = meta.story({
  args: {
    outcome: "running",
    linePreset: "midBuild",
    rawLines: [
      "Requesting admin privileges for activation...",
      "error: permission denied when trying to update apps, aborting activation",
      "`darwin-rebuild` requires permission to update your apps, please accept the notification",
      "If you did not get a notification, you can navigate to System Settings > Privacy & Security > App Management.",
    ],
    notices: [
      {
        id: "app-management-permission",
        title: "App Management permission required",
        body: "macOS blocked activation while darwin-rebuild was updating managed app bundles. Accept the App Management notification if it appears. If it does not, open System Settings → Privacy & Security → App Management and enable nixmac, then retry the rebuild.",
        permissionId: "app-management",
        actionLabel: "Open App Management",
      },
    ],
  },
});

/** Successfully completed apply. */
export const Success = meta.story({
  args: {
    outcome: "success",
    linePreset: "completed",
  },
});

/** Failed with infinite recursion, including the system-untouched reassurance. */
export const InfiniteRecursionError = meta.story({
  args: {
    outcome: "failure",
    linePreset: "error",
    errorType: REBUILD_ERROR_CODES.INFINITE_RECURSION,
    errorMessage: "error: infinite recursion encountered at /nix/store/...-source/flake.nix:42",
    systemUntouched: true,
  },
});

/** Failed with a Nix evaluation error. */
export const EvaluationError = meta.story({
  args: {
    outcome: "failure",
    linePreset: "error",
    errorType: REBUILD_ERROR_CODES.EVALUATION_ERROR,
    errorMessage:
      "error: attribute 'missing-package' not found at /nix/store/...-source/configuration.nix:15",
    systemUntouched: true,
  },
});

/** Failed while building a package. */
export const BuildError = meta.story({
  args: {
    outcome: "failure",
    linePreset: "error",
    errorType: REBUILD_ERROR_CODES.BUILD_ERROR,
    errorMessage: "builder for '/nix/store/abc123-some-package.drv' failed with exit code 1",
  },
});

/** Full Disk Access denial, with the dedicated suggestion text. */
export const FullDiskAccessRequired = meta.story({
  args: {
    outcome: "failure",
    linePreset: "error",
    errorType: REBUILD_ERROR_CODES.FULL_DISK_ACCESS,
    errorMessage: "Operation not permitted while reading /etc/sudoers.d",
    systemUntouched: true,
  },
});

/** App Management denial when activation updates managed app bundles. */
export const AppManagementRequired = meta.story({
  args: {
    outcome: "failure",
    linePreset: "error",
    errorType: REBUILD_ERROR_CODES.APP_MANAGEMENT,
    errorMessage: "permission denied when trying to update apps, aborting activation",
    systemUntouched: false,
  },
});

/** User cancelled the activation. */
export const UserCancelled = meta.story({
  args: {
    outcome: "failure",
    linePreset: "error",
    errorType: REBUILD_ERROR_CODES.USER_CANCELLED,
    errorMessage: "Activation cancelled by user",
    systemUntouched: true,
  },
});

/** Authorization was denied by the operating system. */
export const AuthorizationDenied = meta.story({
  args: {
    outcome: "failure",
    linePreset: "error",
    errorType: REBUILD_ERROR_CODES.AUTHORIZATION_DENIED,
    errorMessage: "Authorization denied",
    systemUntouched: true,
  },
});

/** Failed before activation because nix-darwin would clobber unmanaged `/etc` files. */
export const EtcClobberError = meta.story({
  args: {
    outcome: "failure",
    linePreset: "error",
    errorType: REBUILD_ERROR_CODES.ETC_CLOBBER,
    errorMessage: "Unexpected files in /etc would be overwritten",
    systemUntouched: true,
    etcClobber: makeEtcClobberResult(),
  },
});

/** Generic catch-all failure state. */
export const GenericError = meta.story({
  args: {
    outcome: "failure",
    linePreset: "error",
    errorType: REBUILD_ERROR_CODES.GENERIC_ERROR,
    errorMessage: "An unexpected error occurred during the rebuild process",
  },
});

/** Rollback failures expose the enabled retry action instead of disabled rollback. */
export const RollbackFailure = meta.story({
  args: {
    outcome: "failure",
    context: "rollback",
    linePreset: "error",
    errorType: REBUILD_ERROR_CODES.BUILD_ERROR,
    errorMessage: "Rollback activation failed",
    systemUntouched: false,
  },
});

/** Running rollback uses rollback-specific fallback copy when no log lines exist yet. */
export const RollbackStartingWithoutLines = meta.story({
  args: {
    outcome: "running",
    context: "rollback",
    linePreset: "none",
  },
});

/** Many lines to test scrolling and gradient masking behavior. */
export const ManyLines = meta.story({
  args: {
    outcome: "running",
    linePreset: "many",
  },
});

/** Completed panels can be hidden after dismissal. */
export const DismissedAfterCompletion = meta.story({
  args: {
    outcome: "success",
    linePreset: "completed",
    dismissed: true,
  },
});

/** The idle state intentionally renders nothing. */
export const IdleHidden = meta.story({
  args: {
    outcome: "idle",
    linePreset: "none",
  },
});

/** Interaction coverage for the local console/summary toggle state. */
export const ConsoleOutput = meta.story({
  args: {
    outcome: "running",
    linePreset: "building",
    rawLines: [
      "$ darwin-rebuild switch --flake /Users/demo/.darwin#Demo-MacBook-Pro",
      "warning: Git tree '/Users/demo/.darwin' is dirty",
      "error: builder for '/nix/store/demo.drv' failed with exit code 1",
      "copying path '/nix/store/cache-hit' from 'https://cache.nixos.org'...",
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: /console/i }));
    await expect(await canvas.findByText(/darwin-rebuild switch/)).toBeInTheDocument();
  },
});
