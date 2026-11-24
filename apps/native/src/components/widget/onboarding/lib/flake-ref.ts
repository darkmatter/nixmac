export interface ParsedFlakeRef {
	valid: boolean;
	/** The recognized import input shape understood by the backend parser. */
	type: "repo" | "unknown";
	/** Human-friendly description of what this reference points to. */
	label: string;
	/** Hint shown under the input. */
	hint: string;
	/** Whether the current native backend can import this reference. */
	importable: boolean;
}

const VALID_SEGMENT_RE = /^[A-Za-z0-9._-]+$/;
const GITHUB_HOST_RE = /^(www\.)?github\.com$/i;

function isValidSegment(segment: string): boolean {
	return segment.length > 0 && VALID_SEGMENT_RE.test(segment);
}

function validateSubdir(path: string): string | null {
	if (path.startsWith("/")) return "Subdirectory must be relative.";

	const components = path.split("/");
	for (const component of components) {
		if (!component || component === "." || component === "..") {
			return "Invalid dir. Avoid empty segments and '.' or '..'.";
		}
	}

	return null;
}

function parseQuery(input: string): { locator: string; error?: string } {
	const [locator, query] = input.split("?", 2);
	if (!query) return { locator };

	const seen = new Set<string>();

	for (const pair of query.split("&").filter(Boolean)) {
		const [key, value] = pair.split("=", 2);
		if (!key || value === undefined) {
			return { locator, error: `Invalid query parameter '${pair}'.` };
		}
		if (!value) {
			return { locator, error: `Query parameter '${key}' must not be empty.` };
		}

		if (key !== "ref" && key !== "dir") {
			return { locator, error: `Unsupported query parameter '${key}'.` };
		}
		if (seen.has(key)) {
			return { locator, error: `'${key}' specified more than once.` };
		}
		seen.add(key);

		if (key === "dir") {
			const subdirError = validateSubdir(value);
			if (subdirError) return { locator, error: subdirError };
		}
	}

	return { locator };
}

