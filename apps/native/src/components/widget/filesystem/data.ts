export type FileTone = "teal" | "amber" | "rose" | "blue" | "muted";
export type FileStatus = "managed" | "changed" | "candidate";

export type ToggleOption = {
  kind: "toggles";
  items: Array<{ key: string; label: string; value: boolean }>;
};
export type ListOption = {
  kind: "list";
  label: string;
  items: string[];
  add: string;
};
export type SummaryOption = {
  kind: "summary";
  rows: Array<[string, string]>;
};
export type FileOptions = ToggleOption | ListOption | SummaryOption;

export type CandidateItem = {
  name: string;
  detail: string;
  installedAt: string;
  attr: string;
};

export type FsFile = {
  id: string;
  path: string;
  plainTitle: string;
  plainDesc: string;
  iconName: FsIconName;
  tone: FileTone;
  status: FileStatus;
  changedNote?: string;
  readonly?: boolean;
  options?: FileOptions;
  nix?: string;

  // Untracked / candidate-only
  destination?: string;
  scanCommand?: string;
  scannedAt?: string;
  items?: CandidateItem[];
};

export type SectionId = "entry" | "darwin" | "home" | "support" | "manage";

export type Section = {
  id: SectionId;
  plain: string;
  nix: string;
  hint: string;
};

export type Host = {
  id: string;
  name: string;
  user: string;
  current: boolean;
  state: "clean" | "dirty";
  model: string;
  lastApply: string;
};

// Lucide icons referenced from data; resolved to components in the row renderer
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
  | "warn";

export const HOSTS: Host[] = [
  { id: "fp26", name: "Farhans-MacBook-Pro-26", user: "farhan", current: true, state: "dirty", model: "MacBook Pro · M3 Max", lastApply: "2h ago" },
  { id: "mini", name: "studio-mini", user: "farhan", current: false, state: "clean", model: "Mac Mini · M2", lastApply: "yesterday" },
  { id: "work", name: "work-mbp", user: "farhan", current: false, state: "clean", model: "MacBook Pro · M2", lastApply: "3 days ago" },
  { id: "moms", name: "moms-imac", user: "farhan", current: false, state: "clean", model: "iMac · M1", lastApply: "2 weeks ago" },
];

export const SECTIONS: Section[] = [
  { id: "entry", plain: "Setup", nix: "Entry", hint: "Flake & host wiring" },
  { id: "darwin", plain: "System", nix: "Darwin", hint: "macOS, packages, services" },
  { id: "home", plain: "Personal", nix: "Home", hint: "Dotfiles & app prefs" },
  { id: "support", plain: "Secrets", nix: "Support", hint: "Sops, overlays, scripts" },
  { id: "manage", plain: "Untracked", nix: "Untracked", hint: "Machine state not yet in your config" },
];

