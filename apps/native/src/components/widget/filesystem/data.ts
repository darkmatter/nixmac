import type {
  HomebrewItemType,
  HomebrewState,
  SystemDefault,
  SystemDefaultsScan,
} from "@/ipc/types";

export type FileTone = "teal" | "amber" | "rose" | "blue" | "muted";
export type FileStatus = "managed" | "changed" | "candidate";

type BaseCandidateItem = {
  name: string;
  detail: string;
  installedAt: string;
  attr: string;
  version?: string;
};

export type CandidateItem =
  | (BaseCandidateItem & {
      source: "homebrew";
      itemType: HomebrewItemType;
    })
  | (BaseCandidateItem & {
      source: "system";
      systemDefault: SystemDefault;
    })
  | (BaseCandidateItem & {
      source: "other";
    });

export type FsFile = {
  id: string;
  /** Absolute repo-relative path (e.g. modules/darwin/homebrew.nix). */
  path: string;
  /** Friendly title shown in the row. */
  title: string;
  /** One-line description shown under the title. */
  description: string;
  iconName: FsIconName;
  tone: FileTone;
  status: FileStatus;
  changedNote?: string;
  /** A short hint shown next to the Edit-with-prompt button to bias what the user types. */
  promptHint?: string;
  /** Source preview shown when the row is peeked. */
  nix?: string;
  readonly?: boolean;

  // Untracked-only fields
  /** Where would-be-tracked items would land. */
  destination?: string;
  scanCommand?: string;
  scannedAt?: string;
  items?: CandidateItem[];
};

export type SectionId = "entry" | "darwin" | "home" | "support" | "manage";

export type Section = {
  id: SectionId;
  label: string;
  hint: string;
};

export type FsIconName =
  | "wiring"
  | "lock"
  | "terminal"
  | "app"
  | "dock"
  | "service"
  | "shield"
  | "shell"
  | "preferences"
  | "secret"
  | "overlay"
  | "settings"
  | "warn";

export const SECTIONS: Section[] = [
  { id: "entry", label: "Setup", hint: "Flake & host wiring" },
  { id: "darwin", label: "System", hint: "macOS, packages, services" },
  { id: "home", label: "Personal", hint: "Dotfiles & app prefs" },
  { id: "support", label: "Secrets", hint: "Sops, overlays, scripts" },
  { id: "manage", label: "Untracked", hint: "Machine state not yet in your config" },
];

