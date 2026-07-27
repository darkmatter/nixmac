#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  createPublicKey,
  createPrivateKey,
  createHash,
  sign as signPayload,
  verify as verifySignature,
} from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  lifecycleAttestationBlobDigest,
  lifecycleAttestationPath,
  lifecycleAttestationSigningPayload,
  runtimeObservationSigningPayload,
  validateLifecycleRequest,
  validateProviderContract,
  verifyImageAdmission,
  verifyRuntimeObservation,
} from "./cilicon-e2e-contract.mjs";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const FULL_SHA = /^[0-9a-f]{40}$/;
const MAX_JSON_BYTES = 1024 * 1024;

function fail(message) {
  throw new Error(message);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function exactKeys(value, expected, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${field} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(`${field} keys must be exactly: ${wanted.join(", ")}`);
  }
}

function nonempty(value, field, pattern) {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value.includes("\0") ||
    (pattern && !pattern.test(value))
  ) {
    fail(`${field} is invalid`);
  }
  return value;
}

function positiveInteger(value, field) {
  if (!Number.isSafeInteger(value) || value <= 0) fail(`${field} must be a positive integer`);
  return value;
}

function absoluteNormalized(value, field) {
  nonempty(value, field);
  if (!path.isAbsolute(value) || path.normalize(value) !== value || value === "/") {
    fail(`${field} must be a normalized non-root absolute path`);
  }
  return value;
}

function canonicalTimestamp(value, field) {
  nonempty(value, field);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    fail(`${field} must be a canonical ISO timestamp`);
  }
  return value;
}

async function readJson(file, field) {
  const body = await readFile(file, "utf8");
  if (Buffer.byteLength(body) > MAX_JSON_BYTES) fail(`${field} exceeds one MiB`);
  try {
    return JSON.parse(body);
  } catch {
    fail(`${field} is not valid JSON`);
  }
}

