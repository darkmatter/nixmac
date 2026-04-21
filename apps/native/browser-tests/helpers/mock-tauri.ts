import type { Page } from "@playwright/test";

export interface TauriMockConfig {
  configDir?: string;
  hostAttr?: string;
  hosts?: string[];
  evolveResult?: unknown;
  historyItems?: unknown[];
}

/**
 * The mock evolve result that advances the app from "begin" to "evolve" step.
 * Override specific fields via TauriMockConfig.evolveResult.
 */
export const DEFAULT_EVOLVE_RESULT = {
  changeMap: {
    groups: [],
    singles: [
      {
        hash: "abc1234",
        title: "Add neovim to system packages",
        summary: "Added neovim as a system package",
        diff: "+  neovim",
        unsummarizedHashes: [],
      },
    ],
    unsummarizedHashes: [],
  },
  gitStatus: {
    files: [{ path: "configuration.nix", status: "modified", additions: 1, deletions: 0 }],
    branch: "main",
    branchCommitMessages: [],
    isMainBranch: true,
    branchHasBuiltCommit: false,
    diff: "+  neovim",
    additions: 1,
    deletions: 0,
    headCommitHash: "abc1234",
    cleanHead: false,
    changes: [],
  },
  evolveState: {
    evolutionId: 1,
    currentChangesetId: 1,
    changesetAtBuild: null,
    committable: false,
    backupBranch: "backup/evolve-1",
    step: "evolve",
  },
  conversationalResponse: null,
  telemetry: {
    state: "generated",
    iterations: 1,
    buildAttempts: 1,
    totalTokens: 500,
    editsCount: 1,
    thinkingCount: 1,
    toolCallsCount: 3,
    durationMs: 5000,
  },
};

/**
 * Injects window.__TAURI_INTERNALS__ before the page loads so that all
 * `invoke()` calls from @tauri-apps/api/core are intercepted by our mock.
 *
 * Also sets up window.__TAURI_EVENT_PLUGIN_INTERNALS__ (needed by the real
 * @tauri-apps/api/event _unlisten function) and exposes
 * window.__emitTauriEvent(name, payload) for tests that need to simulate
 * backend events.
 */
