#!/usr/bin/env node

import dns from "node:dns/promises";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const DEFAULT_SSH_PORT = 22;
const appServerComputerUseProbe = fs.readFileSync(
  new URL("./app-server-computer-use-probe.mjs", import.meta.url),
  "utf8",
);

function usage() {
  return [
    "Usage:",
    "  node tests/e2e/computer-use/check-remote.mjs --host <fqdn-or-ip> [options]",
    "",
    "Options:",
    "  --user <user>                       SSH user for remote identity checks",
    "  --key <path>                        SSH private key path",
    "  --known-hosts <path>                Known hosts file for strict SSH host verification",
    "  --json <path>                       Write structured readiness evidence JSON",
    "  --port <port>                       SSH port, default 22",
    "  --expected-local-hostname <name>    Require scutil LocalHostName/hostname to match",
    "  --check-app-path <path>             Require a remote app path to exist",
    "  --check-codex-binary                Require Codex app-server binary on remote Mac",
    "  --check-computer-use-plugin         Require a live authorized Computer Use app-server probe",
    "  --check-recording-tools             Require ffmpeg, ffprobe, and Terminal on remote Mac",
    "  --require-app-server <port>         Require remote 127.0.0.1:<port> to be listening",
  ].join("\n");
}

function parseArgs(argv) {
  const out = { port: DEFAULT_SSH_PORT };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--check-codex-binary") {
      out.checkCodexBinary = true;
      continue;
    }
    if (arg === "--check-recording-tools") {
      out.checkRecordingTools = true;
      continue;
    }
    if (arg === "--check-computer-use-plugin") {
      out.checkComputerUsePlugin = true;
      continue;
    }
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) throw new Error(`Missing value for ${arg}`);
    i += 1;
    if (arg === "--host") out.host = next;
    else if (arg === "--user") out.user = next;
    else if (arg === "--key") out.key = expandHome(next);
    else if (arg === "--known-hosts") out.knownHosts = expandHome(next);
    else if (arg === "--json") out.jsonPath = expandHome(next);
    else if (arg === "--port") out.port = Number(next);
    else if (arg === "--expected-local-hostname") out.expectedLocalHostname = next;
    else if (arg === "--check-app-path") out.checkAppPath = next;
    else if (arg === "--require-app-server") out.requireAppServer = Number(next);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!out.host) throw new Error("Missing required --host");
  if (!Number.isInteger(out.port) || out.port <= 0) throw new Error(`Invalid --port: ${out.port}`);
  if (
    Object.hasOwn(out, "requireAppServer") &&
    (!Number.isInteger(out.requireAppServer) || out.requireAppServer <= 0)
  ) {
    throw new Error(`Invalid --require-app-server: ${out.requireAppServer}`);
  }
  const sshChecksRequested = Boolean(
    out.expectedLocalHostname ||
    out.checkCodexBinary ||
    out.checkComputerUsePlugin ||
    out.checkRecordingTools ||
    out.checkAppPath ||
    out.requireAppServer ||
    out.key ||
    out.knownHosts,
  );
  if (sshChecksRequested && !out.user) {
    throw new Error("SSH-dependent checks require --user");
  }
  return out;
}