async function atomicWrite(file, body, mode = 0o600) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.tmp-${process.pid}`;
  await writeFile(temporary, body, { encoding: "utf8", mode, flag: "wx" });
  await rename(temporary, file);
}

async function writeQuarantineSentinel(file, value) {
  const helper = process.env.NIXMAC_E2E_QUARANTINE_HELPER;
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  if (!helper) {
    await atomicWrite(file, serialized);
    return;
  }
  if (helper !== "/usr/local/libexec/nixmac-e2e-mark-quarantine") {
    fail("quarantine helper path is not the installed root-owned helper");
  }
  await new Promise((resolve, reject) => {
    const child = spawn("/usr/bin/sudo", ["-n", helper], {
      stdio: ["pipe", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      if (stderr.length > 64 * 1024) child.kill("SIGKILL");
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0 && !signal) resolve();
      else reject(new Error(`quarantine helper failed (${code ?? signal}): ${stderr.trim()}`));
    });
    child.stdin.end(serialized);
  });
}

function parseArgs(argv, required) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || typeof value !== "string" || value === "") {
      fail("arguments must be non-empty --name value pairs");
    }
    const key = flag.slice(2);
    if (!required.includes(key) || Object.hasOwn(values, key)) fail(`unexpected ${flag}`);
    values[key] = value;
  }
  for (const key of required) {
    if (!Object.hasOwn(values, key)) fail(`--${key} is required`);
  }
  return values;
}

function yamlScalar(value) {
  return JSON.stringify(value);
}

function imageCachePathForCilicon(reference, imageCacheRoot) {
  const match = /^(ghcr\.io\/[a-z0-9._/-]+)@(sha256:[0-9a-f]{64})$/.exec(reference);
  if (!match) fail("qualified image reference is not immutable GHCR");
  absoluteNormalized(imageCacheRoot, "imageCacheRoot");
  return path.join(imageCacheRoot, match[1], match[2]);
}

export async function validateCachedImageBundle(reference, imageCacheRoot) {
  const cachePath = imageCachePathForCilicon(reference, imageCacheRoot);
  let cacheInfo;
  try {
    cacheInfo = await lstat(cachePath);
  } catch {
    fail(`preseeded image cache is missing: ${cachePath}`);
  }
  if (!cacheInfo.isDirectory() || cacheInfo.isSymbolicLink()) {
    fail("preseeded image cache must be a direct directory");
  }
  if ((await realpath(cachePath)) !== cachePath) {
    fail("preseeded image cache must be canonical and symlink-free");
  }
  for (const name of ["config.json", "disk.img", "manifest.json", "nvram.bin"]) {
    const filePath = path.join(cachePath, name);
    let fileInfo;
    try {
      fileInfo = await lstat(filePath);
    } catch {
      fail(`preseeded image cache is incomplete: ${name}`);
    }
    if (!fileInfo.isFile() || fileInfo.isSymbolicLink() || fileInfo.size <= 0) {
      fail(`preseeded image cache file is invalid: ${name}`);
    }
  }
  for (const marker of ["UNFINISHED", ".unfinished"]) {
    try {
      await lstat(path.join(cachePath, marker));
      fail(`preseeded image cache is unfinished: ${marker}`);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === `preseeded image cache is unfinished: ${marker}`
      ) {
        throw error;
      }
      if (!error || typeof error !== "object" || error.code !== "ENOENT") throw error;
    }
  }
  return cachePath;
}

function validateCycleIdentity({ hostId, cycleId, clonePath, runnerName, cycleDir }) {
  nonempty(hostId, "hostId", SAFE_ID);
  nonempty(cycleId, "cycleId", SAFE_ID);
  nonempty(runnerName, "runnerName", SAFE_ID);
  absoluteNormalized(clonePath, "clonePath");
  absoluteNormalized(cycleDir, "cycleDir");
  if (path.basename(clonePath) !== cycleId) fail("clonePath must be owned by cycleId");
  if (path.basename(cycleDir) !== cycleId) fail("cycleDir must be owned by cycleId");
}

function renderCiliconConfig({
  contract,
  state,
  runnerAppId,
  runnerPrivateKeyPath,
  imageCacheRoot,
  sshUsername,
  sshPassword,
}) {
  positiveInteger(runnerAppId, "runnerAppId");
  absoluteNormalized(runnerPrivateKeyPath, "runnerPrivateKeyPath");
  nonempty(sshUsername, "sshUsername", SAFE_ID);
  nonempty(sshPassword, "sshPassword");
  const repository = contract.qualification.lifecycle.inventoryCredential.repository;
  const [organization, repositoryName] = repository.split("/");
  const guestMount = "/Volumes/My Shared Files/nixmac-e2e";
  const runnerFinishedPath = `${guestMount}/runner-finished.json`;
  const runnerFinished = JSON.stringify({
    version: 1,
    cycleId: state.cycleId,
    runnerName: state.runnerName,
  });
  const preRun = [
    "set -euo pipefail",
    "export PATH=/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
    `generation="$(/usr/bin/uuidgen | tr '[:upper:]' '[:lower:]' | tr -d '-')"; printf '%s\\n' "$generation" > ${JSON.stringify(
      `${guestMount}/vm-generation-$generation.tmp`,
    )}; chmod 0600 ${JSON.stringify(
      `${guestMount}/vm-generation-$generation.tmp`,
    )}; mv ${JSON.stringify(
      `${guestMount}/vm-generation-$generation.tmp`,
    )} ${JSON.stringify(`${guestMount}/vm-generation-$generation`)}`,
    `/usr/local/libexec/qualify-nixmac-e2e-runner --emit-probe ${JSON.stringify(
      `${guestMount}/runtime-probe.json`,
    )}`,
    `for _ in $(seq 1 120); do test -s ${JSON.stringify(
      `${guestMount}/runtime-observation.json`,
    )} && break; sleep 1; done`,
    `test -s ${JSON.stringify(`${guestMount}/runtime-observation.json`)}`,
    `install -m 0600 ${JSON.stringify(
      `${guestMount}/runtime-observation.json`,
    )} /var/db/nixmac-e2e/runtime-observation.json`,
    "rm -f /var/db/nixmac-e2e/runtime-refresh-failed",
    `nohup /usr/local/libexec/refresh-nixmac-e2e-runner ${JSON.stringify(
      guestMount,
    )} >/var/db/nixmac-e2e/runtime-refresh.log 2>&1 &`,
    "echo $! > /var/db/nixmac-e2e/runtime-refresh.pid",
  ].join("; ");
  // postRun begins only after the Actions runner has exited. Keep the VM
  // running there so the host can observe deregistration before teardown.
  const postRun = [
    "set -euo pipefail",
    "export PATH=/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
    `printf '%s\\n' ${JSON.stringify(runnerFinished)} > ${JSON.stringify(
      `${runnerFinishedPath}.tmp`,
    )}`,
    `chmod 0600 ${JSON.stringify(`${runnerFinishedPath}.tmp`)}`,
    `mv ${JSON.stringify(`${runnerFinishedPath}.tmp`)} ${JSON.stringify(runnerFinishedPath)}`,
    "while :; do /bin/sleep 3600; done",
  ].join("; ");
  return [
    `source: ${yamlScalar(
      imageCachePathForCilicon(contract.qualification.image.reference, imageCacheRoot),
    )}`,
    `vmClonePath: ${yamlScalar(state.clonePath)}`,
    `runnerName: ${yamlScalar(state.runnerName)}`,
    "retryDelay: 600",
    "sshConnectMaxRetries: 60",
    "consoleDevices:",
    "  - tart-version-2",
    "sshCredentials:",
    `  username: ${yamlScalar(sshUsername)}`,
    `  password: ${yamlScalar(sshPassword)}`,
    "hardware:",
    "  ramGigabytes: 16",
    "  cpuCores: 8",
    "  display:",
    "    width: 1920",
    "    height: 1200",
    "    pixelsPerInch: 80",
    "  connectsToAudioDevice: false",
    "directoryMounts:",
    `  - hostPath: ${yamlScalar(path.join(state.cycleDir, "exchange"))}`,
    '    guestFolder: "nixmac-e2e"',
    "    readOnly: false",
    `preRun: ${yamlScalar(preRun)}`,
    `postRun: ${yamlScalar(postRun)}`,
    "provisioner:",
    "  type: github",
    "  config:",
    `    appId: ${runnerAppId}`,
    `    organization: ${yamlScalar(organization)}`,
    `    repository: ${yamlScalar(repositoryName)}`,
    `    privateKeyPath: ${yamlScalar(runnerPrivateKeyPath)}`,
    "    downloadLatest: true",
    "    extraLabels:",
    '      - "nixmac-e2e"',
    '    runnerGroup: "Default"',
    `    workFolder: ${yamlScalar(`/Users/${sshUsername}/actions-runner/_work`)}`,
    "    livenessProbe:",
    `      command: ${yamlScalar(
      `test ! -e /var/db/nixmac-e2e/runtime-refresh-failed && { pgrep -f "/Users/${sshUsername}/actions-runner/run.sh" >/dev/null || test -s ${JSON.stringify(
        runnerFinishedPath,
      )}; }`,
    )}`,
    "      interval: 30",
    "      delay: 900",
    "",
  ].join("\n");
}

export async function prepareCycle({
  contractPath,
  statePath,
  configPath,
  cycleDir,
  hostId,
  cycleId,
  clonePath,
  runnerName,
  runnerAppId,
  runnerPrivateKeyPath,
  imageCacheRoot,
  sshUsername,
  sshPassword,
  now = () => new Date(),
}) {
  const contract = validateProviderContract(await readJson(contractPath, "provider contract"));
  if (contract.activation.state === "disabled") fail("provider contract is disabled");
  validateCycleIdentity({ hostId, cycleId, clonePath, runnerName, cycleDir });
  const resolvedCycleDir = await realpath(cycleDir);
  if (resolvedCycleDir !== cycleDir) fail("cycleDir must be canonical and symlink-free");
  await validateCachedImageBundle(contract.qualification.image.reference, imageCacheRoot);
  await mkdir(path.join(cycleDir, "exchange"), { recursive: true, mode: 0o700 });
  const createdAt = now().toISOString();
  verifyImageAdmission(contract, { admittedAt: createdAt });
  const state = {
    version: 1,
    hostId,
    cycleId,
    clonePath,
    runnerName,
    cycleDir,
    imageReference: contract.qualification.image.reference,
    imageDigest: contract.qualification.image.reference.split("@")[1],
    createdAt,
  };
  await atomicWrite(statePath, `${JSON.stringify(state, null, 2)}\n`);
  const config = renderCiliconConfig({
    contract,
    state,
    runnerAppId: Number(runnerAppId),
    runnerPrivateKeyPath,
    imageCacheRoot,
    sshUsername,
    sshPassword,
  });
  await atomicWrite(configPath, config);
  return state;
}

function validateRuntimeProbe(probe, contract, now) {
  exactKeys(probe, ["version", "observedAt", "cuaDriver", "tcc"], "runtimeProbe");
  if (probe.version !== 1) fail("runtimeProbe.version must be 1");
  canonicalTimestamp(probe.observedAt, "runtimeProbe.observedAt");
  const age = now.getTime() - Date.parse(probe.observedAt);
  if (age < 0 || age > 5 * 60 * 1000) fail("runtime probe is stale or from the future");
  const expectedCuaDriver = Object.fromEntries(
    [
      "artifactDigest",
      "executableDigest",
      "appBundleDigest",
      "cliVersion",
      "appVersion",
      "bundleId",
      "signingIdentity",
      "teamId",
      "appPath",
      "appExecutable",
      "cliSymlink",
    ].map((field) => [field, contract.qualification.cuaDriver[field]]),
  );
  if (canonicalJson(probe.cuaDriver) !== canonicalJson(expectedCuaDriver)) {
    fail("runtime probe CuaDriver identity does not match the contract");
  }
  const expectedTcc = {
    target: contract.qualification.tcc.target,
    services: contract.qualification.tcc.services,
    aquaSession: true,
    accessibilityGranted: true,
    screenRecordingGranted: true,
    smokePassed: true,
  };
  if (canonicalJson(probe.tcc) !== canonicalJson(expectedTcc)) {
    fail("runtime probe TCC facts do not match the qualified app identity");
  }
}

export async function signRuntimeObservation({
  contractPath,
  statePath,
  probePath,
  signingKeyPath,
  outputPath,
  now = () => new Date(),
}) {
  const contract = validateProviderContract(await readJson(contractPath, "provider contract"));
  const state = await readJson(statePath, "cycle state");
  validateCycleIdentity(state);
  const probe = await readJson(probePath, "runtime probe");
  const observedAt = now();
  validateRuntimeProbe(probe, contract, observedAt);
  const privateKey = createPrivateKey(await readFile(signingKeyPath, "utf8"));
  if (privateKey.asymmetricKeyType !== "ed25519") fail("attestor key must be Ed25519");
  const observation = {
    version: 1,
    observedAt: probe.observedAt,
    host: {
      hostId: state.hostId,
      cycleId: state.cycleId,
      clonePath: state.clonePath,
      runnerName: state.runnerName,
    },
    image: {
      reference: state.imageReference,
      digest: state.imageDigest,
      admittedAt: state.createdAt,
    },
    cuaDriver: probe.cuaDriver,
    tcc: probe.tcc,
    provenance: {
      algorithm: "ed25519",
      attestorKeyId: contract.qualification.attestor.keyId,
      signature: "",
    },
  };
  observation.provenance.signature = signPayload(
    null,
    Buffer.from(runtimeObservationSigningPayload(observation)),
    privateKey,
  ).toString("base64");
  verifyRuntimeObservation(contract, observation, { observedAt: observedAt.toISOString() });
  await atomicWrite(outputPath, `${JSON.stringify(observation, null, 2)}\n`);
  return observation;
}

export async function checkCycleAdmission({
  contractPath,
  statePath,
  now = () => new Date(),
}) {
  const contract = validateProviderContract(await readJson(contractPath, "provider contract"));
  const state = await readJson(statePath, "cycle state");
  validateCycleIdentity(state);
  if (
    state.imageReference !== contract.qualification.image.reference ||
    state.imageDigest !== contract.qualification.image.reference.split("@")[1]
  ) {
    fail("active cycle image no longer matches the deployed provider contract");
  }
  return verifyImageAdmission(contract, { admittedAt: now().toISOString() });
}

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function createAppJwt(appId, privateKeyPem, now) {
  positiveInteger(appId, "GitHub App ID");
  const privateKey = createPrivateKey(privateKeyPem);
  if (privateKey.asymmetricKeyType !== "rsa") fail("GitHub App key must be RSA");
  const timestamp = Math.floor(now.getTime() / 1000);
  const header = base64UrlJson({ alg: "RS256", typ: "JWT" });
  const payload = base64UrlJson({
    iat: timestamp - 30,
    exp: timestamp + 540,
    iss: String(appId),
  });
  const input = `${header}.${payload}`;
  const signature = signPayload("RSA-SHA256", Buffer.from(input), privateKey).toString(
    "base64url",
  );
  return `${input}.${signature}`;
}

async function githubJson({
  fetchImpl,
  apiBaseUrl,
  endpoint,
  token,
  method = "GET",
  body,
  expected = [200],
  includeStatus = false,
}) {
  const url = new URL(endpoint, apiBaseUrl);
  if (url.origin !== new URL(apiBaseUrl).origin) fail("GitHub endpoint escaped API origin");
  let response;
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      response = await fetchImpl(url, {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${token}`,
          "x-github-api-version": "2022-11-28",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const rateLimited =
        response.status === 403 &&
        (response.headers.get("retry-after") !== null ||
          response.headers.get("x-ratelimit-remaining") === "0");
      if (![408, 429, 500, 502, 503, 504].includes(response.status) && !rateLimited) break;
      lastError = new Error(`GitHub ${method} ${endpoint} returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < 5) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(4_000, 250 * 2 ** attempt)));
    }
  }
  const rateLimited =
    response?.status === 403 &&
    (response.headers.get("retry-after") !== null ||
      response.headers.get("x-ratelimit-remaining") === "0");
  if (
    !response ||
    [408, 429, 500, 502, 503, 504].includes(response.status) ||
    rateLimited
  ) {
    throw lastError ?? new Error(`GitHub ${method} ${endpoint} did not return a response`);
  }
  if (!expected.includes(response.status)) {
    fail(`GitHub ${method} ${endpoint} returned HTTP ${response.status}`);
  }
  if (response.status === 204) return includeStatus ? { status: 204, body: null } : null;
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_JSON_BYTES) fail("GitHub response exceeds one MiB");
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail("GitHub returned invalid JSON");
  }
  return includeStatus ? { status: response.status, body: parsed } : parsed;
}

async function installationToken({
  credential,
  privateKeyPem,
  fetchImpl,
  apiBaseUrl,
  now,
}) {
  const jwt = createAppJwt(credential.appId, privateKeyPem, now);
  const installation = await githubJson({
    fetchImpl,
    apiBaseUrl,
    endpoint: `/app/installations/${credential.installationId}`,
    token: jwt,
  });
  if (
    installation.id !== credential.installationId ||
    installation.app_id !== credential.appId ||
    installation.repository_selection !== "selected"
  ) {
    fail("GitHub App installation identity is not exact");
  }
  const tokenResponse = await githubJson({
    fetchImpl,
    apiBaseUrl,
    endpoint: `/app/installations/${credential.installationId}/access_tokens`,
    token: jwt,
    method: "POST",
    body: {
      repositories: [credential.repository.split("/")[1]],
      permissions: credential.permissions,
    },
    expected: [201],
  });
  if (
    canonicalJson(tokenResponse.permissions) !== canonicalJson(credential.permissions) ||
    !Array.isArray(tokenResponse.repositories) ||
    tokenResponse.repositories.length !== 1 ||
    tokenResponse.repositories[0]?.full_name !== credential.repository
  ) {
    fail("GitHub installation token is not exactly repository-scoped");
  }
  const expiresAt = Date.parse(tokenResponse.expires_at);
  if (
    typeof tokenResponse.token !== "string" ||
    tokenResponse.token === "" ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= now.getTime() ||
    expiresAt - now.getTime() > 65 * 60 * 1000
  ) {
    fail("GitHub installation token or expiry is invalid");
  }
  return tokenResponse.token;
}

async function runnerRecord({ repository, runnerName, token, fetchImpl, apiBaseUrl }) {
  let page = 1;
  let observed = 0;
  while (page <= 100) {
    const result = await githubJson({
      fetchImpl,
      apiBaseUrl,
      endpoint: `/repos/${repository}/actions/runners?per_page=100&page=${page}`,
      token,
    });
    if (!Array.isArray(result.runners) || !Number.isSafeInteger(result.total_count)) {
      fail("runner inventory is malformed");
    }
    const matched = result.runners.filter((runner) => runner?.name === runnerName);
    if (matched.length > 1) fail("runner inventory contains duplicate exact runner names");
    if (matched.length === 1) return matched[0];
    observed += result.runners.length;
    if (result.runners.length === 0 || observed >= result.total_count) return null;
    page += 1;
  }
  fail("runner inventory exceeded the bounded pagination limit");
}

async function runnerPresent(options) {
  return (await runnerRecord(options)) !== null;
}

export async function retireIdleRunner({
  contract,
  state,
  runnerAppId,
  runnerPrivateKeyPem,
  fetchImpl = globalThis.fetch,
  apiBaseUrl = "https://api.github.com",
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  now = () => new Date(),
}) {
  validateProviderContract(contract);
  validateCycleIdentity(state);
  positiveInteger(runnerAppId, "runnerAppId");
  const repository = contract.qualification.lifecycle.inventoryCredential.repository;
  const appJwt = createAppJwt(runnerAppId, runnerPrivateKeyPem, now());
  const installation = await githubJson({
    fetchImpl,
    apiBaseUrl,
    endpoint: `/repos/${repository}/installation`,
    token: appJwt,
  });
  if (
    !Number.isSafeInteger(installation.id) ||
    installation.id <= 0 ||
    installation.app_id !== runnerAppId
  ) {
    fail("runner-provisioner App installation identity is not exact");
  }
  const credential = {
    appId: runnerAppId,
    installationId: installation.id,
    repository,
    permissions: { administration: "write" },
  };
  const token = await installationToken({
    credential,
    privateKeyPem: runnerPrivateKeyPem,
    fetchImpl,
    apiBaseUrl,
    now: now(),
  });
  const runner = await runnerRecord({
    repository,
    runnerName: state.runnerName,
    token,
    fetchImpl,
    apiBaseUrl,
  });
  if (runner === null) {
    const deregistration = await waitForRunnerDeregistration({
      state,
      inventoryCredential: credential,
      inventoryPrivateKeyPem: runnerPrivateKeyPem,
      fetchImpl,
      apiBaseUrl,
      timeoutMs: 2 * 60 * 1000,
      pollMs: 5_000,
      sleep,
      now,
    });
    if (!deregistration.runnerDeregistered) {
      fail("idle runner appeared while absence was being proved");
    }
    return { retired: true, alreadyAbsent: true, runnerName: state.runnerName };
  }
  if (
    !Number.isSafeInteger(runner.id) ||
    runner.id <= 0 ||
    runner.name !== state.runnerName ||
    typeof runner.busy !== "boolean"
  ) {
    fail("exact runner record is malformed");
  }
  if (runner.busy) {
    return { retired: false, busy: true, runnerName: state.runnerName };
  }
  const deletion = await githubJson({
    fetchImpl,
    apiBaseUrl,
    endpoint: `/repos/${repository}/actions/runners/${runner.id}`,
    token,
    method: "DELETE",
    expected: [204, 422],
    includeStatus: true,
  });
  if (deletion.status === 422) {
    return { retired: false, busy: true, runnerName: state.runnerName };
  }
  const deregistration = await waitForRunnerDeregistration({
    state,
    inventoryCredential: credential,
    inventoryPrivateKeyPem: runnerPrivateKeyPem,
    fetchImpl,
    apiBaseUrl,
    timeoutMs: 2 * 60 * 1000,
    pollMs: 5_000,
    sleep,
    now,
  });
  if (!deregistration.runnerDeregistered) {
    fail("retired idle runner remained in repository inventory");
  }
  return { retired: true, alreadyAbsent: false, runnerName: state.runnerName };
}

export async function waitForRunnerDeregistration({
  state,
  inventoryCredential,
  inventoryPrivateKeyPem,
  fetchImpl,
  apiBaseUrl,
  timeoutMs,
  pollMs,
  sleep,
  now,
}) {
  const token = await installationToken({
    credential: inventoryCredential,
    privateKeyPem: inventoryPrivateKeyPem,
    fetchImpl,
    apiBaseUrl,
    now: now(),
  });
  const deadline = now().getTime() + timeoutMs;
  let absentSamples = 0;
  while (now().getTime() <= deadline) {
    const present = await runnerPresent({
      repository: inventoryCredential.repository,
      runnerName: state.runnerName,
      token,
      fetchImpl,
      apiBaseUrl,
    });
    if (!present) {
      absentSamples += 1;
      if (absentSamples >= 2) {
        return { runnerDeregistered: true, samples: absentSamples };
      }
    } else {
      absentSamples = 0;
    }
    await sleep(pollMs);
  }
  return { runnerDeregistered: false, samples: absentSamples };
}

async function matchingClonePaths(clonePath) {
  const parent = path.dirname(clonePath);
  let entries;
  try {
    entries = await (await import("node:fs/promises")).readdir(parent, {
      withFileTypes: true,
    });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const prefix = path.basename(clonePath);
  const matches = [];
  for (const entry of entries) {
    if (!entry.name.startsWith(prefix)) continue;
    const candidate = path.join(parent, entry.name);
    const info = await stat(candidate);
    if (info.isDirectory()) matches.push(candidate);
  }
  return matches.sort();
}

export async function waitForLocalCloneAbsence({
  state,
  timeoutMs = 5 * 60 * 1000,
  pollMs = 5_000,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  now = () => new Date(),
}) {
  validateCycleIdentity(state);
  const deadline = now().getTime() + timeoutMs;
  let absentSamples = 0;
  let clones = [state.clonePath];
  while (now().getTime() <= deadline) {
    clones = await matchingClonePaths(state.clonePath);
    if (clones.length === 0) {
      absentSamples += 1;
      if (absentSamples >= 2) {
        return { clonePathAbsent: true, matchingClonePaths: [] };
      }
    } else {
      absentSamples = 0;
    }
    await sleep(pollMs);
  }
  return {
    clonePathAbsent: false,
    matchingClonePaths: clones,
  };
}

async function waitForDestruction({
  state,
  inventoryCredential,
  inventoryPrivateKeyPem,
  fetchImpl,
  apiBaseUrl,
  timeoutMs,
  pollMs,
  sleep,
  now,
}) {
  const token = await installationToken({
    credential: inventoryCredential,
    privateKeyPem: inventoryPrivateKeyPem,
    fetchImpl,
    apiBaseUrl,
    now: now(),
  });
  const deadline = now().getTime() + timeoutMs;
  let absentSamples = 0;
  let lastRunnerPresent = true;
  let clones = [state.clonePath];
  while (now().getTime() <= deadline) {
    lastRunnerPresent = await runnerPresent({
      repository: inventoryCredential.repository,
      runnerName: state.runnerName,
      token,
      fetchImpl,
      apiBaseUrl,
    });
    clones = await matchingClonePaths(state.clonePath);
    if (!lastRunnerPresent && clones.length === 0) {
      absentSamples += 1;
      if (absentSamples >= 2) {
        return {
          runnerDeregistered: true,
          clonePathAbsent: true,
          matchingClonePaths: [],
        };
      }
    } else {
      absentSamples = 0;
    }
    await sleep(pollMs);
  }
  return {
    runnerDeregistered: !lastRunnerPresent,
    clonePathAbsent: !clones.includes(state.clonePath),
    matchingClonePaths: clones,
  };
}

function validateRequestAgainstState(request, state, contract) {
  validateLifecycleRequest(request);
  if (
    request.runnerName !== state.runnerName ||
    request.runnerImageDigest !== state.imageDigest ||
    request.hostEcho.cycleId !== state.cycleId ||
    request.hostEcho.clonePath !== state.clonePath ||
    request.attestationPolicy.expectedHostId !== state.hostId ||
    request.attestationPolicy.attestorKeyId !== contract.qualification.attestor.keyId ||
    request.attestationPolicy.sinkRepository !== contract.qualification.lifecycle.sinkRepository ||
    request.attestationPolicy.sinkRef !== contract.qualification.lifecycle.sinkRef
  ) {
    fail("lifecycle request does not exactly match the host cycle");
  }
}

function attestationFor({ request, state, contract, destruction, reason, privateKey, now }) {
  const quarantined =
    reason !== "" ||
    !destruction.runnerDeregistered ||
    !destruction.clonePathAbsent ||
    destruction.matchingClonePaths.length !== 0;
  const attestation = {
    version: 1,
    result: quarantined ? "quarantined" : "destroyed",
    repo: request.repo,
    jobId: request.jobId,
    mergeSha: request.mergeSha,
    suiteVersion: request.suiteVersion,
    attempt: request.attempt,
    attestationNonce: request.attestationNonce,
    githubRunId: request.githubRunId,
    githubRunAttempt: request.githubRunAttempt,
    runnerName: request.runnerName,
    runnerImageDigest: request.runnerImageDigest,
    cycleId: request.hostEcho.cycleId,
    clonePath: request.hostEcho.clonePath,
    hostId: state.hostId,
    attestedAt: now.toISOString(),
    runnerDeregistered: destruction.runnerDeregistered,
    clonePathAbsent: destruction.clonePathAbsent,
    matchingClonePaths: destruction.matchingClonePaths,
    quarantine: {
      marked: quarantined,
      reason: quarantined ? reason || "runner or clone destruction was not proved" : "",
    },
    provenance: {
      algorithm: "ed25519",
      attestorKeyId: contract.qualification.attestor.keyId,
      sinkRepository: contract.qualification.lifecycle.sinkRepository,
      sinkRef: contract.qualification.lifecycle.sinkRef,
      sinkPath: lifecycleAttestationPath(request, contract),
      blobDigest: "",
      signature: "",
    },
  };
  attestation.provenance.blobDigest = lifecycleAttestationBlobDigest(attestation);
  attestation.provenance.signature = signPayload(
    null,
    Buffer.from(lifecycleAttestationSigningPayload(attestation)),
    privateKey,
  ).toString("base64");
  return attestation;
}

function validateLocalAttestation(attestation, { request, state, contract }) {
  exactKeys(
    attestation,
    [
      "version",
      "result",
      "repo",
      "jobId",
      "mergeSha",
      "suiteVersion",
      "attempt",
      "attestationNonce",
      "githubRunId",
      "githubRunAttempt",
      "runnerName",
      "runnerImageDigest",
      "cycleId",
      "clonePath",
      "hostId",
      "attestedAt",
      "runnerDeregistered",
      "clonePathAbsent",
      "matchingClonePaths",
      "quarantine",
      "provenance",
    ],
    "localAttestation",
  );
  if (
    attestation.version !== 1 ||
    !["destroyed", "quarantined"].includes(attestation.result) ||
    attestation.repo !== request.repo ||
    attestation.jobId !== request.jobId ||
    attestation.mergeSha !== request.mergeSha ||
    attestation.suiteVersion !== request.suiteVersion ||
    attestation.attempt !== request.attempt ||
    attestation.attestationNonce !== request.attestationNonce ||
    attestation.githubRunId !== request.githubRunId ||
    attestation.githubRunAttempt !== request.githubRunAttempt ||
    attestation.runnerName !== state.runnerName ||
    attestation.runnerImageDigest !== state.imageDigest ||
    attestation.cycleId !== state.cycleId ||
    attestation.clonePath !== state.clonePath ||
    attestation.hostId !== state.hostId
  ) {
    fail("persisted local attestation does not match the host cycle request");
  }
  canonicalTimestamp(attestation.attestedAt, "localAttestation.attestedAt");
  if (
    attestation.provenance.algorithm !== "ed25519" ||
    attestation.provenance.attestorKeyId !== contract.qualification.attestor.keyId ||
    attestation.provenance.sinkRepository !== contract.qualification.lifecycle.sinkRepository ||
    attestation.provenance.sinkRef !== contract.qualification.lifecycle.sinkRef ||
    attestation.provenance.sinkPath !== lifecycleAttestationPath(request, contract) ||
    attestation.provenance.blobDigest !== lifecycleAttestationBlobDigest(attestation)
  ) {
    fail("persisted local attestation provenance is invalid");
  }
  const publicKey = createPublicKey(contract.qualification.attestor.publicKeyPem);
  if (
    publicKey.asymmetricKeyType !== "ed25519" ||
    !verifySignature(
      null,
      Buffer.from(lifecycleAttestationSigningPayload(attestation)),
      publicKey,
      Buffer.from(attestation.provenance.signature, "base64"),
    )
  ) {
    fail("persisted local attestation signature is invalid");
  }
  if (attestation.result === "destroyed") {
    if (
      attestation.runnerDeregistered !== true ||
      attestation.clonePathAbsent !== true ||
      !Array.isArray(attestation.matchingClonePaths) ||
      attestation.matchingClonePaths.length !== 0 ||
      attestation.quarantine?.marked !== false ||
      attestation.quarantine?.reason !== ""
    ) {
      fail("persisted destroyed attestation does not prove destruction");
    }
  } else if (
    attestation.quarantine?.marked !== true ||
    typeof attestation.quarantine?.reason !== "string" ||
    attestation.quarantine.reason.trim() === ""
  ) {
    fail("persisted quarantined attestation is invalid");
  }
  return attestation;
}

async function dispatchAndConfirmAttestation({
  attestation,
  sinkCredential,
  sinkPrivateKeyPem,
  fetchImpl,
  apiBaseUrl,
  now,
  sleep,
}) {
  if (attestation.provenance.sinkRef !== "refs/heads/attestations") {
    fail("lifecycle attestation must target the protected attestation branch");
  }
  const encodedPath = attestation.provenance.sinkPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const deadline = now().getTime() + 20 * 60 * 1000;
  let nextDispatchAt = 0;
  let token = null;
  let lastTransientError = null;
  while (now().getTime() <= deadline) {
    if (token === null) {
      try {
        token = await installationToken({
          credential: sinkCredential,
          privateKeyPem: sinkPrivateKeyPem,
          fetchImpl,
          apiBaseUrl,
          now: now(),
        });
      } catch (error) {
        lastTransientError = error;
        await sleep(10_000);
        continue;
      }
    }
    if (now().getTime() >= nextDispatchAt) {
      try {
        const serializedAttestation = JSON.stringify(attestation);
        if (Buffer.byteLength(serializedAttestation) > 60 * 1024) {
          fail("lifecycle attestation exceeds the workflow-dispatch input limit");
        }
        await githubJson({
          fetchImpl,
          apiBaseUrl,
          endpoint: `/repos/${sinkCredential.repository}/actions/workflows/cilicon-lifecycle-attestation.yml/dispatches`,
          token,
          method: "POST",
          body: {
            ref: "main",
            inputs: {
              sink_path: attestation.provenance.sinkPath,
              attestation: serializedAttestation,
            },
          },
          expected: [204],
        });
      } catch (error) {
        lastTransientError = error;
        token = null;
        await sleep(10_000);
        continue;
      }
      nextDispatchAt = now().getTime() + 30_000;
    }
    let persisted;
    try {
      persisted = await githubJson({
        fetchImpl,
        apiBaseUrl,
        endpoint: `/repos/${sinkCredential.repository}/contents/${encodedPath}?ref=attestations`,
        token,
        expected: [200, 404],
        includeStatus: true,
      });
    } catch (error) {
      lastTransientError = error;
      token = null;
      await sleep(10_000);
      continue;
    }
    if (persisted.status === 200) {
      const content = persisted.body;
      if (
        content?.type !== "file" ||
        content?.path !== attestation.provenance.sinkPath ||
        content?.encoding !== "base64" ||
        typeof content?.content !== "string"
      ) {
        fail("protected sink confirmation is not one exact file");
      }
      let observed;
      try {
        observed = JSON.parse(
          Buffer.from(content.content.replace(/\s+/g, ""), "base64").toString("utf8"),
        );
      } catch {
        fail("protected sink confirmation is invalid JSON");
      }
      if (canonicalJson(observed) !== canonicalJson(attestation)) {
        fail("protected sink confirmation differs from the signed attestation");
      }
      return;
    }
    await sleep(10_000);
  }
  const suffix =
    lastTransientError instanceof Error ? `: ${lastTransientError.message}` : "";
  fail(`protected sink did not confirm the immutable attestation before timeout${suffix}`);
}

export async function attestLifecycle({
  contractPath,
  statePath,
  requestPath,
  signingKeyPath,
  inventoryPrivateKeyPath,
  sinkPrivateKeyPath,
  outputPath,
  quarantineSentinel,
  forcedQuarantineReason = "",
  timeoutMs = 20 * 60 * 1000,
  pollMs = 5_000,
  fetchImpl = globalThis.fetch,
  apiBaseUrl = "https://api.github.com",
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  now = () => new Date(),
}) {
  const contract = validateProviderContract(await readJson(contractPath, "provider contract"));
  const state = await readJson(statePath, "cycle state");
  validateCycleIdentity(state);
  const request = await readJson(requestPath, "lifecycle request");
  validateRequestAgainstState(request, state, contract);
  const privateKey = createPrivateKey(await readFile(signingKeyPath, "utf8"));
  if (privateKey.asymmetricKeyType !== "ed25519") fail("attestor key must be Ed25519");
  const lifecycle = contract.qualification.lifecycle;
  let attestation;
  try {
    attestation = validateLocalAttestation(await readJson(outputPath, "local attestation"), {
      request,
      state,
      contract,
    });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    let reason = forcedQuarantineReason;
    let destruction;
    try {
      destruction = await waitForDestruction({
        state,
        inventoryCredential: lifecycle.inventoryCredential,
        inventoryPrivateKeyPem: await readFile(inventoryPrivateKeyPath, "utf8"),
        fetchImpl,
        apiBaseUrl,
        timeoutMs: forcedQuarantineReason === "" ? timeoutMs : 0,
        pollMs,
        sleep,
        now,
      });
      if (
        !destruction.runnerDeregistered ||
        !destruction.clonePathAbsent ||
        destruction.matchingClonePaths.length !== 0
      ) {
        reason =
          reason === ""
            ? "runner deregistration or unambiguous clone absence timed out"
            : reason;
      }
    } catch (destructionError) {
      if (reason === "") {
        reason = `destruction verification failed: ${
          destructionError instanceof Error ? destructionError.message : String(destructionError)
        }`;
      }
      destruction = {
        runnerDeregistered: false,
        clonePathAbsent: false,
        matchingClonePaths: await matchingClonePaths(state.clonePath),
      };
    }
    attestation = attestationFor({
      request,
      state,
      contract,
      destruction,
      reason,
      privateKey,
      now: now(),
    });
    await atomicWrite(outputPath, `${JSON.stringify(attestation, null, 2)}\n`);
  }
  if (attestation.result === "quarantined") {
    await writeQuarantineSentinel(
      quarantineSentinel,
      {
        version: 1,
        hostId: state.hostId,
        cycleId: state.cycleId,
        reason: attestation.quarantine.reason,
        markedAt: attestation.attestedAt,
      },
    );
  }
  try {
    await dispatchAndConfirmAttestation({
      attestation,
      sinkCredential: lifecycle.sinkCredential,
      sinkPrivateKeyPem: await readFile(sinkPrivateKeyPath, "utf8"),
      fetchImpl,
      apiBaseUrl,
      now,
      sleep,
    });
  } catch (error) {
    if (attestation.result !== "quarantined") {
      await writeQuarantineSentinel(
        quarantineSentinel,
        {
          version: 1,
          hostId: state.hostId,
          cycleId: state.cycleId,
          reason: `protected sink dispatch failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
          markedAt: now().toISOString(),
        },
      );
    }
    throw error;
  }
  return attestation;
}

