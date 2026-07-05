import type {
  HomebrewItem,
  HomebrewState,
  LaunchdItem,
  SystemDefault,
  SystemDefaultsScan,
} from "@/ipc/types";
import type { TrackedCustomizationSource } from "@nixmac/state";

type CustomizationGroupId =
  | "macos-settings"
  | "homebrew-casks"
  | "homebrew-taps"
  | "launch-agents";

type GroupSeverity = "info" | "warning";

export type CustomizationSource = TrackedCustomizationSource;

interface TrackedCustomizationBuckets {
  homebrew: HomebrewItem[];
  launchd: LaunchdItem[];
  systemDefaults: SystemDefault[];
}

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
  /** The original scanner payload, tagged by scanner type for apply-time routing. */
  source: CustomizationSource;
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
      source: { type: "system-default", item: d },
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
      source: { type: "homebrew", item: { name, version: null, itemType: "cask" } },
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
      source: { type: "homebrew", item: { name, version: null, itemType: "tap" } },
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
      source: { type: "launchd", item },
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

export function collectTrackedCustomizationSources(
  trackedCustomizations: string[],
  trackedCustomizationSources: Record<string, CustomizationSource>,
): TrackedCustomizationBuckets {
  const homebrew: HomebrewItem[] = [];
  const launchd: LaunchdItem[] = [];
  const systemDefaults: SystemDefault[] = [];

  for (const id of trackedCustomizations) {
    const source = trackedCustomizationSources[id];
    if (!source) continue;

    switch (source.type) {
      case "homebrew":
        homebrew.push(source.item);
        break;
      case "launchd":
        launchd.push(source.item);
        break;
      case "system-default":
        systemDefaults.push(source.item);
        break;
    }
  }

  return {
    homebrew: uniqueHomebrewItems(homebrew),
    launchd,
    systemDefaults,
  };
}

function uniqueHomebrewItems(items: HomebrewItem[]): HomebrewItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.itemType}:${item.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
        source: {
          type: "system-default",
          item: {
            nixKey: "system.defaults.dock.expose-group-apps",
            label: "Group windows by application in Mission Control",
            category: "Dock",
            currentValue: "true",
            defaultValue: "false",
          },
        },
      },
      {
        id: "default-wm",
        label: "Window Manager — Hide desktop items in Stage Manager",
        detail: "system.defaults.WindowManager.HideDesktop = true",
        meta: "default: false",
        nixLine: "system.defaults.WindowManager.HideDesktop = true;",
        source: {
          type: "system-default",
          item: {
            nixKey: "system.defaults.WindowManager.HideDesktop",
            label: "Hide desktop items in Stage Manager",
            category: "Window Manager",
            currentValue: "true",
            defaultValue: "false",
          },
        },
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
        source: { type: "homebrew", item: { name: "raycast", version: null, itemType: "cask" } },
      },
      {
        id: "cask-ghostty",
        label: "ghostty",
        detail: "Homebrew cask",
        meta: "cask",
        nixLine: 'homebrew.casks = [ "ghostty" ];',
        source: { type: "homebrew", item: { name: "ghostty", version: null, itemType: "cask" } },
      },
    ],
  },
];
