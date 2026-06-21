export interface ParsedFlakeRef {
  valid: boolean;
  /** The recognized flakeref type from the Nix manual. */
  type:
    | "github"
    | "gitlab"
    | "sourcehut"
    | "git"
    | "mercurial"
    | "tarball"
    | "path"
    | "indirect"
    | "unknown";
  /** Human-friendly description of what this reference points to. */
  label: string;
  /** Hint shown under the input. */
  hint: string;
  /**
   * Whether the current native backend can import this kind of reference.
   * The backend imports GitHub repos (owner/repo) and local paths directly;
   * other flakeref kinds are recognized but not yet wired.
   */
  importable: boolean;
}

const ARCHIVE_RE = /\.(zip|tar|tgz|tar\.gz|tar\.xz|tar\.bz2|tar\.zst)$/i;

/**
 * Best-effort parser/validator for Nix flake references. Mirrors the types in
 * the Nix manual (github, gitlab, sourcehut, git, mercurial, tarball/file,
 * path, indirect). Validates shape only — it does not fetch anything.
 */
export function parseFlakeRef(raw: string): ParsedFlakeRef {
  const input = raw.trim();

  if (!input) {
    return {
      valid: false,
      type: "unknown",
      label: "",
      hint: "Paste a flake reference to continue.",
      importable: false,
    };
  }

  // github:owner/repo(/ref-or-rev)?
  const gh = input.match(/^github:([\w.-]+)\/([\w.-]+)(?:\/([\w./-]+))?/i);
  if (gh) {
    const [, owner, repo, refOrRev] = gh;
    return {
      valid: true,
      type: "github",
      label: `GitHub · ${owner}/${repo}${refOrRev ? ` @ ${refOrRev}` : ""}`,
      hint: "Fetched from GitHub — fast and no full clone.",
      importable: true,
    };
  }

  // gitlab:owner/repo
  const gl = input.match(/^gitlab:([\w.%-]+)\/([\w.-]+)(?:\/([\w./-]+))?/i);
  if (gl) {
    const [, owner, repo] = gl;
    return {
      valid: true,
      type: "gitlab",
      label: `GitLab · ${owner}/${repo}`,
      hint: "GitLab imports aren't wired yet — use GitHub or a local folder.",
      importable: false,
    };
  }

  // sourcehut:~owner/repo
  const sh = input.match(/^sourcehut:(~[\w.-]+)\/([\w.-]+)/i);
  if (sh) {
    const [, owner, repo] = sh;
    return {
      valid: true,
      type: "sourcehut",
      label: `SourceHut · ${owner}/${repo}`,
      hint: "SourceHut imports aren't wired yet — use GitHub or a local folder.",
      importable: false,
    };
  }

  // git, git+https, git+ssh, git+file, git://
  if (/^git(\+(https?|ssh|file|git))?:\/\/.+/i.test(input)) {
    return {
      valid: true,
      type: "git",
      label: "Git repository",
      hint: "Raw git refs aren't wired yet — use GitHub or a local folder.",
      importable: false,
    };
  }

  // mercurial: hg+http(s)/ssh/file
  if (/^hg\+(https?|ssh|file):\/\/.+/i.test(input)) {
    return {
      valid: true,
      type: "mercurial",
      label: "Mercurial repository",
      hint: "Mercurial imports aren't wired yet — use GitHub or a local folder.",
      importable: false,
    };
  }

  // tarball+http / file+http or any http(s) ending in an archive extension
  if (
    /^(tarball|file)\+https?:\/\/.+/i.test(input) ||
    (/^https?:\/\/.+/i.test(input) && ARCHIVE_RE.test(input.split("?")[0]))
  ) {
    return {
      valid: true,
      type: "tarball",
      label: "Tarball flake",
      hint: "Remote tarballs aren't wired yet — use GitHub or a local folder.",
      importable: false,
    };
  }

  // plain https URL (treated as tarball/file fetcher)
  if (/^https?:\/\/.+/i.test(input)) {
    return {
      valid: true,
      type: "tarball",
      label: "Remote flake (http)",
      hint: "Remote URLs aren't wired yet — use GitHub or a local folder.",
      importable: false,
    };
  }

  // path: explicit, absolute, ~ or ./ relative
  if (/^(path:|~|\/|\.\/|\.\.\/|\.$)/.test(input)) {
    return {
      valid: true,
      type: "path",
      label: "Local path",
      hint: "Points to a directory on this machine that contains a flake.nix.",
      importable: true,
    };
  }

  // indirect registry id, e.g. nixpkgs or nixpkgs/nixos-unstable
  if (/^[\w.-]+(\/[\w./-]+)?$/.test(input)) {
    return {
      valid: true,
      type: "indirect",
      label: `Registry · ${input}`,
      hint: "Registry refs aren't wired yet — use GitHub or a local folder.",
      importable: false,
    };
  }

  return {
    valid: false,
    type: "unknown",
    label: "",
    hint: "This doesn't look like a valid flake reference.",
    importable: false,
  };
}

/** Example refs surfaced as quick-fill chips in the UI. */
export const EXAMPLE_REFS: { ref: string; note: string }[] = [
  { ref: "github:alice/nix-darwin-config", note: "GitHub repo" },
  { ref: "~/Documents/nix-darwin", note: "Local folder" },
  { ref: "github:alice/dotfiles/main", note: "GitHub branch" },
];

export interface MockRepo {
  owner: string;
  name: string;
  private: boolean;
  updated: string;
  hasFlake: boolean;
}

/**
 * Sample repositories shown once GitHub is "connected". Until real GitHub
 * OAuth + repo listing lands, these are illustrative; selecting one runs the
 * real `config.importGithub` against `owner/repo`. Typing a specific repo is
 * always available via the Flake reference tab.
 */
export const MOCK_REPOS: MockRepo[] = [
  { owner: "you", name: "nix-darwin-config", private: true, updated: "2 days ago", hasFlake: true },
  { owner: "you", name: "dotfiles", private: false, updated: "3 weeks ago", hasFlake: true },
  { owner: "you", name: "home-manager-config", private: true, updated: "1 month ago", hasFlake: true },
  { owner: "you", name: "personal-site", private: false, updated: "5 months ago", hasFlake: false },
];

export interface StarterTemplate {
  id: string;
  name: string;
  description: string;
  includes: string[];
  recommended?: boolean;
}

/** Starter configurations offered to first-time users. */
export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    id: "darwin-hm",
    name: "nix-darwin + home-manager",
    description: "System settings plus per-user dotfiles. The best starting point for most people.",
    includes: ["nix-darwin", "home-manager", "Sensible macOS defaults"],
    recommended: true,
  },
  {
    id: "minimal",
    name: "Minimal nix-darwin",
    description: "Just the system layer. Add home-manager later whenever you want it.",
    includes: ["nix-darwin", "A few CLI packages"],
  },
  {
    id: "batteries",
    name: "Batteries included",
    description: "Opinionated setup with common developer tools and Homebrew casks wired in.",
    includes: ["nix-darwin", "home-manager", "Homebrew casks", "Dev tooling"],
  },
];

/** Default directory a new starter configuration is written to. */
export const DEFAULT_CONFIG_DIR = "~/.darwin";