async function selfTest() {
  assert.equal(
    imageCachePathForCilicon(
      `ghcr.io/darkmatter/nixmac-e2e-runner@sha256:${"a".repeat(64)}`,
      "/Users/nixmac_e2e/.tart/cache/OCIs",
    ),
    `/Users/nixmac_e2e/.tart/cache/OCIs/ghcr.io/darkmatter/nixmac-e2e-runner/sha256:${"a".repeat(64)}`,
  );
  assert.throws(
    () =>
      imageCachePathForCilicon(
        "ghcr.io/darkmatter/nixmac-e2e-runner:latest",
        "/Users/nixmac_e2e/.tart/cache/OCIs",
      ),
    /immutable/,
  );
  assert.throws(
    () =>
      validateCycleIdentity({
        hostId: "host-1",
        cycleId: "cycle-1",
        clonePath: "/Users/Shared/Cilicon/vms/other",
        runnerName: "runner-1",
        cycleDir: "/var/db/nixmac-e2e/cycles/cycle-1",
      }),
    /clonePath must be owned/,
  );
  const fakeRequest = {
    repo: "darkmatter/nixmac",
    jobId: `darkmatter/nixmac:${"a".repeat(40)}:suite`,
    mergeSha: "a".repeat(40),
    suiteVersion: "suite",
    attempt: 1,
    attestationNonce: "n".repeat(32),
    githubRunId: 1,
    githubRunAttempt: 1,
    runnerName: "runner-1",
    runnerImageDigest: `sha256:${"b".repeat(64)}`,
    hostEcho: { cycleId: "cycle-1", clonePath: "/Users/Shared/Cilicon/vms/cycle-1" },
    attestationPolicy: {
      expectedHostId: "host-1",
      attestorKeyId: "key-1",
      sinkRepository: "darkmatter/sink",
      sinkRef: "refs/heads/attestations",
    },
  };
  assert.match(
    createHash("sha256").update(canonicalJson(fakeRequest)).digest("hex"),
    /^[0-9a-f]{64}$/,
  );
  console.log("Cilicon host controller self-test passed.");
}

