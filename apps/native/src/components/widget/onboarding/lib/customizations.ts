import type { HomebrewState, LaunchdItem, SystemDefaultsScan } from "@/ipc/types";

export type CustomizationGroupId =
  | "macos-settings"
  | "homebrew-casks"
  | "homebrew-taps"
  | "launch-agents";

export type GroupSeverity = "info" | "warning";

export interface CustomizationItem {
  id: string;
  /** Human-readable label, e.g. "Dock — Group windows by application" */
  label: string;
  /** The detected value in mono, e.g. "dock.expose-group-apps = true" */
  detail: string;
  /** Small right-aligned hint, e.g. "default: false" or "tap" */
  meta: string;
  /** The nix line this item would add to the config */
  nixLine: string;
}

export interface CustomizationGroup {
  id: CustomizationGroupId;
  title: string;
  description: string;
  /** The shell command nixmac ran to detect these, shown in mono */
  command: string;
  /** Extra context appended after the command, e.g. "57 known keys" */
  commandNote?: string;
  /** Where the tracked items would be written */
  landingPath: string;
  severity: GroupSeverity;
  items: CustomizationItem[];
}

function defaultsGroup(scan: SystemDefaultsScan): CustomizationGroup | null {
  if (!scan.defaults.length) return null;
  return {
    id: "macos-settings",
    title: "untracked macOS settings",
    description:
      "Preferences you've changed in System Settings. Capture them as code so a fresh install matches.",
    command: "defaults read",
    commandNote: `${scan.totalScanned} known keys`,
    landingPath: "modules/darwin/defaults.nix",
    severity: "info",
    items: scan.defaults.map((d) => ({
      id: `default-${d.nixKey}`,
      label: d.category ? `${d.category} — ${d.label}` : d.label,
      detail: `${d.nixKey} = ${d.currentValue}`,
      meta: `default: ${d.defaultValue}`,
      nixLine: `${d.nixKey} = ${d.currentValue};`,
    })),
  };
}

function casksGroup(state: HomebrewState): CustomizationGroup | null {
  if (!state.isInstalled || !state.casks.length) return null;
  return {
    id: "homebrew-casks",
    title: "untracked Homebrew casks",
    description: "Homebrew casks already on disk but not declared in your flake.",
    command: "brew list --cask",
    landingPath: ".nixmac/homebrew/data.json",
    severity: "warning",
    items: state.casks.map((name) => ({
      id: `cask-${name}`,
      label: name,
      detail: "Homebrew cask",
      meta: "cask",
      nixLine: `homebrew.casks = [ "${name}" ];`,
    })),
  };
}

function tapsGroup(state: HomebrewState): CustomizationGroup | null {
  if (!state.isInstalled || !state.taps.length) return null;
  return {
    id: "homebrew-taps",
    title: "untracked Homebrew taps",
    description: "Homebrew taps already configured but not declared in your flake.",
    command: "brew tap",
    landingPath: ".nixmac/homebrew/data.json",
    severity: "warning",
    items: state.taps.map((name) => ({
      id: `tap-${name}`,
      label: name,
      detail: "Homebrew tap",
      meta: "tap",
      nixLine: `homebrew.taps = [ "${name}" ];`,
    })),
  };
}

function launchdGroup(items: LaunchdItem[]): CustomizationGroup | null {
  if (!items.length) return null;
  return {
    id: "launch-agents",
    title: "untracked launch agents",
    description: "Background services started by launchd that aren't declared in your flake yet.",
    command: "launchctl list",
    landingPath: "modules/darwin/launchd.nix",
    severity: "warning",
    items: items.map((item) => ({
      id: `launchd-${item.label}`,
      label: item.name || item.label,
      detail: item.label,
      meta: item.scope,
      nixLine: `launchd.user.agents.${item.name || "service"}.serviceConfig.ProgramArguments = [ ${item.programArguments
        .map((a) => `"${a}"`)
        .join(" ")} ];`,
    })),
  };
}

/** Assemble the non-empty customization groups from the real scanner results. */
export function buildCustomizationGroups(inputs: {
  defaults: SystemDefaultsScan;
  homebrew: HomebrewState;
  launchd: LaunchdItem[];
}): CustomizationGroup[] {
  return [
    defaultsGroup(inputs.defaults),
    casksGroup(inputs.homebrew),
    tapsGroup(inputs.homebrew),
    launchdGroup(inputs.launchd),
  ].filter((g): g is CustomizationGroup => g !== null);
}

export function totalCustomizations(groups: CustomizationGroup[]): number {
  return groups.reduce((sum, g) => sum + g.items.length, 0);
}

/** A small static sample used by Storybook and as a graceful fallback. */
export const MOCK_CUSTOMIZATION_GROUPS: CustomizationGroup[] = [
  {
    id: "macos-settings",
    title: "untracked macOS settings",
    description:
      "Preferences you've changed in System Settings. Capture them as code so a fresh install matches.",
    command: "defaults read",
    commandNote: "57 known keys",
    landingPath: "modules/darwin/defaults.nix",
    severity: "info",
    items: [
      {
        id: "default-dock",
        label: "Dock — Group windows by application in Mission Control",
        detail: "system.defaults.dock.expose-group-apps = true",
        meta: "default: false",
        nixLine: "system.defaults.dock.expose-group-apps = true;",
      },
      {
        id: "default-wm",
        label: "Window Manager — Hide desktop items in Stage Manager",
        detail: "system.defaults.WindowManager.HideDesktop = true",
        meta: "default: false",
        nixLine: "system.defaults.WindowManager.HideDesktop = true;",
      },
    ],
  },
  {
    id: "homebrew-casks",
    title: "untracked Homebrew casks",
    description: "Homebrew casks already on disk but not declared in your flake.",
    command: "brew list --cask",
    landingPath: ".nixmac/homebrew/data.json",
    severity: "warning",
    items: [
      {
        id: "cask-raycast",
        label: "raycast",
        detail: "Homebrew cask",
        meta: "cask",
        nixLine: 'homebrew.casks = [ "raycast" ];',
      },
      {
        id: "cask-ghostty",
        label: "ghostty",
        detail: "Homebrew cask",
        meta: "cask",
        nixLine: 'homebrew.casks = [ "ghostty" ];',
      },
    ],
  },
];
