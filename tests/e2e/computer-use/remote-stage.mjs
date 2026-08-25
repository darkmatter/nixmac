import { tryRun } from "./process-utils.mjs";
import { e2eHomebrewFormula } from "./system-fixture.mjs";

export { e2eHomebrewFormula } from "./system-fixture.mjs";

export const remoteSystemSnapshotVersion = 2;
export const remoteRestoreMarkerVersion = 1;
export const remoteRestoreMarkerRelativePath = ".nixmac-e2e/system-restore-marker.json";
export const remoteRestoreResultRelativePath = ".nixmac-e2e/system-restore-result.json";

const supportedBrewPaths = new Set(["/opt/homebrew/bin/brew", "/usr/local/bin/brew"]);
const systemProfilePath = "/nix/var/nix/profiles/system";
const nixEnvPath = "/nix/var/nix/profiles/default/bin/nix-env";
const darwinSystemPattern = /^\/nix\/store\/[a-z0-9]{32}-darwin-system-[A-Za-z0-9._+-]+$/;
const brewfileStorePattern = /^\/nix\/store\/[0123456789abcdfghijklmnpqrsvwxyz]{32}-Brewfile$/;
const sha256Pattern = /^[0-9a-f]{64}$/;
const runIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const isoTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function requirePlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function requireBoolean(value, label) {
  if (typeof value !== "boolean") throw new TypeError(`${label} must be a boolean`);
  return value;
}

function requireString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function requireExactKeys(value, expected, label) {
  const actualKeys = Object.keys(value).sort();
  const expectedKeys = [...expected].sort();
  if (
    actualKeys.length !== expectedKeys.length ||
    !actualKeys.every((key, index) => key === expectedKeys[index])
  ) {
    throw new Error(`${label} has unexpected fields`);
  }
}

function parseBooleanField(fields, name) {
  if (!["true", "false"].includes(fields[name])) {
    throw new Error(`${name} must be true or false`);
  }
  return fields[name] === "true";
}

function requireRemoteHome(value) {
  const remoteHome = requireString(value, "remoteHome").replace(/\/+$/, "");
  const segments = remoteHome.split("/");
  if (
    !remoteHome.startsWith("/") ||
    remoteHome === "/" ||
    remoteHome.includes("//") ||
    segments.some((segment) => segment === "." || segment === "..") ||
    /[\n\r]/.test(remoteHome)
  ) {
    throw new Error("remoteHome must be a normalized non-root absolute path");
  }
  return remoteHome;
}

export function cleanupPointersForRunId(runId) {
  if (!runIdPattern.test(requireString(runId, "runId"))) {
    throw new Error("runId contains unsupported characters");
  }
  return {
    appSupportBackup: `/tmp/nixmac-computer-use-e2e-backup-${runId}`,
    appSupportState: `/tmp/nixmac-computer-use-e2e-backup-${runId}.state`,
    configDir: `/tmp/nixmac-computer-use-e2e-config-${runId}`,
    appStage: `/tmp/nixmac-computer-use-e2e-app-${runId}`,
    keyFile: `/tmp/nixmac-openrouter-key-${runId}`,
    authBackup: `/tmp/nixmac-computer-use-e2e-auth-system-privilege-admin-${runId}.plist`,
  };
}

export function validateE2eHomebrewFormula(formula = e2eHomebrewFormula) {
  const candidate = requirePlainObject(formula, "formula");
  if (
    candidate.name !== e2eHomebrewFormula.name ||
    candidate.executable !== e2eHomebrewFormula.executable ||
    candidate.versionPrefix !== e2eHomebrewFormula.versionPrefix
  ) {
    throw new Error("The remote Product Proof system formula is fixed to hello");
  }
  return e2eHomebrewFormula;
}

function validateBrewPath(value) {
  const brewPath = requireString(value, "snapshot.brewPath");
  if (!supportedBrewPaths.has(brewPath)) {
    throw new Error(`Unsupported Homebrew path: ${brewPath}`);
  }
  return brewPath;
}

function validateDarwinSystemPath(value, label = "snapshot.activeSystem") {
  const systemPath = requireString(value, label);
  if (!darwinSystemPattern.test(systemPath)) {
    throw new Error(`${label} must be a nix-darwin system store path`);
  }
  return systemPath;
}

function expectedFormulaExecutablePath(brewPath) {
  return brewPath.replace(/\/brew$/, `/${e2eHomebrewFormula.executable}`);
}

