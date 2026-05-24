#!/usr/bin/env node

/**
 * Emit (one per line) the set of repo-relative path prefixes that, if any
 * changed file matches them, indicate the target workspace's build is
 * affected.
 *
 * This is the no-turbo equivalent of:
 *
 *   turbo run build --affected --filter=<target>
 *
 * minus the content-hash cache (we only answer the affected? question;
 * caching isn't relevant for "should I release?").
 *
 * The emitted set is the union of:
 *   1. The target workspace's own directory
 *   2. Every workspace transitively reachable via `workspace:*` deps
 *   3. Global inputs that affect every workspace build:
 *      - root package.json (deps + scripts)
 *      - bun.lockb (resolved versions)
 *      - root tsconfig.json (compiler options)
 *      - root Cargo.toml / Cargo.lock (Rust side — Tauri build depends on
 *        these even though the actual Rust source lives under apps/native)
 *
 * Usage:
 *   node ops/scripts/release/affected-paths.mjs --filter=<package-name>
 *
 * Example:
 *   $ node ops/scripts/release/affected-paths.mjs --filter=native
 *   apps/native/
 *   packages/ui/
 *   package.json
 *   bun.lockb
 *   tsconfig.json
 *   Cargo.toml
 *   Cargo.lock
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..", "..", "..");

// Files at the repo root that affect every workspace's build. Anything here
// invalidates the affected check regardless of which packages were touched.
const GLOBAL_INPUTS = [
	"package.json",
	"bun.lockb",
	"bun.lock",
	"tsconfig.json",
	"Cargo.toml",
	"Cargo.lock",
];

// Parse --filter=<name> from argv. Required.
function parseFilter() {
	const arg = process.argv.slice(2).find((a) => a.startsWith("--filter="));
	if (!arg) {
		console.error("Error: --filter=<package-name> is required");
		process.exit(2);
	}
	return arg.slice("--filter=".length);
}

// Expand a workspaces glob entry (e.g. "packages/*", "apps/native") to a list
// of directories that contain a package.json. We only handle a single
// trailing `*` since that's what bun/npm/yarn workspaces actually support.
function expandWorkspaceGlob(globEntry) {
	if (!globEntry.includes("*")) {
		const dir = join(root, globEntry);
		return existsSync(join(dir, "package.json")) ? [dir] : [];
	}
	if (globEntry.endsWith("/*")) {
		const parent = join(root, globEntry.slice(0, -2));
		if (!existsSync(parent)) return [];
		return readdirSync(parent)
			.map((name) => join(parent, name))
			.filter((dir) => statSync(dir).isDirectory())
			.filter((dir) => existsSync(join(dir, "package.json")));
	}
	console.error(`Unsupported workspaces glob: ${globEntry}`);
	process.exit(2);
}

// Build a { packageName -> absolute dir } map of every workspace in the repo.
function discoverWorkspaces() {
	const rootPkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
	// Normalize both the npm/bun array form (`workspaces: ["apps/*"]`) and
	// the Yarn object form (`workspaces: { packages: ["apps/*"] }`) so this
	// script keeps working if the repo ever switches package manager.
	const ws = rootPkg.workspaces;
	const globs = Array.isArray(ws) ? ws : (ws?.packages ?? []);
	const dirs = globs.flatMap(expandWorkspaceGlob);
	const map = new Map();
	for (const dir of dirs) {
		const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"));
		if (pkg.name) map.set(pkg.name, dir);
	}
	return map;
}

// Find the workspace dir for a package name, accepting both bare names
// (`native`) and scoped names (`@nixmac/ui`). bun's filter syntax accepts both.
function resolveTargetDir(workspaces, target) {
	if (workspaces.has(target)) return workspaces.get(target);
	// Match by trailing path component (e.g. --filter=ui matches @nixmac/ui)
	for (const [name, dir] of workspaces) {
		const suffix = name.split("/").pop();
		if (suffix === target) return dir;
	}
	console.error(`No workspace found matching --filter=${target}`);
	console.error(`Available: ${[...workspaces.keys()].join(", ")}`);
	process.exit(2);
}

// Walk workspace:* deps from a starting workspace and return the set of all
// reachable workspace dirs (including the starting one).
function transitiveWorkspaceDeps(workspaces, startDir) {
	const visited = new Set([startDir]);
	const queue = [startDir];
	while (queue.length > 0) {
		const dir = queue.shift();
		const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"));
		const allDeps = {
			...(pkg.dependencies ?? {}),
			...(pkg.devDependencies ?? {}),
			...(pkg.peerDependencies ?? {}),
		};
		for (const [depName, depSpec] of Object.entries(allDeps)) {
			if (typeof depSpec === "string" && depSpec.startsWith("workspace:")) {
				const depDir = workspaces.get(depName);
				if (depDir && !visited.has(depDir)) {
					visited.add(depDir);
					queue.push(depDir);
				}
			}
		}
	}
	return visited;
}

function main() {
	const target = parseFilter();
	const workspaces = discoverWorkspaces();
	const targetDir = resolveTargetDir(workspaces, target);
	const reachable = transitiveWorkspaceDeps(workspaces, targetDir);

	const paths = [
		// Workspace dirs (with trailing slash so prefix-match doesn't catch
		// sibling dirs that happen to share a prefix, e.g. "packages/ui-x")
		...[...reachable].map((dir) => `${relative(root, dir)}/`),
		// Globals
		...GLOBAL_INPUTS.filter((p) => existsSync(join(root, p))),
	];

	console.log(paths.join("\n"));
}

main();