function expandHome(value) {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

function isQualifiedHost(host) {
  return net.isIP(host) || host.includes(".");
}

async function checkDns(host) {
  if (net.isIP(host)) return [{ address: host, family: net.isIP(host) }];
  return dns.lookup(host, { all: true });
}

async function checkTcp(host, port) {
  await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Timed out connecting to ${host}:${port}`));
    }, 8000);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.end();
      resolve();
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function sshArgs(options, command) {
  const args = [
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=8",
    "-o",
    "StrictHostKeyChecking=yes",
    "-p",
    String(options.port),
  ];
  if (options.knownHosts) args.push("-o", `UserKnownHostsFile=${options.knownHosts}`);
  if (options.key) args.push("-i", options.key);
  args.push(`${options.user}@${options.host}`, command);
  return args;
}

function runSsh(options, command) {
  if (!options.user) throw new Error("SSH checks require --user");
  if (options.key && !fs.existsSync(options.key))
    throw new Error(`SSH key does not exist: ${options.key}`);
  if (options.knownHosts && !fs.existsSync(options.knownHosts))
    throw new Error(`Known hosts file does not exist: ${options.knownHosts}`);
  const result = spawnSync("ssh", sshArgs(options, command), {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0) {
    const details = [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join("\n");
    throw new Error(`SSH command failed${details ? `:\n${details}` : ""}`);
  }
  return result.stdout.trim();
}

function parseKeyValues(output) {
  const values = {};
  for (const line of output.split("\n")) {
    const index = line.indexOf("=");
    if (index === -1) continue;
    values[line.slice(0, index)] = line.slice(index + 1);
  }
  return values;
}

function remoteShellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

const codexBinaryShell = [
  'export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"',
  "if test -x /opt/homebrew/bin/codex; then CODEX_BIN=/opt/homebrew/bin/codex",
  "elif test -x /Applications/Codex.app/Contents/Resources/codex; then CODEX_BIN=/Applications/Codex.app/Contents/Resources/codex",
  'else echo "Codex CLI not found" >&2; exit 1',
  "fi",
].join("; ");

const computerUseProbePython = `
import json
import subprocess
import sys

message = {
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
        "protocolVersion": "2025-03-26",
        "capabilities": {},
        "clientInfo": {"name": "nixmac-e2e-preflight", "version": "1.0"},
    },
}
result = subprocess.run(
    [sys.argv[1], "mcp"],
    input=(json.dumps(message) + "\\n").encode(),
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    timeout=12,
)
if result.stderr:
    sys.stderr.buffer.write(result.stderr)
if result.returncode != 0:
    raise SystemExit(result.returncode)
responses = [
    json.loads(line)
    for line in result.stdout.decode().splitlines()
    if line.strip().startswith("{")
]
if not any(response.get("id") == 1 and "result" in response for response in responses):
    raise SystemExit("Computer Use MCP initialize response missing")
`;

function computerUsePluginShell() {
  const probeBase64 = Buffer.from(appServerComputerUseProbe).toString("base64");
  return [
    codexBinaryShell,
    'PLUGIN_LIST="$("$CODEX_BIN" plugin list)"',
    'printf "%s\\n" "$PLUGIN_LIST" | grep -Eq "^computer-use@openai-bundled[[:space:]]+installed, enabled[[:space:]]"',
    'COMPUTER_USE_VERSION="$(printf "%s\\n" "$PLUGIN_LIST" | awk \'$1 == "computer-use@openai-bundled" && $2 == "installed," && $3 == "enabled" { print $4; exit }\')"',
    'test -n "$COMPUTER_USE_VERSION"',
    'PLUGIN_ROOT="$HOME/.codex/plugins/cache/openai-bundled/computer-use/$COMPUTER_USE_VERSION"',
    'PLUGIN_APP="$PLUGIN_ROOT/Codex Computer Use.app"',
    'CLIENT="$PLUGIN_APP/Contents/SharedSupport/SkyComputerUseClient.app/Contents/MacOS/SkyComputerUseClient"',
    'test -x "$CLIENT"',
    'spctl -a -vv "$PLUGIN_APP" 2>&1 | grep -q "accepted"',
    `/usr/bin/python3 -c ${remoteShellQuote(computerUseProbePython)} "$CLIENT"`,
    'RUNTIME_APP="$HOME/.codex/computer-use/Codex Computer Use.app"',
    'RUNTIME_SERVICE="$RUNTIME_APP/Contents/MacOS/SkyComputerUseService"',
    'INSTALLER="$RUNTIME_APP/Contents/SharedSupport/Codex Computer Use Installer.app/Contents/MacOS/Codex Computer Use Installer"',
    'test -x "$RUNTIME_SERVICE"',
    'test -x "$INSTALLER"',
    'spctl -a -vv "$RUNTIME_APP" 2>&1 | grep -q "accepted"',
    'cmp -s "$PLUGIN_APP/Contents/MacOS/SkyComputerUseService" "$RUNTIME_SERVICE"',
    '"$INSTALLER" status 2>&1 | grep -q "OK: installed"',
    'pgrep -x SkyComputerUseService >/dev/null || open "$RUNTIME_APP"',
    "for _ in $(seq 1 20); do pgrep -x SkyComputerUseService >/dev/null && break; sleep 1; done",
    "pgrep -x SkyComputerUseService >/dev/null",
    'TCC_DB="$HOME/Library/Application Support/com.apple.TCC/TCC.db"',
    'test "$(sqlite3 "$TCC_DB" "SELECT auth_value FROM access WHERE service = \'kTCCServiceAppleEvents\' AND client = \'com.apple.Terminal\' AND indirect_object_identifier = \'com.openai.sky.CUAService\' ORDER BY last_modified DESC LIMIT 1;")" = "2"',
    "PREFLIGHT_PORT=18789",
    'PREFLIGHT_TAG="nixmac-cua-preflight-$$"',
    'PREFLIGHT_LAUNCHER="/tmp/${PREFLIGHT_TAG}-app-server.sh"',
    'PREFLIGHT_PROBE="/tmp/${PREFLIGHT_TAG}-probe.mjs"',
    'PREFLIGHT_LOG="/tmp/${PREFLIGHT_TAG}-app-server.log"',
    'cleanup_computer_use_preflight() { pkill -f "[c]odex app-server .*--listen ws://127.0.0.1:${PREFLIGHT_PORT}" >/dev/null 2>&1 || true; rm -f "$PREFLIGHT_LAUNCHER" "$PREFLIGHT_PROBE" "$PREFLIGHT_LOG"; }',
    "trap cleanup_computer_use_preflight EXIT INT TERM",
    'pkill -f "[c]odex app-server .*--listen ws://127.0.0.1:${PREFLIGHT_PORT}" >/dev/null 2>&1 || true',
    `printf '%s' ${remoteShellQuote(probeBase64)} | /usr/bin/base64 --decode > "$PREFLIGHT_PROBE"`,
    'printf \'#!/bin/bash\\nexport PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"\\n%q app-server -c %q --listen ws://127.0.0.1:%s >%q 2>&1\\nexit 0\\n\' "$CODEX_BIN" \'service_tier="fast"\' "$PREFLIGHT_PORT" "$PREFLIGHT_LOG" > "$PREFLIGHT_LAUNCHER"',
    'chmod 700 "$PREFLIGHT_LAUNCHER"',
    "osascript -e 'on run argv' -e 'tell application \"Terminal\" to do script \"/bin/bash \" & quoted form of item 1 of argv' -e 'end run' \"$PREFLIGHT_LAUNCHER\" >/dev/null",
    "app_server_ready=false",
    'for _ in $(seq 1 30); do if curl --fail --silent "http://127.0.0.1:${PREFLIGHT_PORT}/readyz" >/dev/null; then app_server_ready=true; break; fi; sleep 1; done',
    'if test "$app_server_ready" != "true"; then cat "$PREFLIGHT_LOG" >&2; exit 1; fi',
    'export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"',
    'node "$PREFLIGHT_PROBE" "ws://127.0.0.1:${PREFLIGHT_PORT}"',
    "cleanup_computer_use_preflight",
    "trap - EXIT INT TERM",
    'printf "codex_bin=%s\\n" "$CODEX_BIN"',
    'printf "codex_version=%s\\n" "$("$CODEX_BIN" --version)"',
    'printf "computer_use_version=%s\\n" "$(basename "$PLUGIN_ROOT")"',
  ].join("; ");
}

function readinessReport(options, startedAt, checks, passes, failures, remoteIdentity) {
  return {
    ok: failures.length === 0,
    checkedAt: startedAt,
    host: options.host,
    port: options.port,
    user: options.user || null,
    expectedLocalHostname: options.expectedLocalHostname || null,
    checks,
    passes: passes.map((message) => ({ message })),
    failures: failures.map((message) => ({ message })),
    remoteIdentity,
  };
}

function writeReadinessJson(options, report) {
  if (!options.jsonPath) return;
  fs.mkdirSync(path.dirname(options.jsonPath), { recursive: true });
  fs.writeFileSync(options.jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error(usage());
    process.exit(2);
  }

  const failures = [];
  const passes = [];
  const checks = [];
  const startedAt = new Date().toISOString();
  let remoteIdentity = null;

  const pass = (name, message, detail = {}) => {
    passes.push(message);
    checks.push({ name, status: "pass", message, ...detail });
  };
  const fail = (name, message, detail = {}) => {
    failures.push(message);
    checks.push({ name, status: "fail", message, ...detail });
  };

  try {
    if (!isQualifiedHost(options.host)) {
      fail(
        "host-qualified",
        `Remote host "${options.host}" is an unqualified local hostname. Use a MacinCloud FQDN such as dxu97120.macincloud.com or a stable IP address.`,
      );
    } else {
      pass("host-qualified", `Remote host ${options.host} is qualified`);
    }

    try {
      const addresses = await checkDns(options.host);
      pass(
        "dns",
        `DNS resolved ${options.host} -> ${addresses.map((entry) => entry.address).join(", ")}`,
        { addresses },
      );
    } catch (error) {
      fail("dns", `DNS lookup failed for ${options.host}: ${error.message}`);
    }

    try {
      await checkTcp(options.host, options.port);
      pass("tcp", `TCP ${options.host}:${options.port} is reachable`);
    } catch (error) {
      fail("tcp", `TCP ${options.host}:${options.port} is not reachable: ${error.message}`);
    }

    if (options.user && failures.length === 0) {
      try {
        const identityOutput = runSsh(
          options,
          [
            "printf 'hostname='; hostname",
            "printf '\\nlocal_hostname='; scutil --get LocalHostName 2>/dev/null || true",
            "printf '\\nwhoami='; whoami",
            "printf '\\nmacos='; sw_vers -productVersion",
          ].join("; "),
        );
        const identity = parseKeyValues(identityOutput);
        const remoteName = identity.local_hostname || identity.hostname;
        remoteIdentity = {
          hostname: identity.hostname || null,
          localHostname: identity.local_hostname || null,
          whoami: identity.whoami || null,
          macos: identity.macos || null,
        };
        pass(
          "ssh-identity",
          `SSH identity: ${identity.whoami}@${identity.hostname}, LocalHostName=${identity.local_hostname}, macOS=${identity.macos}`,
          {
            remoteIdentity,
          },
        );
        if (options.expectedLocalHostname && remoteName !== options.expectedLocalHostname) {
          fail(
            "remote-identity",
            `Remote identity mismatch: expected LocalHostName/hostname ${options.expectedLocalHostname}, got ${remoteName || "unknown"}`,
          );
        } else if (options.expectedLocalHostname) {
          pass(
            "remote-identity",
            `Remote identity matched expected LocalHostName/hostname ${options.expectedLocalHostname}`,
          );
        }
      } catch (error) {
        fail("ssh-identity", error.message);
      }
    }

    if (options.user && failures.length === 0 && options.checkCodexBinary) {
      try {
        const output = runSsh(
          options,
          `${codexBinaryShell}; printf "codex_bin=%s\\n" "$CODEX_BIN"; printf "codex_version=%s\\n" "$("$CODEX_BIN" --version)"`,
        );
        const values = parseKeyValues(output);
        pass(
          "codex-binary",
          `Codex app-server binary exists: ${values.codex_bin} (${values.codex_version})`,
          { codexBinary: values.codex_bin, codexVersion: values.codex_version },
        );
      } catch (error) {
        fail("codex-binary", `Codex app-server binary check failed: ${error.message}`);
      }
    }

    if (options.user && failures.length === 0 && options.checkComputerUsePlugin) {
      try {
        const output = runSsh(options, computerUsePluginShell());
        const values = parseKeyValues(output);
        pass(
          "computer-use-plugin",
          `Computer Use ${values.computer_use_version} is notarized, installed, authorized, and returned a live app inventory through Codex app-server`,
          {
            codexBinary: values.codex_bin,
            codexVersion: values.codex_version,
            computerUseVersion: values.computer_use_version,
          },
        );
      } catch (error) {
        fail(
          "computer-use-plugin",
          `Computer Use runtime/app-server probe failed: ${error.message}`,
        );
      }
    }

    if (options.user && failures.length === 0 && options.checkRecordingTools) {
      try {
        runSsh(
          options,
          "export PATH=/opt/homebrew/bin:$PATH; command -v ffmpeg >/dev/null && command -v ffprobe >/dev/null && open -Ra Terminal >/dev/null",
        );
        pass("recording-tools", "ffmpeg, ffprobe, and Terminal are available");
      } catch (error) {
        fail(
          "recording-tools",
          `Continuous screen recording dependency check failed: ${error.message}`,
        );
      }
    }

    if (options.user && failures.length === 0 && options.checkAppPath) {
      try {
        runSsh(options, `test -e ${remoteShellQuote(options.checkAppPath)}`);
        pass("remote-app-path", `Remote app path exists: ${options.checkAppPath}`);
      } catch (error) {
        fail(
          "remote-app-path",
          `Remote app path check failed for ${options.checkAppPath}: ${error.message}`,
        );
      }
    }

    if (options.user && failures.length === 0 && options.requireAppServer) {
      try {
        runSsh(
          options,
          `nc -z 127.0.0.1 ${options.requireAppServer} >/dev/null 2>&1 || lsof -nP -iTCP:${options.requireAppServer} -sTCP:LISTEN >/dev/null 2>&1`,
        );
        pass(
          "app-server",
          `Remote app-server is listening on 127.0.0.1:${options.requireAppServer}`,
        );
      } catch (error) {
        fail(
          "app-server",
          `Remote app-server is not listening on 127.0.0.1:${options.requireAppServer}: ${error.message}`,
        );
      }
    }
  } catch (error) {
    fail(
      "unexpected",
      `Unexpected remote readiness error: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    const report = readinessReport(options, startedAt, checks, passes, failures, remoteIdentity);
    try {
      writeReadinessJson(options, report);
    } catch (error) {
      failures.push(
        `Could not write readiness JSON ${options.jsonPath}: ${error instanceof Error ? error.message : String(error)}`,
      );
      console.error(`FAIL ${failures.at(-1)}`);
    }
  }

  for (const line of passes) console.log(`PASS ${line}`);
  for (const line of failures) console.error(`FAIL ${line}`);

  if (failures.length > 0) process.exit(1);
}

await main();