export function remoteSystemSnapshotCommand(formula = e2eHomebrewFormula) {
  validateE2eHomebrewFormula(formula);
  return String.raw`set -euo pipefail
brew=""
for candidate in /opt/homebrew/bin/brew /usr/local/bin/brew; do
  if [[ -x "$candidate" ]]; then
    brew="$candidate"
    break
  fi
done
[[ -n "$brew" ]] || { echo "error: Homebrew executable not found" >&2; exit 1; }
active_system="$(/usr/bin/readlink -f /run/current-system)"
profile_store="$(/usr/bin/readlink -f /nix/var/nix/profiles/system)"
[[ "$active_system" =~ ^/nix/store/[a-z0-9]{32}-darwin-system-[A-Za-z0-9._+-]+$ ]] || { echo "error: invalid active nix-darwin system path" >&2; exit 1; }
[[ "$profile_store" == "$active_system" ]] || { echo "error: active system and system profile differ" >&2; exit 1; }
[[ -x "$active_system/activate" ]] || { echo "error: active system activate script is unavailable" >&2; exit 1; }
[[ -x "$active_system/activate-user" ]] || { echo "error: active system user activation script is unavailable" >&2; exit 1; }
[[ -x "$active_system/sw/bin/darwin-rebuild" ]] || { echo "error: active system darwin-rebuild is unavailable" >&2; exit 1; }
[[ -x /nix/var/nix/profiles/default/bin/nix-env ]] || { echo "error: nix-env is unavailable" >&2; exit 1; }
active_brewfile="$(LC_ALL=C /usr/bin/sed -nE "s#.*brew bundle --file='([^']+)'.*#\1#p" "$active_system/activate")"
[[ -n "$active_brewfile" ]] || { echo "error: active system activation has no Homebrew Brewfile" >&2; exit 1; }
[[ "$active_brewfile" != *$'\n'* ]] || { echo "error: active system activation references multiple Homebrew Brewfiles" >&2; exit 1; }
[[ "$active_brewfile" =~ ^/nix/store/[0123456789abcdfghijklmnpqrsvwxyz]{32}-Brewfile$ ]] || { echo "error: active Homebrew Brewfile is outside the expected Nix store shape" >&2; exit 1; }
[[ -f "$active_brewfile" && -r "$active_brewfile" && ! -L "$active_brewfile" ]] || { echo "error: active Homebrew Brewfile is not a readable regular store file" >&2; exit 1; }
[[ "$(/usr/bin/readlink -f "$active_brewfile")" == "$active_brewfile" ]] || { echo "error: active Homebrew Brewfile does not resolve to itself" >&2; exit 1; }
active_brewfile_sha256="$(/usr/bin/shasum -a 256 "$active_brewfile" | /usr/bin/awk '{print $1}')"
[[ "$active_brewfile_sha256" =~ ^[0-9a-f]{64}$ ]] || { echo "error: active Homebrew Brewfile SHA-256 is invalid" >&2; exit 1; }
formula_declaration_count="$(LC_ALL=C /usr/bin/awk '/^[[:space:]]*brew[[:space:]]+"hello"([[:space:]]*,[^#]*)?([[:space:]]*#.*)?$/ { n++ } END { print n + 0 }' "$active_brewfile")"
(( formula_declaration_count <= 1 )) || { echo 'error: active Homebrew Brewfile contains duplicate exact brew "hello" declarations' >&2; exit 1; }
active_brewfile_declares_formula=false
[[ "$formula_declaration_count" -eq 1 ]] && active_brewfile_declares_formula=true
formula_prefix="$(/usr/bin/dirname "$(/usr/bin/dirname "$brew")")"
formula_cellar="$formula_prefix/Cellar/hello"
formula_opt="$formula_prefix/opt/hello"
formula_executable="$formula_prefix/bin/hello"
formula_installed=false
formula_version=""
if [[ -e "$formula_cellar" || -L "$formula_cellar" || -e "$formula_opt" || -L "$formula_opt" || -e "$formula_executable" || -L "$formula_executable" ]]; then
  formula_installed=true
  if [[ -d "$formula_cellar" ]]; then
    cellar_versions="$(/usr/bin/find "$formula_cellar" -mindepth 1 -maxdepth 1 -type d -exec /usr/bin/basename {} \; | /usr/bin/sort | /usr/bin/tr '\n' ' ' | /usr/bin/sed 's/[[:space:]]*$//')"
    [[ -n "$cellar_versions" ]] && formula_version="hello $cellar_versions"
  fi
fi
formula_executable_present=false
formula_executable_version=""
if [[ -e "$formula_executable" || -L "$formula_executable" ]]; then
  formula_executable_present=true
  [[ -x "$formula_executable" ]] || { echo "error: hello executable path exists but is not executable" >&2; exit 1; }
  formula_executable_version="$($formula_executable --version 2>&1 | /usr/bin/head -1)"
fi
printf 'VERSION=2\n'
printf 'FORMULA=hello\n'
printf 'BREW_PATH_B64='; printf '%s' "$brew" | /usr/bin/base64 | /usr/bin/tr -d '\n'; printf '\n'
printf 'FORMULA_EXECUTABLE_B64='; printf '%s' "$formula_executable" | /usr/bin/base64 | /usr/bin/tr -d '\n'; printf '\n'
printf 'FORMULA_INSTALLED=%s\n' "$formula_installed"
printf 'FORMULA_VERSION_B64='; printf '%s' "$formula_version" | /usr/bin/base64 | /usr/bin/tr -d '\n'; printf '\n'
printf 'FORMULA_EXECUTABLE_PRESENT=%s\n' "$formula_executable_present"
printf 'FORMULA_EXECUTABLE_VERSION_B64='; printf '%s' "$formula_executable_version" | /usr/bin/base64 | /usr/bin/tr -d '\n'; printf '\n'
printf 'ACTIVE_BREWFILE_B64='; printf '%s' "$active_brewfile" | /usr/bin/base64 | /usr/bin/tr -d '\n'; printf '\n'
printf 'ACTIVE_BREWFILE_SHA256=%s\n' "$active_brewfile_sha256"
printf 'ACTIVE_BREWFILE_DECLARES_FORMULA=%s\n' "$active_brewfile_declares_formula"
printf 'ACTIVE_SYSTEM_B64='; printf '%s' "$active_system" | /usr/bin/base64 | /usr/bin/tr -d '\n'; printf '\n'
printf 'PROFILE_STORE_B64='; printf '%s' "$profile_store" | /usr/bin/base64 | /usr/bin/tr -d '\n'; printf '\n'
printf 'PROFILE_PATH_B64='; printf '%s' '/nix/var/nix/profiles/system' | /usr/bin/base64 | /usr/bin/tr -d '\n'; printf '\n'
printf 'NIX_ENV_PATH_B64='; printf '%s' '/nix/var/nix/profiles/default/bin/nix-env' | /usr/bin/base64 | /usr/bin/tr -d '\n'; printf '\n'`;
}