function ownerAndRepoFromLocator(
	locator: string,
): { ok: true; owner: string; repo: string } | { ok: false; error?: string } {
	const fullUrl = locator.match(/^(https?:\/\/|ssh:\/\/)/i);
	let path = "";
	// Shorthand and github.com/ paths always name a GitHub repository.
	let githubLocator = true;

	if (fullUrl) {
		try {
			const url = new URL(locator);
			path = url.pathname.replace(/^\/+|\/+$/g, "");
			githubLocator = GITHUB_HOST_RE.test(url.hostname);
		} catch {
			return { ok: false };
		}
	} else if (locator.startsWith("git@")) {
		const idx = locator.indexOf(":");
		if (idx < 0) return { ok: false };
		path = locator.slice(idx + 1).replace(/^\/+|\/+$/g, "");
		githubLocator = GITHUB_HOST_RE.test(locator.slice("git@".length, idx));
	} else {
		const withoutLeading = locator.replace(/^\/+/, "");
		if (
			locator.startsWith("/") &&
			/^(www\.)?github\.com\//i.test(withoutLeading)
		) {
			return { ok: false };
		}
		path = withoutLeading
			.replace(/^github\.com\//i, "")
			.replace(/^www\.github\.com\//i, "")
			.replace(/^\/+|\/+$/g, "");
	}

	const parts = path.split("/").filter(Boolean);
	if (parts.length < 2) return { ok: false };

	// GitHub repositories are exactly owner/repo, and `parse_repo_ref` rejects
	// longer paths such as owner/repo/subdir or /tree/main browser URLs. Other
	// hosts can nest repositories under groups, so they keep the last two
	// segments.
	if (githubLocator && parts.length > 2) {
		return {
			ok: false,
			error:
				"'owner/repo/<path>' is not supported — use ?ref=<branch-or-tag> or ?dir=<subdirectory> instead.",
		};
	}

	const owner = parts[parts.length - 2] ?? "";
	const repo = (parts[parts.length - 1] ?? "").replace(/\.git$/i, "");

	if (!isValidSegment(owner) || !isValidSegment(repo)) return { ok: false };
	return { ok: true, owner, repo };
}

/**
 * Best-effort parser/validator for repository references supported by
 * `bootstrap::import::parse_repo_ref`.
 */
export function parseFlakeRef(raw: string): ParsedFlakeRef {
	let input = raw.trim();

	if (!input) {
		return {
			valid: false,
			type: "unknown",
			label: "",
			hint: "Paste a repository reference to continue.",
			importable: false,
		};
	}

	// Nix-style `github:owner/repo` sugar for the shorthand form (mirrors
	// `bootstrap::import::parse_repo_ref`). The path-segment ref form is
	// pointed at `?ref=`, which the shorthand supports.
	if (input.startsWith("github:")) {
		input = input.slice("github:".length);
		const locatorPart = (input.split("?", 2)[0] ?? "").replace(/^\/+|\/+$/g, "");
		if (locatorPart.split("/").filter(Boolean).length > 2) {
			return {
				valid: false,
				type: "unknown",
				label: "",
				hint: "'github:owner/repo/<ref>' is not supported — use github:owner/repo?ref=<ref> instead.",
				importable: false,
			};
		}
	}

	const { locator, error } = parseQuery(input);
	if (error) {
		return {
			valid: false,
			type: "unknown",
			label: "",
			hint: error,
			importable: false,
		};
	}

	const parsed = ownerAndRepoFromLocator(locator);
	if (parsed.ok) {
		const fullUrl = /^(https?:\/\/|ssh:\/\/)/i.test(locator);
		const scpUrl = locator.startsWith("git@");
		const githubHost = /^(www\.)?github\.com\//i.test(locator);
		const shorthand = !fullUrl && !scpUrl && !githubHost;

		const sourceKind = fullUrl
			? "Git URL"
			: scpUrl
				? "SSH repo"
				: shorthand
					? "GitHub shorthand"
					: "GitHub path";

		return {
			valid: true,
			type: "repo",
			label: `${sourceKind} · ${parsed.owner}/${parsed.repo}`,
			hint: "Supports optional ?ref=<branch-or-tag> and ?dir=<subdirectory>.",
			importable: true,
		};
	}

	return {
		valid: false,
		type: "unknown",
		label: "",
		hint:
			parsed.error ??
			"Expected owner/repo, github.com/owner/repo, git@github.com:owner/repo.git, or an http(s)/ssh git URL.",
		importable: false,
	};
}

/** Example refs surfaced as quick-fill chips in the UI. */
export const EXAMPLE_REFS: { ref: string; note: string }[] = [
	{ ref: "owner/repo", note: "GitHub shorthand" },
	{ ref: "github:owner/repo?dir=hosts/work", note: "Nix-style GitHub ref" },
	{ ref: "owner/repo?ref=main", note: "Shorthand + branch/tag" },
	{ ref: "owner/repo?dir=hosts/work", note: "Shorthand + subdirectory" },
	{ ref: "owner/repo?ref=main&dir=hosts/work", note: "Shorthand + ref + dir" },
	{ ref: "github.com/owner/repo.git", note: "GitHub host form" },
	{ ref: "https://github.com/owner/repo", note: "GitHub HTTPS URL" },
	{
		ref: "git@github.com:owner/repo.git?ref=main&dir=mac",
		note: "GitHub SSH URL",
	},
	{
		ref: "ssh://git@example.com/x/y.git?dir=system",
		note: "Generic SSH Git URL",
	},
];

interface StarterTemplate {
	id: StarterTemplateId;
	name: string;
	description: string;
	includes: string[];
	recommended?: boolean;
}

export type StarterTemplateId =
	| "nix-darwin-determinate"
	| "nixos-unified"
	| "flake-parts";

/** Starter configurations offered to first-time users. */
export const STARTER_TEMPLATES: StarterTemplate[] = [
	{
		id: "nix-darwin-determinate",
		name: "nix-darwin + Determinate",
		description:
			"The bundled nixmac starter: nix-darwin, Determinate Nix, sops-nix, and modular defaults.",
		includes: [
			"nix-darwin",
			"Determinate Nix",
			"sops-nix",
			"Home Manager ready",
		],
		recommended: true,
	},
	{
		id: "nixos-unified",
		name: "nixos-unified",
		description:
			"A cross-platform template for sharing NixOS, nix-darwin, and home-manager structure.",
		includes: ["nixos-unified", "nix-darwin", "NixOS", "home-manager"],
	},
	{
		id: "flake-parts",
		name: "Flake parts",
		description:
			"A generic flake-parts starter with per-system outputs and a simple default package.",
		includes: ["flake-parts", "nixpkgs", "perSystem", "packages.default"],
	},
];

/** Default directory a new starter configuration is written to. */
export const DEFAULT_CONFIG_DIR = "/etc/nix-darwin";

/** Canonical nix-darwin path; custom directories are symlinked here. */
export const CANONICAL_CONFIG_DIR = "/etc/nix-darwin";
