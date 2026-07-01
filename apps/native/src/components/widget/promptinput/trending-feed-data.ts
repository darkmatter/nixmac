/**
 * Static content for the "Trending on nixmac" suggestion feed variation.
 *
 * A mixed feed of trending packages (nixpkgs / Homebrew), popular prompts
 * people are running, and bigger setup ideas. Each item carries a ready-to-run
 * prompt that fills the evolve input when selected.
 */

export type TrendingKind = "package" | "prompt" | "idea";

export type TrendingItem = {
  kind: TrendingKind;
  /** Package name, or a short title for prompts / ideas. */
  title: string;
  desc: string;
  prompt: string;
  badge?: "new" | "trending";
  /** Only for packages. */
  source?: "nixpkgs" | "homebrew";
  /** Social proof for prompts / ideas, e.g. "1.2k this week". */
  meta?: string;
};

export const trendingFeed: TrendingItem[] = [
  {
    kind: "package",
    title: "ghostty",
    source: "homebrew",
    desc: "GPU-accelerated terminal emulator with native UI and zero-config speed.",
    prompt: "Install the Ghostty terminal emulator.",
    badge: "trending",
  },
  {
    kind: "idea",
    title: "Dotfiles-grade dev setup",
    desc: "Editor, fast CLI tools, fonts, and shell prompt configured in one go.",
    prompt:
      "Set up a complete dev environment: install Neovim, ripgrep, fzf, bat, eza, the starship prompt, and the JetBrains Mono Nerd Font.",
    badge: "trending",
    meta: "Popular this week",
  },
  {
    kind: "package",
    title: "jujutsu",
    source: "nixpkgs",
    desc: "Git-compatible version control that makes rewriting history effortless.",
    prompt: "Install jujutsu (jj) and configure it to work with my Git repos.",
    badge: "trending",
  },
  {
    kind: "prompt",
    title: "Make macOS feel snappy",
    desc: "Auto-hide the Dock, speed up key repeat, and disable window animations.",
    prompt:
      "Auto-hide the Dock with no delay, speed up keyboard key repeat, and disable window open/close animations.",
    meta: "1.4k ran this",
  },
  {
    kind: "package",
    title: "aerospace",
    source: "homebrew",
    desc: "i3-like tiling window manager for macOS that needs no SIP changes.",
    prompt: "Install AeroSpace, the tiling window manager for macOS.",
    badge: "new",
  },
  {
    kind: "prompt",
    title: "Screenshots into ~/Pictures",
    desc: "Save screenshots as PNG to a dedicated folder instead of the Desktop.",
    prompt:
      "Change the default screenshot location to ~/Pictures/Screenshots and save them as PNG without the drop shadow.",
    meta: "880 ran this",
  },
  {
    kind: "package",
    title: "uv",
    source: "nixpkgs",
    desc: "Extremely fast Python package and project manager, written in Rust.",
    prompt: "Install uv, the fast Python package manager.",
    badge: "trending",
  },
  {
    kind: "idea",
    title: "Terminal-first Git workflow",
    desc: "lazygit, delta diffs, and handy aliases wired into your shell.",
    prompt:
      "Install lazygit and git-delta, set delta as my Git pager, and add aliases gs, gc, and gp to my shell.",
    badge: "new",
    meta: "New recipe",
  },
  {
    kind: "package",
    title: "atuin",
    source: "nixpkgs",
    desc: "Magical shell history with sync, search, and stats across machines.",
    prompt: "Install atuin and set up syncable shell history.",
    badge: "trending",
  },
];