export const FILES: Record<SectionId, FsFile[]> = {
  entry: [
    {
      id: "flake",
      path: "flake.nix",
      title: "How everything is wired",
      description: "The blueprint that points at every other piece of your config.",
      promptHint: "e.g. add the unstable nixpkgs channel",
      iconName: "wiring",
      tone: "muted",
      status: "managed",
      nix: `{
  description = "Farhan's nix-darwin systems";
  inputs = {
    nixpkgs.url     = "github:NixOS/nixpkgs/nixpkgs-unstable";
    nix-darwin.url  = "github:nix-darwin/nix-darwin/master";
    home-manager.url = "github:nix-community/home-manager";
  };

  outputs = inputs@{ nix-darwin, ... }: {
    darwinConfigurations."Farhans-MacBook-Pro-26" =
      nix-darwin.lib.darwinSystem {
        modules = [
          ./modules/darwin/packages.nix
          ./modules/darwin/homebrew.nix
          ./modules/darwin/defaults.nix
          ./modules/home/dotfiles.nix
        ];
      };
  };
}`,
    },
    {
      id: "lock",
      path: "flake.lock",
      title: "Pinned versions",
      description: "Locked package versions. Auto-managed — never edit by hand.",
      iconName: "lock",
      tone: "muted",
      status: "managed",
      readonly: true,
    },
  ],
  darwin: [
    {
      id: "packages",
      path: "modules/darwin/packages.nix",
      title: "Command-line tools",
      description: "Programs available in your terminal — git, ripgrep, jq, etc.",
      promptHint: "e.g. add a CLI tool",
      iconName: "terminal",
      tone: "teal",
      status: "managed",
      nix: `{ pkgs, ... }: {
  environment.systemPackages = with pkgs; [
    git
    ripgrep
    jq
    fd
    bat
    neovim
    tmux
  ];
}`,
    },
    {
      id: "homebrew",
      path: "modules/darwin/homebrew.nix",
      title: "Apps & casks",
      description: "Mac apps installed via Homebrew — Rectangle, 1Password, browsers.",
      promptHint: "e.g. install Slack",
      iconName: "app",
      tone: "amber",
      status: "changed",
      changedNote: "+1 cask",
      nix: `{
  homebrew = {
    enable = true;
    onActivation.cleanup = "zap";
    casks = [
      "rectangle"
      "1password"
      "arc"
      "raycast"
      "linear-linear"   # ← new
    ];
  };
}`,
    },
    {
      id: "defaults",
      path: "modules/darwin/defaults.nix",
      title: "Dock & Finder",
      description: "macOS preferences — how the Dock, Finder, and screenshots behave.",
      promptHint: "e.g. auto-hide the Dock",
      iconName: "dock",
      tone: "blue",
      status: "managed",
      nix: `{
  system.defaults = {
    dock = {
      autohide      = true;
      show-recents  = false;
    };
    finder = {
      AppleShowAllExtensions = true;
    };
    screencapture.location = "~/Desktop";
    trackpad.Clicking = true;
  };
}`,
    },
    {
      id: "services",
      path: "modules/darwin/services.nix",
      title: "Background services",
      description: "Things that run automatically — yabai, skhd, sketchybar.",
      promptHint: "e.g. enable yabai",
      iconName: "service",
      tone: "muted",
      status: "managed",
      nix: `{
  services.yabai.enable = true;
  services.skhd.enable  = true;
  services.sketchybar.enable = false;
}`,
    },
    {
      id: "security",
      path: "modules/darwin/security.nix",
      title: "Security",
      description: "Touch ID for sudo, login policy, firewall.",
      promptHint: "e.g. enable Touch ID for sudo",
      iconName: "shield",
      tone: "rose",
      status: "managed",
      nix: `{
  security.pam.services.sudo_local.touchIdAuth = true;
  networking.applicationFirewall.enable = true;
}`,
    },
  ],
  home: [
    {
      id: "dotfiles",
      path: "modules/home/dotfiles.nix",
      title: "Shell & editor",
      description: "Your zsh, neovim, and git configs as code.",
      promptHint: "e.g. switch from neovim to helix",
      iconName: "shell",
      tone: "teal",
      status: "managed",
      nix: `{ pkgs, ... }: {
  programs.zsh = { enable = true; };
  programs.starship.enable = true;
  programs.neovim = { enable = true; defaultEditor = true; };
  programs.git = {
    enable = true;
    userEmail = "farhan@darkmatter.io";
    signing.signByDefault = true;
  };
}`,
    },
    {
      id: "apps",
      path: "modules/home/apps.nix",
      title: "App preferences",
      description: "Per-app settings managed by home-manager — Ghostty, Raycast.",
      promptHint: "e.g. set Ghostty's theme to gruvbox",
      iconName: "preferences",
      tone: "blue",
      status: "managed",
    },
  ],
  support: [
    {
      id: "sops",
      path: ".sops.yaml",
      title: "Secrets",
      description: "API keys & SSH keys, encrypted with your age key.",
      promptHint: "e.g. add a new secret recipient",
      iconName: "secret",
      tone: "rose",
      status: "managed",
      nix: `keys:
  - &farhan age1q9z...e8jx
creation_rules:
  - path_regex: secrets/[^/]+\\.yaml$
    key_groups:
      - age: [*farhan]`,
    },
    {
      id: "overlays",
      path: "nix-overlays.nix",
      title: "Custom packages",
      description: "Overrides and patches for things upstream doesn't ship.",
      iconName: "overlay",
      tone: "muted",
      status: "managed",
    },
  ],
  manage: [
    {
      id: "custom-defaults",
      path: "Custom macOS defaults",
      title: "Scanning macOS defaults",
      description:
        "Preferences you've changed in System Settings. Capture them as code so a fresh install matches.",
      iconName: "settings",
      tone: "blue",
      status: "candidate",
      destination: "modules/darwin/defaults.nix",
      scanCommand: "scan_system_defaults",
      scannedAt: "not scanned yet",
      items: [],
    },
    {
      id: "untracked-homebrew-casks",
      path: "Untracked Homebrew casks",
      title: "Scanning Homebrew casks",
      description:
        "Homebrew casks installed on this Mac but not declared in your flake.",
      iconName: "warn",
      tone: "amber",
      status: "candidate",
      destination: ".nixmac/homebrew/data.json",
      scanCommand: "homebrew_get_state_diff",
      scannedAt: "not scanned yet",
      items: [],
    },
    {
      id: "untracked-homebrew-taps",
      path: "Untracked Homebrew taps",
      title: "Scanning Homebrew taps",
      description:
        "Homebrew taps configured on this Mac but not declared in your flake.",
      iconName: "warn",
      tone: "amber",
      status: "candidate",
      destination: ".nixmac/homebrew/data.json",
      scanCommand: "homebrew_get_state_diff",
      scannedAt: "not scanned yet",
      items: [],
    },
    {
      id: "untracked-homebrew-brews",
      path: "Untracked Homebrew brews",
      title: "Scanning Homebrew brews",
      description:
        "Homebrew brews installed on this Mac but not declared in your flake.",
      iconName: "warn",
      tone: "amber",
      status: "candidate",
      destination: ".nixmac/homebrew/data.json",
      scanCommand: "homebrew_get_state_diff",
      scannedAt: "not scanned yet",
      items: [],
    },
    {
      id: "login-items",
      path: "Login items",
      title: "4 apps auto-start at login",
      description: "Move them into your config so new machines launch the same set.",
      iconName: "warn",
      tone: "amber",
      status: "candidate",
      destination: "modules/darwin/services.nix",
      scanCommand: "osascript · System Events get login items",
      scannedAt: "scanned 14 min ago",
      items: [
        { name: "Rectangle", detail: "/Applications/Rectangle.app", installedAt: "since Dec 2024", attr: "launchd.user.agents.rectangle = { ... };", source: "other" },
        { name: "Raycast", detail: "/Applications/Raycast.app", installedAt: "since Dec 2024", attr: "launchd.user.agents.raycast   = { ... };", source: "other" },
        { name: "1Password", detail: "/Applications/1Password.app", installedAt: "since Jan 2025", attr: 'launchd.user.agents."1password" = { ... };', source: "other" },
        { name: "Hammerspoon", detail: "/Applications/Hammerspoon.app", installedAt: "since Feb 2025", attr: "launchd.user.agents.hammerspoon = { ... };", source: "other" },
      ],
    },
  ],
};