export function validateRemoteSystemSnapshot(value, { requireFormulaAbsent = false } = {}) {
  const snapshot = requirePlainObject(value, "snapshot");
  requireExactKeys(
    snapshot,
    [
      "version",
      "formula",
      "brewPath",
      "formulaExecutable",
      "formulaInstalled",
      "formulaVersion",
      "formulaExecutablePresent",
      "formulaExecutableVersion",
      "activeBrewfile",
      "activeBrewfileSha256",
      "activeBrewfileDeclaresFormula",
      "activeSystem",
      "profileStore",
      "profilePath",
      "nixEnvPath",
    ],
    "snapshot",
  );
  if (snapshot.version !== remoteSystemSnapshotVersion) {
    throw new Error(`Unsupported remote system snapshot version: ${snapshot.version}`);
  }
  if (snapshot.formula !== e2eHomebrewFormula.name) {
    throw new Error("Remote system snapshot formula must be hello");
  }
  const brewPath = validateBrewPath(snapshot.brewPath);
  const formulaExecutable = requireString(snapshot.formulaExecutable, "snapshot.formulaExecutable");
  if (formulaExecutable !== expectedFormulaExecutablePath(brewPath)) {
    throw new Error("Remote system snapshot formula executable does not match Homebrew");
  }
  const formulaInstalled = requireBoolean(snapshot.formulaInstalled, "snapshot.formulaInstalled");
  const formulaExecutablePresent = requireBoolean(
    snapshot.formulaExecutablePresent,
    "snapshot.formulaExecutablePresent",
  );
  const formulaVersion = snapshot.formulaVersion ?? "";
  const formulaExecutableVersion = snapshot.formulaExecutableVersion ?? "";
  if (typeof formulaVersion !== "string" || typeof formulaExecutableVersion !== "string") {
    throw new TypeError("Remote system snapshot formula versions must be strings");
  }
  if (formulaInstalled !== formulaExecutablePresent) {
    throw new Error("Homebrew formula and executable presence disagree");
  }
  if (formulaInstalled && (!formulaVersion || !formulaExecutableVersion)) {
    throw new Error("Installed Homebrew formula requires formula and executable versions");
  }
  if (!formulaInstalled && (formulaVersion || formulaExecutableVersion)) {
    throw new Error("Absent Homebrew formula cannot record installed versions");
  }
  if (
    formulaExecutableVersion &&
    !formulaExecutableVersion.startsWith(e2eHomebrewFormula.versionPrefix)
  ) {
    throw new Error("Unexpected hello executable version output");
  }
  if (requireFormulaAbsent && formulaInstalled) {
    throw new Error("The hello Product Proof formula must be absent before the run");
  }
  const activeBrewfile = requireString(snapshot.activeBrewfile, "snapshot.activeBrewfile");
  if (!brewfileStorePattern.test(activeBrewfile)) {
    throw new Error("snapshot.activeBrewfile must be an immutable Nix store Brewfile");
  }
  const activeBrewfileSha256 = requireString(
    snapshot.activeBrewfileSha256,
    "snapshot.activeBrewfileSha256",
  );
  if (!sha256Pattern.test(activeBrewfileSha256)) {
    throw new Error("snapshot.activeBrewfileSha256 must be a lowercase SHA-256");
  }
  const activeBrewfileDeclaresFormula = requireBoolean(
    snapshot.activeBrewfileDeclaresFormula,
    "snapshot.activeBrewfileDeclaresFormula",
  );
  if (requireFormulaAbsent && activeBrewfileDeclaresFormula) {
    throw new Error("The active Homebrew plan must not declare hello before the run");
  }
  const activeSystem = validateDarwinSystemPath(snapshot.activeSystem, "snapshot.activeSystem");
  const profileStore = validateDarwinSystemPath(snapshot.profileStore, "snapshot.profileStore");
  if (profileStore !== activeSystem) {
    throw new Error("Remote active system and profile store must match before the run");
  }
  if (snapshot.profilePath !== systemProfilePath) {
    throw new Error(`Remote system profile must be ${systemProfilePath}`);
  }
  if (snapshot.nixEnvPath !== nixEnvPath) {
    throw new Error(`Remote nix-env must be ${nixEnvPath}`);
  }
  return {
    version: remoteSystemSnapshotVersion,
    formula: e2eHomebrewFormula.name,
    brewPath,
    formulaExecutable,
    formulaInstalled,
    formulaVersion,
    formulaExecutablePresent,
    formulaExecutableVersion,
    activeBrewfile,
    activeBrewfileSha256,
    activeBrewfileDeclaresFormula,
    activeSystem,
    profileStore,
    profilePath: systemProfilePath,
    nixEnvPath,
  };
}