async function main(argv) {
  const command = argv[0];
  if (command === "self-test") return selfTest();
  if (command === "prepare-cycle") {
    const values = parseArgs(argv.slice(1), [
      "contract",
      "state",
      "config",
      "cycle-dir",
      "host-id",
      "cycle-id",
      "clone-path",
      "runner-name",
      "runner-app-id",
      "runner-private-key-path",
      "image-cache-root",
      "ssh-username",
      "ssh-password",
    ]);
    await prepareCycle({
      contractPath: values.contract,
      statePath: values.state,
      configPath: values.config,
      cycleDir: values["cycle-dir"],
      hostId: values["host-id"],
      cycleId: values["cycle-id"],
      clonePath: values["clone-path"],
      runnerName: values["runner-name"],
      runnerAppId: values["runner-app-id"],
      runnerPrivateKeyPath: values["runner-private-key-path"],
      imageCacheRoot: values["image-cache-root"],
      sshUsername: values["ssh-username"],
      sshPassword: values["ssh-password"],
    });
    return;
  }
  if (command === "sign-runtime") {
    const values = parseArgs(argv.slice(1), [
      "contract",
      "state",
      "probe",
      "signing-key",
      "output",
    ]);
    await signRuntimeObservation({
      contractPath: values.contract,
      statePath: values.state,
      probePath: values.probe,
      signingKeyPath: values["signing-key"],
      outputPath: values.output,
    });
    return;
  }
  if (command === "check-image-admission") {
    const values = parseArgs(argv.slice(1), ["contract"]);
    const contract = validateProviderContract(await readJson(values.contract, "provider contract"));
    verifyImageAdmission(contract, { admittedAt: new Date().toISOString() });
    return;
  }
  if (command === "check-cycle-admission") {
    const values = parseArgs(argv.slice(1), ["contract", "state"]);
    await checkCycleAdmission({
      contractPath: values.contract,
      statePath: values.state,
    });
    return;
  }
  if (command === "wait-clone-absent") {
    const values = parseArgs(argv.slice(1), ["state"]);
    const state = await readJson(values.state, "cycle state");
    const result = await waitForLocalCloneAbsence({ state });
    if (!result.clonePathAbsent || result.matchingClonePaths.length !== 0) {
      fail("exact clone absence timed out during healthy drain");
    }
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (command === "retire-idle-runner") {
    const values = parseArgs(argv.slice(1), [
      "contract",
      "state",
      "runner-app-id",
      "runner-private-key",
    ]);
    const contract = validateProviderContract(await readJson(values.contract, "provider contract"));
    const state = await readJson(values.state, "cycle state");
    const result = await retireIdleRunner({
      contract,
      state,
      runnerAppId: Number(values["runner-app-id"]),
      runnerPrivateKeyPem: await readFile(values["runner-private-key"], "utf8"),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (command === "wait-runner-absent") {
    const values = parseArgs(argv.slice(1), [
      "contract",
      "state",
      "request",
      "inventory-private-key",
    ]);
    const contract = validateProviderContract(await readJson(values.contract, "provider contract"));
    const state = await readJson(values.state, "cycle state");
    validateCycleIdentity(state);
    const request = await readJson(values.request, "lifecycle request");
    validateRequestAgainstState(request, state, contract);
    const result = await waitForRunnerDeregistration({
      state,
      inventoryCredential: contract.qualification.lifecycle.inventoryCredential,
      inventoryPrivateKeyPem: await readFile(values["inventory-private-key"], "utf8"),
      fetchImpl: globalThis.fetch,
      apiBaseUrl: "https://api.github.com",
      timeoutMs: 20 * 60 * 1000,
      pollMs: 5_000,
      sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
      now: () => new Date(),
    });
    if (!result.runnerDeregistered) fail("exact runner deregistration timed out");
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (command === "attest") {
    const values = parseArgs(argv.slice(1), [
      "contract",
      "state",
      "request",
      "signing-key",
      "inventory-private-key",
      "sink-private-key",
      "output",
      "quarantine-sentinel",
      "forced-quarantine-reason",
    ]);
    await attestLifecycle({
      contractPath: values.contract,
      statePath: values.state,
      requestPath: values.request,
      signingKeyPath: values["signing-key"],
      inventoryPrivateKeyPath: values["inventory-private-key"],
      sinkPrivateKeyPath: values["sink-private-key"],
      outputPath: values.output,
      quarantineSentinel: values["quarantine-sentinel"],
      forcedQuarantineReason:
        values["forced-quarantine-reason"] === "-"
          ? ""
          : values["forced-quarantine-reason"],
    });
    return;
  }
  fail(
    "usage: cilicon-e2e-host.mjs self-test|prepare-cycle|sign-runtime|check-image-admission|check-cycle-admission|retire-idle-runner|wait-clone-absent|wait-runner-absent|attest",
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