const HOMEBREW_FILE_DESTINATION = ".nixmac/homebrew/data.json";
const SYSTEM_DEFAULTS_FILE_DESTINATION = "modules/darwin/defaults.nix";
const SYSTEM_DEFAULTS_ID = "custom-defaults";

type HomebrewSectionDefinition = {
  id: string;
  kind: HomebrewItemType;
  stateKey: "casks" | "taps" | "brews";
  singular: string;
  plural: string;
  emptyTitle: string;
  foundDescription: string;
  emptyDescription: string;
  scanCommand: string;
};

const HOMEBREW_SECTIONS: HomebrewSectionDefinition[] = [
  {
    id: "untracked-homebrew-casks",
    kind: "cask",
    stateKey: "casks",
    singular: "cask",
    plural: "casks",
    emptyTitle: "No untracked Homebrew casks",
    foundDescription: "Homebrew casks already on disk but not declared in your flake.",
    emptyDescription: "Every detected Homebrew cask is already declared in your config.",
    scanCommand: "brew list --cask",
  },
  {
    id: "untracked-homebrew-taps",
    kind: "tap",
    stateKey: "taps",
    singular: "tap",
    plural: "taps",
    emptyTitle: "No untracked Homebrew taps",
    foundDescription: "Homebrew taps already configured but not declared in your flake.",
    emptyDescription: "Every detected Homebrew tap is already declared in your config.",
    scanCommand: "brew tap",
  },
  {
    id: "untracked-homebrew-brews",
    kind: "brew",
    stateKey: "brews",
    singular: "brew",
    plural: "brews",
    emptyTitle: "No untracked Homebrew brews",
    foundDescription: "Homebrew brews already on disk but not declared in your flake.",
    emptyDescription: "Every detected Homebrew brew is already declared in your config.",
    scanCommand: "brew list --formula --installed-on-request",
  },
];

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return count === 1 ? singular : plural;
}

