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

export interface StarterTemplate {
  id: StarterTemplateId;
  name: string;
  description: string;
  includes: string[];
  recommended?: boolean;
}

export type StarterTemplateId = "nix-darwin-determinate" | "nixos-unified" | "flake-parts";

/** Starter configurations offered to first-time users. */
export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    id: "nix-darwin-determinate",
    name: "nix-darwin + Determinate",
    description: "The bundled nixmac starter: nix-darwin, Determinate Nix, sops-nix, and modular defaults.",
    includes: ["nix-darwin", "Determinate Nix", "sops-nix", "Home Manager ready"],
    recommended: true,
  },
  {
    id: "nixos-unified",
    name: "nixos-unified",
    description: "A cross-platform template for sharing NixOS, nix-darwin, and home-manager structure.",
    includes: ["nixos-unified", "nix-darwin", "NixOS", "home-manager"],
  },
  {
    id: "flake-parts",
    name: "Flake parts",
    description: "A generic flake-parts starter with per-system outputs and a simple default package.",
    includes: ["flake-parts", "nixpkgs", "perSystem", "packages.default"],
  },
];

/** Default directory a new starter configuration is written to. */
export const DEFAULT_CONFIG_DIR = "/etc/nix-darwin";

/** Canonical nix-darwin path; custom directories are symlinked here. */
export const CANONICAL_CONFIG_DIR = "/etc/nix-darwin";