export function parseRemoteSystemSnapshot(stdout, options = {}) {
  const expectedFields = new Set([
    "VERSION",
    "FORMULA",
    "BREW_PATH_B64",
    "FORMULA_EXECUTABLE_B64",
    "FORMULA_INSTALLED",
    "FORMULA_VERSION_B64",
    "FORMULA_EXECUTABLE_PRESENT",
    "FORMULA_EXECUTABLE_VERSION_B64",
    "ACTIVE_BREWFILE_B64",
    "ACTIVE_BREWFILE_SHA256",
    "ACTIVE_BREWFILE_DECLARES_FORMULA",
    "ACTIVE_SYSTEM_B64",
    "PROFILE_STORE_B64",
    "PROFILE_PATH_B64",
    "NIX_ENV_PATH_B64",
  ]);
  const fields = {};
  for (const line of String(stdout).split("\n")) {
    if (!line) continue;
    const index = line.indexOf("=");
    if (index < 1) throw new Error("Remote system snapshot contains a malformed field");
    const name = line.slice(0, index);
    if (!expectedFields.has(name)) {
      throw new Error(`Remote system snapshot contains unexpected field ${name}`);
    }
    if (Object.hasOwn(fields, name)) {
      throw new Error(`Remote system snapshot contains duplicate field ${name}`);
    }
    fields[name] = line.slice(index + 1);
  }
  const missing = [...expectedFields].filter((name) => !Object.hasOwn(fields, name));
  if (missing.length) {
    throw new Error(`Remote system snapshot is missing fields: ${missing.join(", ")}`);
  }
  if (fields.VERSION !== String(remoteSystemSnapshotVersion)) {
    throw new Error(`Unsupported remote system snapshot version: ${fields.VERSION}`);
  }
  if (fields.FORMULA !== e2eHomebrewFormula.name) {
    throw new Error("Remote system snapshot formula must be hello");
  }
  const decodeSnapshotBase64 = (name) => {
    const encoded = fields[name];
    if (
      encoded &&
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)
    ) {
      throw new Error(`Remote system snapshot field ${name} is not canonical base64`);
    }
    const decoded = Buffer.from(encoded, "base64");
    if (decoded.toString("base64") !== encoded) {
      throw new Error(`Remote system snapshot field ${name} is not canonical base64`);
    }
    return decoded.toString("utf8");
  };
  return validateRemoteSystemSnapshot(
    {
      version: remoteSystemSnapshotVersion,
      formula: fields.FORMULA,
      brewPath: decodeSnapshotBase64("BREW_PATH_B64"),
      formulaExecutable: decodeSnapshotBase64("FORMULA_EXECUTABLE_B64"),
      formulaInstalled: parseBooleanField(fields, "FORMULA_INSTALLED"),
      formulaVersion: decodeSnapshotBase64("FORMULA_VERSION_B64"),
      formulaExecutablePresent: parseBooleanField(fields, "FORMULA_EXECUTABLE_PRESENT"),
      formulaExecutableVersion: decodeSnapshotBase64("FORMULA_EXECUTABLE_VERSION_B64"),
      activeBrewfile: decodeSnapshotBase64("ACTIVE_BREWFILE_B64"),
      activeBrewfileSha256: fields.ACTIVE_BREWFILE_SHA256,
      activeBrewfileDeclaresFormula: parseBooleanField(fields, "ACTIVE_BREWFILE_DECLARES_FORMULA"),
      activeSystem: decodeSnapshotBase64("ACTIVE_SYSTEM_B64"),
      profileStore: decodeSnapshotBase64("PROFILE_STORE_B64"),
      profilePath: decodeSnapshotBase64("PROFILE_PATH_B64"),
      nixEnvPath: decodeSnapshotBase64("NIX_ENV_PATH_B64"),
    },
    options,
  );
}