function scannedAt(lastChecked: number) {
  const ageSecs = Math.max(0, Math.floor(Date.now() / 1000) - lastChecked);
  if (ageSecs < 60) return "scanned just now";
  const minutes = Math.floor(ageSecs / 60);
  if (minutes < 60) return `scanned ${minutes} ${pluralize(minutes, "min")} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `scanned ${hours} ${pluralize(hours, "hour")} ago`;
  const days = Math.floor(hours / 24);
  return `scanned ${days} ${pluralize(days, "day")} ago`;
}

function homebrewItems(names: string[], itemType: HomebrewItemType): CandidateItem[] {
  const attrPath = itemType === "brew" ? "brews" : `${itemType}s`;
  const label = itemType === "brew" ? "formula" : itemType;
  return names.map((name) => ({
    name,
    detail: `Homebrew ${label}`,
    installedAt: label,
    attr: `homebrew.${attrPath} = [ "${name}" ];`,
    source: "homebrew",
    itemType,
  }));
}

function systemDefaultsFallback(): FsFile {
  return FILES.manage.find((file) => file.id === SYSTEM_DEFAULTS_ID) ?? {
    id: SYSTEM_DEFAULTS_ID,
    path: "Custom macOS defaults",
    title: "Scanning macOS defaults",
    description:
      "Preferences you've changed in System Settings. Capture them as code so a fresh install matches.",
    iconName: "settings" as const,
    tone: "blue" as const,
    status: "candidate" as const,
    destination: SYSTEM_DEFAULTS_FILE_DESTINATION,
  };
}

function nixValue(setting: SystemDefault) {
  const value = setting.currentValue;
  const defaultLower = setting.defaultValue.trim().toLowerCase();
  const lower = value.trim().toLowerCase();
  if (defaultLower === "true" || defaultLower === "false") {
    if (lower === "true" || lower === "1") return "true";
    return "false";
  }
  if (lower === "true" || lower === "false") return lower;
  if (/^-?\d+(\.\d+)?$/.test(value.trim())) return value.trim();
  return JSON.stringify(value);
}

function systemDefaultItems(defaults: SystemDefault[]): CandidateItem[] {
  return defaults.map((setting) => {
    const key = setting.nixKey.replace(/^system\.defaults\./, "");
    const attr = `${setting.nixKey} = ${nixValue(setting)};`;
    return {
      name: `${setting.category} - ${setting.label}`,
      detail: `${key} = ${setting.currentValue}`,
      installedAt: `default: ${setting.defaultValue}`,
      attr,
      source: "system",
      systemDefault: setting,
    };
  });
}

export function systemDefaultsFileFromScan(
  scan: SystemDefaultsScan | null,
  error?: string | null,
): FsFile {
  const fallback = systemDefaultsFallback();

  if (error) {
    return {
      ...fallback,
      title: "macOS defaults scan failed",
      description: error,
      scanCommand: "scan_system_defaults",
      scannedAt: "scan failed",
      items: [],
    };
  }

  if (!scan) return fallback;

  const items = systemDefaultItems(scan.defaults);
  const count = items.length;

  return {
    ...fallback,
    title:
      count === 0
        ? "No untracked macOS defaults"
        : `${count} untracked macOS ${pluralize(count, "setting")}`,
    description:
      count === 0
        ? "Every detected macOS preference is already declared or still at its factory default."
        : "Preferences you've changed in System Settings. Capture them as code so a fresh install matches.",
    destination: SYSTEM_DEFAULTS_FILE_DESTINATION,
    scanCommand: `defaults read (${scan.totalScanned} known keys)`,
    scannedAt: "scanned just now",
    items,
  };
}

export function untrackedCandidateItemCount(files: FsFile[]) {
  return files.reduce((acc, file) => {
    if (file.status !== "candidate") return acc;
    return acc + (file.items?.length ?? 0);
  }, 0);
}

function homebrewFallback(section: HomebrewSectionDefinition): FsFile {
  const base = FILES.manage.find((file) => file.id === section.id);
  return base ?? {
    id: section.id,
    path: `Untracked Homebrew ${section.plural}`,
    title: `Untracked Homebrew ${section.plural}`,
    description: `Homebrew ${section.plural} installed on this Mac but not declared in your flake.`,
    iconName: "warn" as const,
    tone: "amber" as const,
    status: "candidate" as const,
    destination: HOMEBREW_FILE_DESTINATION,
  };
}

function homebrewFileForSection(
  section: HomebrewSectionDefinition,
  diff: HomebrewState | null,
  error?: string | null,
): FsFile {
  const fallback = homebrewFallback(section);

  if (error) {
    return {
      ...fallback,
      title: "Homebrew scan failed",
      description: error,
      scanCommand: "homebrew_get_state_diff",
      scannedAt: "scan failed",
      items: [],
    };
  }

  if (!diff) return fallback;

  if (!diff.isInstalled) {
    return {
      ...fallback,
      title: "Homebrew not found",
      description: "Homebrew is not installed or not discoverable on this Mac.",
      scanCommand: "brew --version",
      scannedAt: scannedAt(diff.lastChecked),
      items: [],
    };
  }

  const items = homebrewItems(diff[section.stateKey], section.kind);
  const count = items.length;

  return {
    ...fallback,
    title:
      count === 0
        ? section.emptyTitle
        : `${count} untracked Homebrew ${pluralize(count, section.singular, section.plural)}`,
    description: count === 0 ? section.emptyDescription : section.foundDescription,
    destination: HOMEBREW_FILE_DESTINATION,
    scanCommand: section.scanCommand,
    scannedAt: scannedAt(diff.lastChecked),
    items,
  };
}

export function homebrewFilesFromDiff(diff: HomebrewState | null, error?: string | null): FsFile[] {
  return HOMEBREW_SECTIONS.map((section) => homebrewFileForSection(section, diff, error));
}

export function isHomebrewCandidateFile(file: FsFile) {
  return HOMEBREW_SECTIONS.some((section) => section.id === file.id);
}

export function isSystemDefaultsCandidateFile(file: FsFile) {
  return file.id === SYSTEM_DEFAULTS_ID;
}

function isHomebrewPlaceholder(file: FsFile) {
  return HOMEBREW_SECTIONS.some((section) => section.id === file.id);
}

export function replaceHomebrewPlaceholders(files: FsFile[], replacements: FsFile[]) {
  const [firstHomebrew] = HOMEBREW_SECTIONS;
  return files.flatMap((file) => {
    if (file.id === firstHomebrew.id) return replacements;
    return isHomebrewPlaceholder(file) ? [] : [file];
  });
}

export function replaceSystemDefaultsPlaceholder(files: FsFile[], replacement: FsFile) {
  return files.map((file) => (file.id === SYSTEM_DEFAULTS_ID ? replacement : file));
}

export const TONE_CLASSES: Record<FileTone, { fg: string; bg: string }> = {
  teal: { fg: "text-teal-400", bg: "bg-teal-500/15" },
  amber: { fg: "text-amber-400", bg: "bg-amber-500/15" },
  rose: { fg: "text-rose-400", bg: "bg-rose-500/15" },
  blue: { fg: "text-sky-400", bg: "bg-sky-500/15" },
  muted: { fg: "text-muted-foreground", bg: "bg-muted/40" },
};