export const FILES: Record<SectionId, FsFile[]> = {
  entry: [
    {
      id: "flake",
      path: "flake.nix",
      plainTitle: "How everything is wired",
      plainDesc: "The blueprint that points at every other piece of your config.",
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
      plainTitle: "Pinned versions",
      plainDesc: "Locked package versions. Auto-managed — never edit by hand.",
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
      plainTitle: "Command-line tools",
      plainDesc: "Programs available in your terminal — git, ripgrep, jq, etc.",
      iconName: "terminal",
      tone: "teal",
      status: "managed",
      options: {
        kind: "list",
        label: "Installed",
        items: ["git", "ripgrep", "jq", "fd", "bat", "neovim", "tmux"],
        add: "Add a tool…",
      },
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
      plainTitle: "Apps & casks",
      plainDesc: "Mac apps installed via Homebrew — Rectangle, 1Password, browsers.",
      iconName: "app",
      tone: "amber",
      status: "changed",
      changedNote: "+1 cask",
      options: {
        kind: "list",
        label: "Casks",
        items: ["rectangle", "1password", "arc", "raycast", "linear-linear"],
        add: "Add an app…",
      },
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
      plainTitle: "Dock & Finder",
      plainDesc: "macOS preferences — how the Dock, Finder, and screenshots behave.",
      iconName: "dock",
      tone: "blue",
      status: "managed",
      options: {
        kind: "toggles",
        items: [
          { key: "dock.autohide", label: "Auto-hide the Dock", value: true },
          { key: "dock.show-recents", label: "Show recent apps in Dock", value: false },
          { key: "finder.show-extensions", label: "Show all file extensions in Finder", value: true },
          { key: "screenshots.location", label: "Save screenshots to Desktop", value: true },
          { key: "trackpad.tap-to-click", label: "Tap-to-click on trackpad", value: true },
        ],
      },
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
      plainTitle: "Background services",
      plainDesc: "Things that run automatically — yabai, skhd, sketchybar.",
      iconName: "service",
      tone: "muted",
      status: "managed",
      options: {
        kind: "toggles",
        items: [
          { key: "yabai", label: "yabai (window manager)", value: true },
          { key: "skhd", label: "skhd (hotkey daemon)", value: true },
          { key: "sketchybar", label: "sketchybar (custom menu bar)", value: false },
        ],
      },
      nix: `{
  services.yabai.enable = true;
  services.skhd.enable  = true;
  services.sketchybar.enable = false;
}`,
    },
    {
      id: "security",
      path: "modules/darwin/security.nix",
      plainTitle: "Security",
      plainDesc: "Touch ID for sudo, login policy, firewall.",
      iconName: "shield",
      tone: "rose",
      status: "managed",
      options: {
        kind: "toggles",
        items: [
          { key: "touchid", label: "Touch ID for sudo", value: true },
          { key: "firewall", label: "Application firewall on", value: true },
        ],
      },
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
      plainTitle: "Shell & editor",
      plainDesc: "Your zsh, neovim, and git configs as code.",
      iconName: "shell",
      tone: "teal",
      status: "managed",
      options: {
        kind: "summary",
        rows: [
          ["Shell", "zsh + starship"],
          ["Editor", "neovim (lazyvim)"],
          ["Git", "farhan@darkmatter.io · ed25519 signing"],
        ],
      },
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
      plainTitle: "App preferences",
      plainDesc: "Per-app settings managed by home-manager — Ghostty, Raycast.",
      iconName: "preferences",
      tone: "blue",
      status: "managed",
    },
  ],
  support: [
    {
      id: "sops",
      path: ".sops.yaml",
      plainTitle: "Secrets",
      plainDesc: "API keys & SSH keys, encrypted with your age key.",
      iconName: "secret",
      tone: "rose",
      status: "managed",
      options: {
        kind: "summary",
        rows: [
          ["Backend", "age (1 recipient)"],
          ["Files", "secrets/anthropic.yaml, secrets/openai.yaml"],
          ["Last sync", "2h ago"],
        ],
      },
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
      plainTitle: "Custom packages",
      plainDesc: "Overrides and patches for things upstream doesn't ship.",
      iconName: "overlay",
      tone: "muted",
      status: "managed",
    },
  ],
  manage: [
    {
      id: "untracked-brew",
      path: "Untracked Homebrew",
      plainTitle: "11 apps installed by hand",
      plainDesc:
        "These are casks already on disk via `brew` but not declared in your flake. On a fresh Mac they wouldn't come back.",
      iconName: "warn",
      tone: "amber",
      status: "candidate",
      destination: "modules/darwin/homebrew.nix",
      scanCommand: "brew list --cask",
      scannedAt: "scanned 14 min ago",
      items: [
        { name: "docker", detail: "Docker Desktop · 4.32.0", installedAt: "Mar 12", attr: 'homebrew.casks = [ "docker" ];' },
        { name: "obs", detail: "OBS Studio · 30.2.3", installedAt: "Feb 28", attr: 'homebrew.casks = [ "obs" ];' },
        { name: "iterm2", detail: "iTerm2 · 3.5.1", installedAt: "Jan 09", attr: 'homebrew.casks = [ "iterm2" ];' },
        { name: "vlc", detail: "VLC media player · 3.0.20", installedAt: "Jan 02", attr: 'homebrew.casks = [ "vlc" ];' },
        { name: "figma", detail: "Figma · 124.4.0", installedAt: "2025-12-18", attr: 'homebrew.casks = [ "figma" ];' },
        { name: "spotify", detail: "Spotify · 1.2.45", installedAt: "2025-11-30", attr: 'homebrew.casks = [ "spotify" ];' },
        { name: "slack", detail: "Slack · 4.40.0", installedAt: "2025-11-21", attr: 'homebrew.casks = [ "slack" ];' },
        { name: "zoom", detail: "Zoom · 6.1.10", installedAt: "2025-11-15", attr: 'homebrew.casks = [ "zoom" ];' },
        { name: "discord", detail: "Discord · 0.0.310", installedAt: "2025-10-04", attr: 'homebrew.casks = [ "discord" ];' },
        { name: "notion", detail: "Notion · 4.1.0", installedAt: "2025-09-22", attr: 'homebrew.casks = [ "notion" ];' },
        { name: "audacity", detail: "Audacity · 3.6.4", installedAt: "2025-08-11", attr: 'homebrew.casks = [ "audacity" ];' },
      ],
    },
    {
      id: "custom-defaults",
      path: "Custom macOS defaults",
      plainTitle: "8 settings differ from defaults",
      plainDesc:
        "Preferences you've changed in System Settings. Capture them as code so a fresh install matches.",
      iconName: "warn",
      tone: "amber",
      status: "candidate",
      destination: "modules/darwin/defaults.nix",
      scanCommand: "defaults read · diff against profile",
      scannedAt: "scanned 14 min ago",
      items: [
        { name: "Dock — magnification on", detail: "com.apple.dock magnification = 1", installedAt: "changed Mar 18", attr: "system.defaults.dock.magnification = true;" },
        { name: "Finder — show path bar", detail: "com.apple.finder ShowPathbar = 1", installedAt: "changed Mar 02", attr: "system.defaults.finder.ShowPathbar = true;" },
        { name: "Trackpad — three-finger drag", detail: "com.apple.AppleMultitouchTrackpad TrackpadThreeFingerDrag = 1", installedAt: "changed Feb 14", attr: "system.defaults.trackpad.TrackpadThreeFingerDrag = true;" },
        { name: "Keyboard — fast key repeat", detail: "NSGlobalDomain KeyRepeat = 2 · InitialKeyRepeat = 15", installedAt: "changed Jan 28", attr: "system.defaults.NSGlobalDomain.KeyRepeat = 2;" },
        { name: "Mission Control — disable rearrange", detail: "com.apple.dock mru-spaces = 0", installedAt: "changed Jan 15", attr: "system.defaults.dock.mru-spaces = false;" },
        { name: "Hot corners — bottom-right: lock screen", detail: "com.apple.dock wvous-br-corner = 13", installedAt: "changed Jan 09", attr: "system.defaults.dock.wvous-br-corner = 13;" },
        { name: "Menu bar — show date", detail: 'com.apple.menuextra.clock DateFormat = "EEE MMM d  h:mm a"', installedAt: "changed 2025-12-22", attr: "system.defaults.menuExtraClock.ShowDate = 1;" },
        { name: "Sound — feedback off", detail: "NSGlobalDomain com.apple.sound.uiaudio.enabled = 0", installedAt: "changed 2025-12-04", attr: 'system.defaults.NSGlobalDomain."com.apple.sound.uiaudio.enabled" = 0;' },
      ],
    },
    {
      id: "login-items",
      path: "Login items",
      plainTitle: "4 apps auto-start at login",
      plainDesc: "Move them into your config so new machines launch the same set.",
      iconName: "warn",
      tone: "amber",
      status: "candidate",
      destination: "modules/darwin/services.nix",
      scanCommand: "osascript · System Events get login items",
      scannedAt: "scanned 14 min ago",
      items: [
        { name: "Rectangle", detail: "/Applications/Rectangle.app", installedAt: "since Dec 2024", attr: "launchd.user.agents.rectangle = { ... };" },
        { name: "Raycast", detail: "/Applications/Raycast.app", installedAt: "since Dec 2024", attr: "launchd.user.agents.raycast   = { ... };" },
        { name: "1Password", detail: "/Applications/1Password.app", installedAt: "since Jan 2025", attr: 'launchd.user.agents."1password" = { ... };' },
        { name: "Hammerspoon", detail: "/Applications/Hammerspoon.app", installedAt: "since Feb 2025", attr: "launchd.user.agents.hammerspoon = { ... };" },
      ],
    },
  ],
};

// Tone → Tailwind classes (foreground + soft background tint)
export const TONE_CLASSES: Record<FileTone, { fg: string; bg: string; ring: string }> = {
  teal: { fg: "text-teal-400", bg: "bg-teal-500/15", ring: "ring-teal-500/30" },
  amber: { fg: "text-amber-400", bg: "bg-amber-500/15", ring: "ring-amber-500/30" },
  rose: { fg: "text-rose-400", bg: "bg-rose-500/15", ring: "ring-rose-500/30" },
  blue: { fg: "text-sky-400", bg: "bg-sky-500/15", ring: "ring-sky-500/30" },
  muted: { fg: "text-muted-foreground", bg: "bg-muted/40", ring: "ring-border" },
};