export function captureRemoteSystemSnapshot({
  formula = e2eHomebrewFormula,
  execute = ssh,
  requireFormulaAbsent = false,
} = {}) {
  const result = execute(remoteSystemSnapshotCommand(formula));
  if (!result.ok) {
    return {
      snapshot: null,
      error: result.stderr || result.stdout || "Remote system snapshot command failed.",
    };
  }
  try {
    return {
      snapshot: parseRemoteSystemSnapshot(result.stdout, { requireFormulaAbsent }),
      error: "",
    };
  } catch (error) {
    return {
      snapshot: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function remoteRestoreMarkerPath(remoteHome) {
  return `${requireRemoteHome(remoteHome)}/${remoteRestoreMarkerRelativePath}`;
}

export function remoteRestoreResultPath(remoteHome) {
  return `${requireRemoteHome(remoteHome)}/${remoteRestoreResultRelativePath}`;
}

export function buildRemoteRestoreMarker(snapshot, { runId, capturedAt, cleanup } = {}) {
  const validated = validateRemoteSystemSnapshot(snapshot, { requireFormulaAbsent: true });
  const markerRunId = requireString(runId, "runId");
  if (!runIdPattern.test(markerRunId)) throw new Error("runId contains unsupported characters");
  const timestamp = requireString(capturedAt, "capturedAt");
  if (!isoTimestampPattern.test(timestamp) || Number.isNaN(Date.parse(timestamp))) {
    throw new Error("capturedAt must be an ISO UTC timestamp");
  }
  return {
    version: remoteRestoreMarkerVersion,
    runId: markerRunId,
    capturedAt: timestamp,
    originalSystem: validated.activeSystem,
    profilePath: validated.profilePath,
    nixEnvPath: validated.nixEnvPath,
    formula: {
      name: validated.formula,
      brewPath: validated.brewPath,
      executablePath: validated.formulaExecutable,
      installedBefore: validated.formulaInstalled,
      versionBefore: validated.formulaVersion || null,
      executableVersionBefore: validated.formulaExecutableVersion || null,
    },
    cleanup: validateCleanupPointers(cleanup, markerRunId),
  };
}

function validateCleanupPointers(value, runId) {
  const cleanup = requirePlainObject(value, "cleanup");
  const expected = cleanupPointersForRunId(runId);
  requireExactKeys(cleanup, Object.keys(expected), "cleanup");
  for (const [name, expectedPath] of Object.entries(expected)) {
    if (cleanup[name] !== expectedPath) {
      throw new Error(`cleanup.${name} must be ${expectedPath}`);
    }
  }
  return expected;
}

export function validateRemoteRestoreMarker(value) {
  const marker = requirePlainObject(value, "marker");
  requireExactKeys(
    marker,
    [
      "version",
      "runId",
      "capturedAt",
      "originalSystem",
      "profilePath",
      "nixEnvPath",
      "formula",
      "cleanup",
    ],
    "marker",
  );
  if (marker.version !== remoteRestoreMarkerVersion) {
    throw new Error(`Unsupported restore marker version: ${marker.version}`);
  }
  const runId = requireString(marker.runId, "marker.runId");
  if (!runIdPattern.test(runId)) throw new Error("marker.runId contains unsupported characters");
  const capturedAt = requireString(marker.capturedAt, "marker.capturedAt");
  if (!isoTimestampPattern.test(capturedAt) || Number.isNaN(Date.parse(capturedAt))) {
    throw new Error("marker.capturedAt must be an ISO UTC timestamp");
  }
  const originalSystem = validateDarwinSystemPath(marker.originalSystem, "marker.originalSystem");
  if (marker.profilePath !== systemProfilePath) {
    throw new Error(`Restore marker profile must be ${systemProfilePath}`);
  }
  if (marker.nixEnvPath !== nixEnvPath) {
    throw new Error(`Restore marker nix-env must be ${nixEnvPath}`);
  }
  const formula = requirePlainObject(marker.formula, "marker.formula");
  requireExactKeys(
    formula,
    [
      "name",
      "brewPath",
      "executablePath",
      "installedBefore",
      "versionBefore",
      "executableVersionBefore",
    ],
    "marker.formula",
  );
  if (formula.name !== e2eHomebrewFormula.name) {
    throw new Error("Restore marker formula must be hello");
  }
  const brewPath = validateBrewPath(formula.brewPath);
  if (formula.executablePath !== expectedFormulaExecutablePath(brewPath)) {
    throw new Error("Restore marker executable does not match Homebrew");
  }
  const installedBefore = requireBoolean(formula.installedBefore, "marker.formula.installedBefore");
  const versionBefore = formula.versionBefore ?? null;
  const executableVersionBefore = formula.executableVersionBefore ?? null;
  for (const [label, version] of [
    ["versionBefore", versionBefore],
    ["executableVersionBefore", executableVersionBefore],
  ]) {
    if (version !== null && (typeof version !== "string" || !version.trim())) {
      throw new TypeError(`marker.formula.${label} must be null or a non-empty string`);
    }
  }
  if (installedBefore || versionBefore !== null || executableVersionBefore !== null) {
    throw new Error("Restore marker requires hello to be absent before the run");
  }
  return {
    version: remoteRestoreMarkerVersion,
    runId,
    capturedAt,
    originalSystem,
    profilePath: systemProfilePath,
    nixEnvPath,
    formula: {
      name: e2eHomebrewFormula.name,
      brewPath,
      executablePath: formula.executablePath,
      installedBefore,
      versionBefore,
      executableVersionBefore,
    },
    cleanup: validateCleanupPointers(marker.cleanup, runId),
  };
}

export function serializeRemoteRestoreMarker(marker) {
  return `${JSON.stringify(validateRemoteRestoreMarker(marker), null, 2)}\n`;
}

export function remoteRestorePrivilegePreflightCommand(snapshot) {
  const validated = validateRemoteSystemSnapshot(snapshot, { requireFormulaAbsent: true });
  const rebuild = `${validated.activeSystem}/sw/bin/darwin-rebuild`;
  return [
    "set -euo pipefail",
    'gui_uid="$(/usr/bin/stat -f %u /dev/console)"',
    '[[ "$gui_uid" =~ ^[0-9]+$ ]]',
    `sudo -n -l ${shellQuote(validated.nixEnvPath)} --profile ${shellQuote(validated.profilePath)} --set ${shellQuote(validated.activeSystem)} >/dev/null`,
    `sudo -n -l -- /bin/launchctl asuser "$gui_uid" ${shellQuote(rebuild)} activate >/dev/null`,
  ].join("; ");
}

export function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

export function sshArgs(remoteCommand, env = process.env) {
  const dest = env.NIXMAC_E2E_REMOTE_SSH_DEST;
  if (!dest) return null;
  const args = ["-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes"];
  if (env.NIXMAC_E2E_SSH_KNOWN_HOSTS) {
    args.push("-o", `UserKnownHostsFile=${env.NIXMAC_E2E_SSH_KNOWN_HOSTS}`);
  }
  if (env.NIXMAC_E2E_SSH_KEY) args.push("-i", env.NIXMAC_E2E_SSH_KEY);
  args.push(dest, remoteCommand);
  return args;
}

export function scpArgs(localPath, remotePath, env = process.env) {
  const dest = env.NIXMAC_E2E_REMOTE_SSH_DEST;
  if (!dest) return null;
  const args = ["-r", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes"];
  if (env.NIXMAC_E2E_SSH_KNOWN_HOSTS) {
    args.push("-o", `UserKnownHostsFile=${env.NIXMAC_E2E_SSH_KNOWN_HOSTS}`);
  }
  if (env.NIXMAC_E2E_SSH_KEY) args.push("-i", env.NIXMAC_E2E_SSH_KEY);
  args.push(localPath, `${dest}:${remotePath}`);
  return args;
}

export function ssh(remoteCommand) {
  const args = sshArgs(remoteCommand);
  if (!args) return { ok: false, stdout: "", stderr: "NIXMAC_E2E_REMOTE_SSH_DEST is not set" };
  return tryRun("ssh", args);
}

export function scpToRemote(localPath, remotePath) {
  const args = scpArgs(localPath, remotePath);
  if (!args) return { ok: false, stdout: "", stderr: "NIXMAC_E2E_REMOTE_SSH_DEST is not set" };
  return tryRun("scp", args);
}

export function remoteAppPathFromEnv(env = process.env) {
  return env.NIXMAC_E2E_REMOTE_APP_PATH || "/Applications/nixmac.app";
}

export function remoteActivationPamSymlinkHang() {
  const result = ssh(
    "ps -axo pid=,ppid=,stat=,etime=,command= | awk '$2 != 1 && /ln -s \\/etc\\/static\\/pam\\.d\\/sudo_local \\/etc\\/pam\\.d\\/sudo_local/ && !/awk/ { print }'",
  );
  return (
    result.ok &&
    /ln -s .*\/etc\/static\/pam\.d\/sudo_local .*\/etc\/pam\.d\/sudo_local/.test(
      result.stdout || "",
    )
  );
}

export function captureRemoteMetadata() {
  const remoteAppPath = remoteAppPathFromEnv();
  const script = String.raw`
import hashlib
import json
import os
import plistlib
import re
import socket
import subprocess

def run(args):
    try:
        result = subprocess.run(args, text=True, capture_output=True, timeout=15)
        return {"ok": result.returncode == 0, "stdout": result.stdout.strip(), "stderr": result.stderr.strip()}
    except Exception as exc:
        return {"ok": False, "stdout": "", "stderr": str(exc)}

def first(*commands):
    for command in commands:
        result = run(command)
        if result["ok"] and result["stdout"]:
            return result["stdout"]
    return ""

def file_sha256(path):
    try:
        digest = hashlib.sha256()
        with open(path, "rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()
    except Exception:
        return ""

app_path = os.environ.get("APP_PATH", "")
plist_path = os.path.join(app_path, "Contents", "Info.plist")
info = {}
try:
    with open(plist_path, "rb") as handle:
        info = plistlib.load(handle)
except Exception:
    info = {}

exe_name = info.get("CFBundleExecutable") or "nixmac"
exe_path = os.path.join(app_path, "Contents", "MacOS", exe_name)
codesign = run(["codesign", "--verify", "--deep", "--strict", "--verbose=2", app_path])
codesign_detail = run(["codesign", "-dv", "--verbose=4", app_path])
codesign_text = "\n".join([codesign["stdout"], codesign["stderr"], codesign_detail["stdout"], codesign_detail["stderr"]])

pid = first(["pgrep", "-x", "nixmac"])
pid = pid.splitlines()[-1] if pid else ""
ps_env = run(["ps", "eww", "-p", pid]) if pid else {"ok": False, "stdout": "", "stderr": "nixmac process not found"}
env_text = ps_env["stdout"]
env_keys = sorted(set(re.findall(r"(?<![A-Za-z0-9_])([A-Z][A-Z0-9_]{1,80})=", env_text)))
openrouter_in_process = "OPENROUTER_API_KEY=" in env_text
launchd_key = run(["launchctl", "getenv", "OPENROUTER_API_KEY"])

print(json.dumps({
    "remoteMachine": {
        "hostname": socket.gethostname(),
        "localHostName": first(["scutil", "--get", "LocalHostName"]),
        "computerName": first(["scutil", "--get", "ComputerName"]),
        "consoleUser": first(["stat", "-f", "%Su", "/dev/console"]),
        "macosProductVersion": first(["sw_vers", "-productVersion"]),
        "macosBuildVersion": first(["sw_vers", "-buildVersion"]),
        "kernel": first(["uname", "-a"]),
        "architecture": first(["uname", "-m"]),
        "hardwareModel": first(["sysctl", "-n", "hw.model"]),
        "cpuBrand": first(["sysctl", "-n", "machdep.cpu.brand_string"]),
    },
    "remoteApp": {
        "path": app_path,
        "bundleIdentifier": info.get("CFBundleIdentifier", ""),
        "bundleName": info.get("CFBundleName", ""),
        "shortVersion": info.get("CFBundleShortVersionString", ""),
        "bundleVersion": info.get("CFBundleVersion", ""),
        "executable": exe_path,
        "executableSha256": file_sha256(exe_path),
        "codesignVerified": codesign["ok"],
        "teamIdentifier": (re.search(r"TeamIdentifier=(.*)", codesign_text) or ["", ""])[1].strip(),
        "designatedRequirement": (re.search(r"designated => (.*)", codesign_text) or ["", ""])[1].strip(),
    },
    "processEnvVerification": {
        "pid": pid,
        "processFound": bool(pid),
        "secretValuesRecorded": False,
        "processEnvKeys": env_keys,
        "openrouterApiKeyInProcess": "present-redacted" if openrouter_in_process else "absent-or-not-visible",
        "openrouterApiKeyInGuiLaunchd": "present-redacted" if launchd_key["stdout"] else "absent",
        "note": "The launched nixmac process environment is the source of truth for this run. launchctl getenv is diagnostic only and may be absent when the app is launched with an inline environment. Only environment variable names and presence checks are recorded; secret values are never written to the report.",
    }
}, sort_keys=True))
`;
  const result = ssh(`APP_PATH=${shellQuote(remoteAppPath)} python3 -c ${shellQuote(script)}`);
  if (!result.ok) {
    return {
      metadata: null,
      error: result.stderr || result.stdout || "Remote metadata command failed.",
    };
  }
  try {
    return {
      metadata: JSON.parse(result.stdout),
      error: "",
    };
  } catch (error) {
    return {
      metadata: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function decodeBase64(value = "") {
  if (!value) return "";
  return Buffer.from(value, "base64").toString("utf8").trim();
}

function parseKeyValueLines(stdout = "") {
  const parsed = {};
  for (const line of stdout.split("\n")) {
    const index = line.indexOf("=");
    if (index === -1) continue;
    parsed[line.slice(0, index)] = line.slice(index + 1);
  }
  return parsed;
}

export function remoteConfigDirFromSettings() {
  if (process.env.NIXMAC_E2E_REMOTE_CONFIG_DIR) return process.env.NIXMAC_E2E_REMOTE_CONFIG_DIR;
  const script = [
    "import json, os",
    'p=os.path.join(os.environ["HOME"], "Library/Application Support/com.darkmatter.nixmac", "settings.json")',
    'with open(p, encoding="utf-8") as f: settings=json.load(f)',
    'print(settings.get("configDir", ""))',
  ].join("; ");
  const result = ssh(`/usr/bin/python3 -c ${shellQuote(script)}`);
  return result.ok ? result.stdout.trim() : "";
}

export function remoteGitSnapshot(
  configDir,
  baselineHead = "",
  targetFormula = e2eHomebrewFormula.name,
) {
  if (!configDir) return { ok: false, error: "No remote configDir available." };
  if (targetFormula !== e2eHomebrewFormula.name) {
    return { ok: false, error: "Remote git proof target must be the fixed hello formula." };
  }
  const command = [
    `CONFIG_DIR=${shellQuote(configDir)}`,
    `BASELINE=${shellQuote(baselineHead)}`,
    'cd "$CONFIG_DIR"',
    'printf "HEAD="; git rev-parse HEAD',
    'printf "STATUS_B64="; git status --porcelain=v1 | base64 | tr -d "\\n"; printf "\\n"',
    'printf "DIFF_B64="; git diff --name-only | base64 | tr -d "\\n"; printf "\\n"',
    'if [ -n "$BASELINE" ]; then printf "BASELINE_DIFF_B64="; git diff --name-only "$BASELINE" HEAD | base64 | tr -d "\\n"; printf "\\n"; fi',
    `if git grep -q -F ${shellQuote(`"${targetFormula}"`)} HEAD -- . >/dev/null 2>&1; then echo "CONTAINS_TARGET_FORMULA=true"; else echo "CONTAINS_TARGET_FORMULA=false"; fi`,
  ].join("; ");
  const result = ssh(command);
  if (!result.ok)
    return {
      ok: false,
      error: result.stderr || result.stdout || result.error || "Remote git snapshot failed.",
    };
  const parsed = parseKeyValueLines(result.stdout);
  return {
    ok: true,
    configDir,
    head: parsed.HEAD || "",
    statusShort: decodeBase64(parsed.STATUS_B64),
    diffNameOnly: decodeBase64(parsed.DIFF_B64),
    baselineDiffNameOnly: decodeBase64(parsed.BASELINE_DIFF_B64),
    targetFormula,
    containsTargetFormula: parsed.CONTAINS_TARGET_FORMULA === "true",
  };
}

export function meaningfulBaselineDiff(snapshot) {
  return (
    String(snapshot?.baselineDiffNameOnly || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      // The fixed Homebrew E2E prompt proves config cleanup through the package
      // file and absence of the fixed target formula. Nix may refresh these generated build artifacts
      // while leaving user-visible Homebrew config restored.
      .filter((line) => line !== "result")
      .filter((line) => line !== "flake.lock")
      .join("\n")
  );
}