export function injectTauriMocks(page: Page, overrides: TauriMockConfig = {}) {
  const config = {
    configDir: "/mock/nixconfig",
    hostAttr: "Test-MacBook",
    hosts: ["Test-MacBook"],
    evolveResult: DEFAULT_EVOLVE_RESULT,
    historyItems: [] as unknown[],
    ...overrides,
  };

  // NOTE: this function runs in the browser context — no imports, no TS types
  // that survive to runtime. Serializable config is passed as the second arg.
  return page.addInitScript((cfg) => {
    let nextCallbackId = 0;
    // Maps event name → list of callback IDs registered via listen()
    const eventRegistry: Record<string, number[]> = {};

    (window as any).__TAURI_INTERNALS__ = {
      transformCallback(callback: (r: unknown) => unknown, once: boolean) {
        const id = ++nextCallbackId;
        (window as any)["_" + id] = function (result: unknown) {
          if (once) delete (window as any)["_" + id];
          return callback(result);
        };
        return id;
      },

      unregisterCallback(id: number) {
        delete (window as any)["_" + id];
      },

      async invoke(command: string, args: Record<string, unknown> = {}) {
        switch (command) {
          // ── Event system ──────────────────────────────────────────────────
          case "plugin:event|listen": {
            const name = args.event as string;
            const handlerId = args.handler as number;
            if (name) {
              (eventRegistry[name] = eventRegistry[name] ?? []).push(handlerId);
            }
            return handlerId;
          }
          case "plugin:event|unlisten":
          case "plugin:event|emit":
          case "plugin:event|emit_to":
            return null;

          // ── Permissions ───────────────────────────────────────────────────
          case "permissions_check_all":
            return {
              permissions: [
                { id: "desktop",   name: "Desktop",   description: "", required: true,  canRequestProgrammatically: true,  status: "granted" },
                { id: "documents", name: "Documents", description: "", required: true,  canRequestProgrammatically: true,  status: "granted" },
                { id: "admin",     name: "Admin",     description: "", required: true,  canRequestProgrammatically: false, status: "granted" },
                { id: "full-disk", name: "Full Disk", description: "", required: false, canRequestProgrammatically: false, status: "granted" },
              ],
              allRequiredGranted: true,
              checkedAt: Date.now(),
            };
          case "plugin:macos-permissions|check_full_disk_access_permission":
            return true;

          // ── Config ────────────────────────────────────────────────────────
          case "config_get":
            return { configDir: cfg.configDir, hostAttr: cfg.hostAttr };
          case "config_set_dir":
          case "config_set_host_attr":
          case "config_pick_dir":
            return cfg.configDir;

          // ── Nix ───────────────────────────────────────────────────────────
          case "nix_check":
            return { installed: true, version: "2.20.0", darwin_rebuild_available: true };

          // ── Flake ─────────────────────────────────────────────────────────
          case "flake_list_hosts":
            return [...cfg.hosts];
          case "flake_exists":
          case "flake_exists_at":
            return true;

          // ── Git ───────────────────────────────────────────────────────────
          case "git_status":
          case "git_status_and_cache":
          case "git_cached":
          case "git_init_if_needed":
            return { files: [], branch: "main", branchCommitMessages: [], isMainBranch: true, branchHasBuiltCommit: false, diff: "", additions: 0, deletions: 0, headCommitHash: null, cleanHead: true, changes: [] };
          case "git_commit":
            return { hash: "mock123", evolveState: { evolutionId: null, currentChangesetId: null, changesetAtBuild: null, committable: false, backupBranch: null, step: "begin" } };
          case "git_stash":
          case "git_stage_all":
          case "git_unstage_all":
          case "git_restore_all":
            return null;

          // ── Evolve state ──────────────────────────────────────────────────
          case "routing_state_get":
          case "routing_state_clear":
            return { evolutionId: null, currentChangesetId: null, changesetAtBuild: null, committable: false, backupBranch: null, step: "begin" };

          // ── Prefs ─────────────────────────────────────────────────────────
          case "ui_get_prefs":
            return { evolveProvider: "openai", evolveModel: "gpt-4", maxIterations: 25, confirmBuild: false, confirmClear: false, confirmRollback: false, sendDiagnostics: false };
          case "ui_set_prefs":
            return null;

          // ── Change map ────────────────────────────────────────────────────
          case "find_change_map":
          case "summarize_current":
            return { groups: [], singles: [], unsummarizedHashes: [] };
          case "generate_commit_message":
            return "chore: mock commit";

          // ── Prompt history ────────────────────────────────────────────────
          case "get_prompt_history":
            return [];
          case "add_to_prompt_history":
            return null;

          // ── Misc ──────────────────────────────────────────────────────────
          case "get_recommended_prompt":
            return null;
          case "preview_indicator_get_state":
            return { visible: false, summary: null, filesChanged: 0, additions: 0, deletions: 0, isLoading: false };
          case "preview_indicator_show":
          case "preview_indicator_hide":
          case "preview_indicator_update":
            return null;
          case "check_cli_tools":
            return {};
          case "scan_system_defaults":
            return { defaults: [], totalScanned: 0 };
          case "get_history":
            return [...cfg.historyItems];
          case "path_exists":
            return true;
          case "path_normalize":
            return args.input ?? "";
          case "plugin:shell|open":
            return null;

          // ── Evolve ────────────────────────────────────────────────────────
          case "darwin_evolve":
            return cfg.evolveResult;
          case "darwin_evolve_cancel":
            return null;
          case "darwin_adopt_manual_changes":
            return 1;
          case "darwin_build_check":
            return { passed: true, output: "" };

          // ── Apply ─────────────────────────────────────────────────────────
          case "darwin_apply_stream_start":
          case "darwin_apply_stream_cancel":
            return null;
          case "finalize_apply":
            return {
              gitStatus: { files: [], branch: "main", branchCommitMessages: [], isMainBranch: true, branchHasBuiltCommit: true, diff: "", additions: 0, deletions: 0, headCommitHash: "built123", cleanHead: true, changes: [] },
              evolveState: { evolutionId: null, currentChangesetId: null, changesetAtBuild: null, committable: false, backupBranch: null, step: "begin" },
            };
          case "rollback_erase":
          case "finalize_rollback":
            return {
              gitStatus: { files: [], branch: "main", branchCommitMessages: [], isMainBranch: true, branchHasBuiltCommit: false, diff: "", additions: 0, deletions: 0, headCommitHash: null, cleanHead: true, changes: [] },
              evolveState: { evolutionId: null, currentChangesetId: null, changesetAtBuild: null, committable: false, backupBranch: null, step: "begin" },
            };

          // ── Restore ───────────────────────────────────────────────────────
          case "prepare_restore":
          case "abort_restore":
            return null;
          case "finalize_restore":
            return { files: [], branch: "main", branchCommitMessages: [], isMainBranch: true, branchHasBuiltCommit: false, diff: "", additions: 0, deletions: 0, headCommitHash: null, cleanHead: true, changes: [] };

          // ── LSP ───────────────────────────────────────────────────────────
          case "lsp_start":
          case "lsp_send":
          case "lsp_stop":
            return null;

          default:
            return null;
        }
      },
    };

    // Required by @tauri-apps/api/event's internal _unlisten function
    (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener() {},
    };

    // Expose for tests that need to simulate backend events
    (window as any).__emitTauriEvent = function (eventName: string, payload: unknown) {
      const ids: number[] = eventRegistry[eventName] ?? [];
      for (const id of ids) {
        const fn = (window as any)["_" + id];
        if (typeof fn === "function") {
          fn({ event: eventName, payload, id });
        }
      }
    };
  }, config);
}
