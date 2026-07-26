#!/usr/bin/env node

import { createHash, createPrivateKey, sign as signPayload } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  completeLifecycleConsumption,
  lifecycleAttestationPath,
  verifyLifecycleAttestationCandidate,
} from "./cilicon-e2e-contract.mjs";

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

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
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

function positiveInteger(value, field) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail(`${field} must be a positive integer`);
  }
}

function nonempty(value, field) {
  if (typeof value !== "string" || value.trim() === "" || value.includes("\0")) {
    fail(`${field} must be a non-empty string`);
  }
  return value;
}

function encodeRepositoryPath(value) {
  return value.split("/").map(encodeURIComponent).join("/");
}

async function responseJson(response, expectedStatuses, field) {
  if (!expectedStatuses.includes(response.status)) {
    fail(`${field} returned HTTP ${response.status}`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    fail(`${field} did not return JSON`);
  }
  const body = await response.text();
  if (Buffer.byteLength(body) > 1024 * 1024) {
    fail(`${field} JSON exceeds one MiB`);
  }
  try {
    return JSON.parse(body);
  } catch {
    fail(`${field} returned invalid JSON`);
  }
}

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export class GitHubProtectedSinkClient {
  kind = "authenticated-github-protected-sink-v1";

  constructor({
    appId,
    installationId,
    privateKeyPem,
    repository,
    apiBaseUrl = "https://api.github.com",
    fetchImpl = globalThis.fetch,
    now = () => new Date(),
  }) {
    positiveInteger(appId, "appId");
    positiveInteger(installationId, "installationId");
    nonempty(privateKeyPem, "privateKeyPem");
    nonempty(repository, "repository");
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
      fail("repository must be owner/name");
    }
    const base = new URL(apiBaseUrl);
    if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) {
      fail("GitHub API base URL must be credential-free HTTPS");
    }
    if (typeof fetchImpl !== "function") fail("fetchImpl must be callable");
    if (typeof now !== "function") fail("now must be callable");
    let privateKey;
    try {
      privateKey = createPrivateKey(privateKeyPem);
    } catch {
      fail("privateKeyPem must be a valid GitHub App private key");
    }
    if (privateKey.asymmetricKeyType !== "rsa") {
      fail("GitHub App private key must be RSA");
    }
    this.appId = appId;
    this.installationId = installationId;
    this.privateKey = privateKey;
    this.repository = repository;
    this.apiBaseUrl = base;
    this.fetchImpl = fetchImpl;
    this.now = now;
  }

  _jwt() {
    const nowSeconds = Math.floor(this.now().getTime() / 1000);
    const header = base64UrlJson({ alg: "RS256", typ: "JWT" });
    const payload = base64UrlJson({
      iat: nowSeconds - 30,
      exp: nowSeconds + 540,
      iss: String(this.appId),
    });
    const input = `${header}.${payload}`;
    const signature = signPayload("RSA-SHA256", Buffer.from(input), this.privateKey).toString(
      "base64url",
    );
    return `${input}.${signature}`;
  }

  async _request(path, { token, method = "GET", body, expected = [200] } = {}) {
    const response = await this.fetchImpl(new URL(path, this.apiBaseUrl), {
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
    return responseJson(response, expected, `GitHub ${method} ${path}`);
  }

  async _installationToken() {
    const jwt = this._jwt();
    const installation = await this._request(`/app/installations/${this.installationId}`, {
      token: jwt,
    });
    if (
      installation.id !== this.installationId ||
      installation.app_id !== this.appId ||
      installation.repository_selection !== "selected"
    ) {
      fail("GitHub App installation identity or repository selection is invalid");
    }
    const repositoryName = this.repository.split("/")[1];
    const permissions = {
      administration: "read",
      checks: "read",
      contents: "read",
    };
    const tokenResponse = await this._request(
      `/app/installations/${this.installationId}/access_tokens`,
      {
        token: jwt,
        method: "POST",
        body: {
          repositories: [repositoryName],
          permissions,
        },
        expected: [201],
      },
    );
    nonempty(tokenResponse.token, "GitHub installation token");
    if (
      canonicalJson(tokenResponse.permissions) !== canonicalJson(permissions) ||
      !Array.isArray(tokenResponse.repositories) ||
      tokenResponse.repositories.length !== 1 ||
      tokenResponse.repositories[0]?.full_name !== this.repository
    ) {
      fail("GitHub installation token is not exactly scoped to the protected sink");
    }
    const expiresAt = Date.parse(tokenResponse.expires_at);
    if (
      !Number.isFinite(expiresAt) ||
      expiresAt <= this.now().getTime() ||
      expiresAt - this.now().getTime() > 65 * 60 * 1000
    ) {
      fail("GitHub installation token expiry is invalid");
    }
    return tokenResponse.token;
  }

  async fetchAttestation({ repository, ref, path, requiredStatusCheck }) {
    if (repository !== this.repository) {
      fail("protected sink repository does not match the scoped GitHub App");
    }
    if (ref !== "refs/heads/main") fail("protected sink ref must be refs/heads/main");
    nonempty(path, "protected sink path");
    if (path.startsWith("/") || path.includes("..")) {
      fail("protected sink path must be repository-relative and traversal-free");
    }
    nonempty(requiredStatusCheck, "requiredStatusCheck");
    const token = await this._installationToken();
    const branch = "main";
    const refResult = await this._request(`/repos/${repository}/git/ref/heads/${branch}`, {
      token,
    });
    const commit = refResult?.object?.sha;
    if (
      refResult.ref !== ref ||
      refResult?.object?.type !== "commit" ||
      typeof commit !== "string" ||
      !/^[0-9a-f]{40}$/.test(commit)
    ) {
      fail("protected sink branch did not resolve to one exact commit");
    }
    const protection = await this._request(`/repos/${repository}/branches/${branch}/protection`, {
      token,
    });
    const contexts = protection?.required_status_checks?.contexts;
    const checks = protection?.required_status_checks?.checks;
    const requiredCheckPolicies = Array.isArray(checks)
      ? checks.filter((check) => check?.context === requiredStatusCheck)
      : [];
    if (
      protection?.required_status_checks?.strict !== true ||
      protection?.enforce_admins?.enabled !== true ||
      !Array.isArray(contexts) ||
      !contexts.includes(requiredStatusCheck) ||
      !Array.isArray(checks) ||
      requiredCheckPolicies.length !== 1 ||
      !Number.isSafeInteger(requiredCheckPolicies[0]?.app_id) ||
      requiredCheckPolicies[0].app_id <= 0
    ) {
      fail("protected sink branch protection or required status policy is invalid");
    }
    const requiredCheckAppId = requiredCheckPolicies[0].app_id;
    const checkRuns = await this._request(`/repos/${repository}/commits/${commit}/check-runs`, {
      token,
    });
    if (
      !Array.isArray(checkRuns.check_runs) ||
      !checkRuns.check_runs.some(
        (check) =>
          check?.name === requiredStatusCheck &&
          check?.head_sha === commit &&
          check?.status === "completed" &&
          check?.conclusion === "success" &&
          check?.app?.id === requiredCheckAppId,
      )
    ) {
      fail("protected sink commit lacks the required status check App identity");
    }
    const encodedPath = encodeRepositoryPath(path);
    const content = await this._request(
      `/repos/${repository}/contents/${encodedPath}?ref=${commit}`,
      { token },
    );
    if (
      content?.type !== "file" ||
      content?.path !== path ||
      content?.encoding !== "base64" ||
      typeof content?.content !== "string" ||
      typeof content?.sha !== "string" ||
      !/^[0-9a-f]{40}$/.test(content.sha)
    ) {
      fail("protected sink content response is not one exact file");
    }
    const blob = await this._request(`/repos/${repository}/git/blobs/${content.sha}`, { token });
    if (
      blob?.sha !== content.sha ||
      blob?.encoding !== "base64" ||
      typeof blob?.content !== "string"
    ) {
      fail("protected sink blob readback contract is invalid");
    }
    const contentBytes = Buffer.from(content.content.replace(/\s+/g, ""), "base64");
    const blobBytes = Buffer.from(blob.content.replace(/\s+/g, ""), "base64");
    if (!contentBytes.equals(blobBytes)) {
      fail("protected sink blob readback differs from the branch content");
    }
    let attestation;
    try {
      attestation = JSON.parse(contentBytes.toString("utf8"));
    } catch {
      fail("protected sink attestation is invalid JSON");
    }
    nonempty(attestation?.provenance?.blobDigest, "attestation provenance blobDigest");
    return {
      attestation,
      sourceObservation: {
        repository,
        ref,
        path,
        commit,
        blobSha: content.sha,
        blobDigest: attestation.provenance.blobDigest,
        fetchedAt: this.now().toISOString(),
        authenticatedBy: {
          appId: this.appId,
          installationId: this.installationId,
        },
        branchProtectionVerified: true,
        readbackVerified: true,
        requiredStatusChecks: [requiredStatusCheck],
      },
    };
  }
}

export class HttpDurableLifecycleStore {
  kind = "durable-lifecycle-consumption-v1";

  constructor({ baseUrl, bearerToken, fetchImpl = globalThis.fetch }) {
    nonempty(baseUrl, "baseUrl");
    nonempty(bearerToken, "bearerToken");
    const endpoint = new URL(baseUrl);
    if (
      endpoint.protocol !== "https:" ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash
    ) {
      fail("durable lifecycle store URL must be credential-free HTTPS");
    }
    if (typeof fetchImpl !== "function") fail("fetchImpl must be callable");
    this.baseUrl = endpoint;
    this.bearerToken = bearerToken;
    this.fetchImpl = fetchImpl;
  }

  async _request(url, { method, body, expected }) {
    const response = await this.fetchImpl(url, {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
      headers: {
        accept: "application/json",
        authorization: `Bearer ${this.bearerToken}`,
        ...(body === undefined
          ? {}
          : {
              "content-type": "application/json",
              "if-none-match": "*",
            }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if ([409, 412].includes(response.status)) return { replayed: true };
    const value = await responseJson(response, expected, `lifecycle store ${method}`);
    return {
      value,
      etag: response.headers.get("etag"),
      replayed: false,
    };
  }

  async consume(lifecycleKey, record) {
    if (!/^[0-9a-f]{64}$/.test(lifecycleKey)) {
      fail("lifecycleKey must be a lowercase SHA-256 key");
    }
    exactKeys(record, ["observedAt", "sinkCommit", "blobDigest"], "consumption record");
    const recordDigest = sha256(canonicalJson(record));
    const proposed = {
      schemaVersion: 1,
      lifecycleKey,
      record,
      recordDigest,
    };
    const url = new URL(
      `v1/lifecycle-consumptions/${lifecycleKey}`,
      this.baseUrl.href.endsWith("/") ? this.baseUrl : `${this.baseUrl.href}/`,
    );
    const created = await this._request(url, {
      method: "PUT",
      body: proposed,
      expected: [201],
    });
    if (created.replayed) return false;
    const expectedReceipt = {
      ...proposed,
      durable: true,
      atomicCreate: true,
    };
    if (
      canonicalJson(created.value) !== canonicalJson(expectedReceipt) ||
      created.etag !== `"${recordDigest}"`
    ) {
      fail("durable lifecycle store create receipt is invalid");
    }
    const readback = await this._request(url, {
      method: "GET",
      expected: [200],
    });
    if (
      readback.replayed ||
      canonicalJson(readback.value) !== canonicalJson(expectedReceipt) ||
      readback.etag !== created.etag
    ) {
      fail("durable lifecycle store readback did not match the atomic receipt");
    }
    return true;
  }
}

export async function consumeLifecycleFromProtectedSink({
  request,
  contract,
  observedAt,
  sinkClient,
  storageAdapter,
}) {
  if (
    !sinkClient ||
    sinkClient.kind !== "authenticated-github-protected-sink-v1" ||
    typeof sinkClient.fetchAttestation !== "function"
  ) {
    fail("an authenticated protected-sink client is required");
  }
  if (
    !storageAdapter ||
    storageAdapter.kind !== "durable-lifecycle-consumption-v1" ||
    typeof storageAdapter.consume !== "function"
  ) {
    fail("a durable lifecycle storage adapter is required");
  }
  const path = lifecycleAttestationPath(request, contract);
  const fetched = await sinkClient.fetchAttestation({
    repository: request.attestationPolicy.sinkRepository,
    ref: request.attestationPolicy.sinkRef,
    path,
    requiredStatusCheck: contract.qualification.lifecycle.requiredStatusCheck,
  });
  const verificationTime = observedAt ?? new Date().toISOString();
  const candidate = verifyLifecycleAttestationCandidate(request, fetched.attestation, {
    contract,
    observedAt: verificationTime,
    sourceObservation: fetched.sourceObservation,
  });
  const consumed = await storageAdapter.consume(
    candidate.lifecycleKey,
    candidate.consumptionRecord,
  );
  return completeLifecycleConsumption(candidate, consumed);
}

function parseCli(argv) {
  if (argv[0] !== "consume") {
    fail("usage: cilicon-lifecycle-consumer.mjs consume");
  }
  const values = {};
  for (let index = 1; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (
      !["--contract", "--request", "--output-dir"].includes(flag) ||
      typeof value !== "string" ||
      value === ""
    ) {
      fail("lifecycle consumer arguments are invalid");
    }
    values[flag.slice(2)] = value;
  }
  if (Object.keys(values).length !== 3) {
    fail("--contract, --request, and --output-dir are required");
  }
  return values;
}

async function main(argv) {
  const values = parseCli(argv);
  const contract = JSON.parse(await readFile(values.contract, "utf8"));
  const request = JSON.parse(await readFile(values.request, "utf8"));
  const lifecycle = contract?.qualification?.lifecycle;
  if (!lifecycle?.consumerCredential) {
    fail("qualified lifecycle consumer credential is unavailable");
  }
  const sinkClient = new GitHubProtectedSinkClient({
    appId: lifecycle.consumerCredential.appId,
    installationId: lifecycle.consumerCredential.installationId,
    privateKeyPem: process.env.NIXMAC_E2E_LIFECYCLE_READER_PRIVATE_KEY,
    repository: lifecycle.consumerCredential.repository,
  });
  const storageAdapter = new HttpDurableLifecycleStore({
    baseUrl: process.env.NIXMAC_E2E_LIFECYCLE_STORE_URL,
    bearerToken: process.env.NIXMAC_E2E_LIFECYCLE_STORE_TOKEN,
  });
  const pathInSink = lifecycleAttestationPath(request, contract);
  const fetched = await sinkClient.fetchAttestation({
    repository: request.attestationPolicy.sinkRepository,
    ref: request.attestationPolicy.sinkRef,
    path: pathInSink,
    requiredStatusCheck: lifecycle.requiredStatusCheck,
  });
  const observedAt = new Date().toISOString();
  const candidate = verifyLifecycleAttestationCandidate(request, fetched.attestation, {
    contract,
    observedAt,
    sourceObservation: fetched.sourceObservation,
  });
  const consumed = await storageAdapter.consume(
    candidate.lifecycleKey,
    candidate.consumptionRecord,
  );
  const result = completeLifecycleConsumption(candidate, consumed);
  await mkdir(values["output-dir"], { recursive: true, mode: 0o700 });
  const outputs = {
    "lifecycle-attestation.json": fetched.attestation,
    "lifecycle-source-observation.json": fetched.sourceObservation,
    "lifecycle-consumption.json": result,
  };
  for (const [name, value] of Object.entries(outputs)) {
    await writeFile(path.join(values["output-dir"], name), `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
