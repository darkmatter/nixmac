import { TRACK_ITEMS_FILES } from "./track-items";

export type FileTone = "teal" | "amber" | "rose" | "blue" | "muted";
export type FileStatus = "managed" | "changed" | "candidate";

export type NixDarwinDocsRef = {
  optionPath: string;
  docsPath: string;
  generatedBy: string;
};

export type CandidateItem = {
  name: string;
  detail: string;
  installedAt: string;
  attr: string;
  source?: NixDarwinDocsRef;
};

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
  source?: NixDarwinDocsRef;
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
  manage: TRACK_ITEMS_FILES,
};

export const TONE_CLASSES: Record<FileTone, { fg: string; bg: string }> = {
  teal: { fg: "text-teal-400", bg: "bg-teal-500/15" },
  amber: { fg: "text-amber-400", bg: "bg-amber-500/15" },
  rose: { fg: "text-rose-400", bg: "bg-rose-500/15" },
  blue: { fg: "text-sky-400", bg: "bg-sky-500/15" },
  muted: { fg: "text-muted-foreground", bg: "bg-muted/40" },
};
