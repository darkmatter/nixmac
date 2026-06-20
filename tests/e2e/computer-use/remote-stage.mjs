import { tryRun } from './process-utils.mjs';

export function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

export function sshArgs(remoteCommand, env = process.env) {
  const dest = env.NIXMAC_E2E_REMOTE_SSH_DEST;
  if (!dest) return null;
  const args = ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes'];
  if (env.NIXMAC_E2E_SSH_KNOWN_HOSTS) {
    args.push('-o', `UserKnownHostsFile=${env.NIXMAC_E2E_SSH_KNOWN_HOSTS}`);
  }
  if (env.NIXMAC_E2E_SSH_KEY) args.push('-i', env.NIXMAC_E2E_SSH_KEY);
  args.push(dest, remoteCommand);
  return args;
}

export function scpArgs(localPath, remotePath, env = process.env) {
  const dest = env.NIXMAC_E2E_REMOTE_SSH_DEST;
  if (!dest) return null;
  const args = ['-r', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes'];
  if (env.NIXMAC_E2E_SSH_KNOWN_HOSTS) {
    args.push('-o', `UserKnownHostsFile=${env.NIXMAC_E2E_SSH_KNOWN_HOSTS}`);
  }
  if (env.NIXMAC_E2E_SSH_KEY) args.push('-i', env.NIXMAC_E2E_SSH_KEY);
  args.push(localPath, `${dest}:${remotePath}`);
  return args;
}

export function ssh(remoteCommand) {
  const args = sshArgs(remoteCommand);
  if (!args) return { ok: false, stdout: '', stderr: 'NIXMAC_E2E_REMOTE_SSH_DEST is not set' };
  return tryRun('ssh', args);
}

export function scpToRemote(localPath, remotePath) {
  const args = scpArgs(localPath, remotePath);
  if (!args) return { ok: false, stdout: '', stderr: 'NIXMAC_E2E_REMOTE_SSH_DEST is not set' };
  return tryRun('scp', args);
}

export function remoteAppPathFromEnv(env = process.env) {
  return env.NIXMAC_E2E_REMOTE_APP_PATH || '/Applications/nixmac.app';
}

export function remoteActivationPamSymlinkHang() {
  const result = ssh(
    "ps -axo pid=,ppid=,stat=,etime=,command= | awk '$2 != 1 && /ln -s \\/etc\\/static\\/pam\\.d\\/sudo_local \\/etc\\/pam\\.d\\/sudo_local/ && !/awk/ { print }'",
  );
  return result.ok && /ln -s .*\/etc\/static\/pam\.d\/sudo_local .*\/etc\/pam\.d\/sudo_local/.test(result.stdout || '');
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
      error: result.stderr || result.stdout || 'Remote metadata command failed.',
    };
  }
  try {
    return {
      metadata: JSON.parse(result.stdout),
      error: '',
    };
  } catch (error) {
    return {
      metadata: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function decodeBase64(value = '') {
  if (!value) return '';
  return Buffer.from(value, 'base64').toString('utf8').trim();
}

function parseKeyValueLines(stdout = '') {
  const parsed = {};
  for (const line of stdout.split('\n')) {
    const index = line.indexOf('=');
    if (index === -1) continue;
    parsed[line.slice(0, index)] = line.slice(index + 1);
  }
  return parsed;
}

export function remoteConfigDirFromSettings() {
  if (process.env.NIXMAC_E2E_REMOTE_CONFIG_DIR) return process.env.NIXMAC_E2E_REMOTE_CONFIG_DIR;
  const script = [
    'import json, os',
    'p=os.path.join(os.environ["HOME"], "Library/Application Support/com.darkmatter.nixmac", "settings.json")',
    'with open(p, encoding="utf-8") as f: settings=json.load(f)',
    'print(settings.get("configDir", ""))',
  ].join('; ');
  const result = ssh(`/usr/bin/python3 -c ${shellQuote(script)}`);
  return result.ok ? result.stdout.trim() : '';
}

export function remoteGitSnapshot(configDir, baselineHead = '') {
  if (!configDir) return { ok: false, error: 'No remote configDir available.' };
  const command = [
    `CONFIG_DIR=${shellQuote(configDir)}`,
    `BASELINE=${shellQuote(baselineHead)}`,
    'cd "$CONFIG_DIR"',
    'printf "HEAD="; git rev-parse HEAD',
    'printf "STATUS_B64="; git status --porcelain=v1 | base64 | tr -d "\\n"; printf "\\n"',
    'printf "DIFF_B64="; git diff --name-only | base64 | tr -d "\\n"; printf "\\n"',
    'if [ -n "$BASELINE" ]; then printf "BASELINE_DIFF_B64="; git diff --name-only "$BASELINE" HEAD | base64 | tr -d "\\n"; printf "\\n"; fi',
    'if git grep -q -E "(^|[^A-Za-z])bat([^A-Za-z]|$)" HEAD -- . >/dev/null 2>&1; then echo "CONTAINS_BAT=true"; else echo "CONTAINS_BAT=false"; fi',
  ].join('; ');
  const result = ssh(command);
  if (!result.ok) return { ok: false, error: result.stderr || result.stdout || result.error || 'Remote git snapshot failed.' };
  const parsed = parseKeyValueLines(result.stdout);
  return {
    ok: true,
    configDir,
    head: parsed.HEAD || '',
    statusShort: decodeBase64(parsed.STATUS_B64),
    diffNameOnly: decodeBase64(parsed.DIFF_B64),
    baselineDiffNameOnly: decodeBase64(parsed.BASELINE_DIFF_B64),
    containsBat: parsed.CONTAINS_BAT === 'true',
  };
}

export function meaningfulBaselineDiff(snapshot) {
  return String(snapshot?.baselineDiffNameOnly || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    // The fixed Homebrew E2E prompt proves config cleanup through the package
    // file and absence of bat. Nix may refresh these generated build artifacts
    // while leaving user-visible Homebrew config restored.
    .filter((line) => line !== 'result')
    .filter((line) => line !== 'flake.lock')
    .join('\n');
}
