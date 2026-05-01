#!/usr/bin/env node

import dns from 'node:dns/promises';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const DEFAULT_SSH_PORT = 22;

function usage() {
  return [
    'Usage:',
    '  node tools/computer-use-e2e/check-remote.mjs --host <fqdn-or-ip> [options]',
    '',
    'Options:',
    '  --user <user>                       SSH user for remote identity checks',
    '  --key <path>                        SSH private key path',
    '  --known-hosts <path>                Known hosts file for strict SSH host verification',
    '  --port <port>                       SSH port, default 22',
    '  --expected-local-hostname <name>    Require scutil LocalHostName/hostname to match',
    '  --check-app-path <path>             Require a remote app path to exist',
    '  --check-codex-binary                Require Codex app-server binary on remote Mac',
    '  --require-app-server <port>         Require remote 127.0.0.1:<port> to be listening',
  ].join('\n');
}

function parseArgs(argv) {
  const out = { port: DEFAULT_SSH_PORT };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--check-codex-binary') {
      out.checkCodexBinary = true;
      continue;
    }
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) throw new Error(`Missing value for ${arg}`);
    i += 1;
    if (arg === '--host') out.host = next;
    else if (arg === '--user') out.user = next;
    else if (arg === '--key') out.key = expandHome(next);
    else if (arg === '--known-hosts') out.knownHosts = expandHome(next);
    else if (arg === '--port') out.port = Number(next);
    else if (arg === '--expected-local-hostname') out.expectedLocalHostname = next;
    else if (arg === '--check-app-path') out.checkAppPath = next;
    else if (arg === '--require-app-server') out.requireAppServer = Number(next);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!out.host) throw new Error('Missing required --host');
  if (!Number.isInteger(out.port) || out.port <= 0) throw new Error(`Invalid --port: ${out.port}`);
  if (Object.hasOwn(out, 'requireAppServer') && (!Number.isInteger(out.requireAppServer) || out.requireAppServer <= 0)) {
    throw new Error(`Invalid --require-app-server: ${out.requireAppServer}`);
  }
  return out;
}

function expandHome(value) {
  if (value === '~') return os.homedir();
  if (value.startsWith('~/')) return path.join(os.homedir(), value.slice(2));
  return value;
}

function isQualifiedHost(host) {
  return net.isIP(host) || host.includes('.');
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
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.end();
      resolve();
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function sshArgs(options, command) {
  const args = [
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=8',
    '-o', 'StrictHostKeyChecking=yes',
    '-p', String(options.port),
  ];
  if (options.knownHosts) args.push('-o', `UserKnownHostsFile=${options.knownHosts}`);
  if (options.key) args.push('-i', options.key);
  args.push(`${options.user}@${options.host}`, command);
  return args;
}

function runSsh(options, command) {
  if (!options.user) throw new Error('SSH checks require --user');
  if (options.key && !fs.existsSync(options.key)) throw new Error(`SSH key does not exist: ${options.key}`);
  if (options.knownHosts && !fs.existsSync(options.knownHosts)) throw new Error(`Known hosts file does not exist: ${options.knownHosts}`);
  const result = spawnSync('ssh', sshArgs(options, command), {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0) {
    const details = [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join('\n');
    throw new Error(`SSH command failed${details ? `:\n${details}` : ''}`);
  }
  return result.stdout.trim();
}

function parseKeyValues(output) {
  const values = {};
  for (const line of output.split('\n')) {
    const index = line.indexOf('=');
    if (index === -1) continue;
    values[line.slice(0, index)] = line.slice(index + 1);
  }
  return values;
}

function remoteShellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
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

  if (!isQualifiedHost(options.host)) {
    failures.push(
      `Remote host "${options.host}" is an unqualified local hostname. Use a MacinCloud FQDN such as dxu97120.macincloud.com or a stable IP address.`
    );
  }

  try {
    const addresses = await checkDns(options.host);
    passes.push(`DNS resolved ${options.host} -> ${addresses.map((entry) => entry.address).join(', ')}`);
  } catch (error) {
    failures.push(`DNS lookup failed for ${options.host}: ${error.message}`);
  }

  try {
    await checkTcp(options.host, options.port);
    passes.push(`TCP ${options.host}:${options.port} is reachable`);
  } catch (error) {
    failures.push(`TCP ${options.host}:${options.port} is not reachable: ${error.message}`);
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
        ].join('; ')
      );
      const identity = parseKeyValues(identityOutput);
      const remoteName = identity.local_hostname || identity.hostname;
      passes.push(`SSH identity: ${identity.whoami}@${identity.hostname}, LocalHostName=${identity.local_hostname}, macOS=${identity.macos}`);
      if (options.expectedLocalHostname && remoteName !== options.expectedLocalHostname) {
        failures.push(
          `Remote identity mismatch: expected LocalHostName/hostname ${options.expectedLocalHostname}, got ${remoteName || 'unknown'}`
        );
      }
    } catch (error) {
      failures.push(error.message);
    }
  }

  if (options.user && failures.length === 0 && options.checkCodexBinary) {
    try {
      runSsh(options, 'test -x /Applications/Codex.app/Contents/Resources/codex');
      passes.push('Codex app-server binary exists');
    } catch (error) {
      failures.push(`Codex app-server binary check failed: ${error.message}`);
    }
  }

  if (options.user && failures.length === 0 && options.checkAppPath) {
    try {
      runSsh(options, `test -e ${remoteShellQuote(options.checkAppPath)}`);
      passes.push(`Remote app path exists: ${options.checkAppPath}`);
    } catch (error) {
      failures.push(`Remote app path check failed for ${options.checkAppPath}: ${error.message}`);
    }
  }

  if (options.user && failures.length === 0 && options.requireAppServer) {
    try {
      runSsh(
        options,
        `nc -z 127.0.0.1 ${options.requireAppServer} >/dev/null 2>&1 || lsof -nP -iTCP:${options.requireAppServer} -sTCP:LISTEN >/dev/null 2>&1`
      );
      passes.push(`Remote app-server is listening on 127.0.0.1:${options.requireAppServer}`);
    } catch (error) {
      failures.push(`Remote app-server is not listening on 127.0.0.1:${options.requireAppServer}: ${error.message}`);
    }
  }

  for (const line of passes) console.log(`PASS ${line}`);
  for (const line of failures) console.error(`FAIL ${line}`);

  if (failures.length > 0) process.exit(1);
}

await main();
