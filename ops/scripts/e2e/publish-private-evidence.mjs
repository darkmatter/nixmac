#!/usr/bin/env node

import {
  createHash,
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import {
  createReadStream,
  promises as fs,
} from "node:fs";
import https from "node:https";
import path from "node:path";
import { pathToFileURL } from "node:url";

const PROVIDER = "cloudflare-r2";
const SCHEMA_VERSION = 1;
const RETENTION_DAYS = 365;
const LOCK_RULE_ID = "nixmac-e2e-evidence-365d";
const DEFAULT_BUCKET = "nixmac-e2e-evidence";
const DEFAULT_VIEWER_ORIGIN = "https://e2e-evidence.nixmac.com";
const MAX_REPORT_FILES = 5000;
const MAX_REPORT_BYTES = 4 * 1024 * 1024 * 1024;
const MAX_RECEIPT_BYTES = 1024 * 1024;
const EMPTY_SHA256 = createHash("sha256").update("").digest("hex");

const SHA_RE = /^[0-9a-f]{40}$/;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const SUITE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const BUCKET_RE = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const LOCK_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function fail(message) {
  throw new Error(message);
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || String(number) !== String(value)) {
    fail(`${label} must be a positive integer`);
  }
  return number;
}

function parseJobId(jobId) {
  if (typeof jobId !== "string") fail("job_id must be a string");
  const parts = jobId.split(":");
  if (
    parts.length !== 3 ||
    parts[0] !== "darkmatter/nixmac" ||
    !SHA_RE.test(parts[1]) ||
    !SUITE_RE.test(parts[2])
  ) {
    fail("job_id is not the canonical nixmac E2E identity");
  }
  return { repo: parts[0], mergeSha: parts[1], suiteVersion: parts[2] };
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function canonicalBytes(value) {
  return Buffer.from(`${JSON.stringify(canonicalize(value))}\n`, "utf8");
}

function canonicalEqual(left, right) {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

function digestBytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function fileDigests(filePath) {
  const stat = await fs.lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1) {
    fail(`evidence object must be a non-empty direct file: ${filePath}`);
  }
  const sha = createHash("sha256");
  const md5 = createHash("md5");
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => {
      sha.update(chunk);
      md5.update(chunk);
    });
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return {
    bytes: stat.size,
    digest: `sha256:${sha.digest("hex")}`,
    md5Base64: md5.digest("base64"),
  };
}

function contentType(relativePath) {
  const extension = path.extname(relativePath).toLowerCase();
  const known = {
    ".css": "text/css; charset=utf-8",
    ".gif": "image/gif",
    ".html": "text/html; charset=utf-8",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json",
    ".m4v": "video/x-m4v",
    ".mp4": "video/mp4",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".txt": "text/plain; charset=utf-8",
    ".webm": "video/webm",
  };
  return known[extension] || "application/octet-stream";
}

async function collectReportFiles(reportDir) {
  const root = path.resolve(reportDir);
  const rootStat = await fs.lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    fail("report_dir must be a direct directory");
  }
  const files = [];
  let totalBytes = 0;

  async function walk(directory, relativeDirectory = "") {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      if (
        !entry.name ||
        entry.name === "." ||
        entry.name === ".." ||
        entry.name.includes("\\") ||
        entry.isSymbolicLink()
      ) {
        fail("report tree contains an unsafe entry");
      }
      const absolute = path.join(directory, entry.name);
      const relative = path.posix.join(relativeDirectory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute, relative);
        continue;
      }
      if (!entry.isFile() || relative === "viewer-manifest.json") {
        fail(`report tree contains an unsupported entry: ${relative}`);
      }
      const digests = await fileDigests(absolute);
      totalBytes += digests.bytes;
      if (files.length + 1 > MAX_REPORT_FILES || totalBytes > MAX_REPORT_BYTES) {
        fail("report tree exceeds its bounded size");
      }
      files.push({
        absolute,
        relative,
        contentType: contentType(relative),
        ...digests,
      });
    }
  }

  await walk(root);
  if (!files.some((file) => file.relative === "index.html")) {
    fail("report tree does not contain index.html");
  }
  if (!files.some((file) => file.relative === "attempt.json")) {
    fail("report tree does not contain attempt.json");
  }
  return { files, totalBytes };
}

async function readAttempt(reportDir, expected) {
  const root = path.resolve(reportDir);
  const attemptPath = path.join(root, "attempt.json");
  const identityPath = path.join(root, "runner", "identity.json");
  let attempt;
  let identity;
  try {
    [attempt, identity] = await Promise.all([
      fs.readFile(attemptPath, "utf8").then(JSON.parse),
      fs.readFile(identityPath, "utf8").then(JSON.parse),
    ]);
  } catch (error) {
    fail(`evidence identity sidecars are not valid JSON: ${error.message}`);
  }
  const expectedPrefix =
    `computer-use-e2e/jobs/${encodeURIComponent(expected.jobId)}/` +
    `attempt-${expected.attempt}/`;
  if (
    attempt.version !== SCHEMA_VERSION ||
    attempt.jobId !== expected.jobId ||
    attempt.number !== expected.attempt ||
    attempt.evidencePrefix !== expectedPrefix ||
    attempt.finalized !== true ||
    identity.version !== SCHEMA_VERSION ||
    identity.jobId !== expected.jobId ||
    identity.runnerBackend !== expected.backend
  ) {
    fail("evidence identity sidecars do not bind the storage identity");
  }
  const sealedAt = new Date(attempt.endedAt);
  if (!Number.isFinite(sealedAt.getTime()) || sealedAt.toISOString() !== attempt.endedAt) {
    fail("attempt.json endedAt must be a canonical ISO timestamp");
  }
  return { sealedAt: attempt.endedAt };
}

function addDays(isoTimestamp, days) {
  const date = new Date(isoTimestamp);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function normalizeOrigin(value) {
  const parsed = new URL(value);
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    fail("viewer origin must be one HTTPS origin");
  }
  return parsed.origin;
}

function normalizeEndpoint(value) {
  const parsed = new URL(value);
  if (
    parsed.protocol !== "https:" ||
    !/^[a-f0-9]{32}\.r2\.cloudflarestorage\.com$/.test(parsed.hostname) ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    (parsed.pathname !== "/" && parsed.pathname !== "") ||
    parsed.search ||
    parsed.hash
  ) {
    fail("R2 endpoint is not the account S3 origin");
  }
  return parsed.origin;
}

function encodePathSegment(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function canonicalUri(bucket, key) {
  return `/${encodePathSegment(bucket)}/${key
    .split("/")
    .map(encodePathSegment)
    .join("/")}`;
}

function hmac(key, value, encoding) {
  return createHmac("sha256", key).update(value, "utf8").digest(encoding);
}

function amzTimestamp(date = new Date()) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

export function signedHeaders({
  method,
  endpoint,
  bucket,
  key,
  accessKeyId,
  secretAccessKey,
  payloadHash = EMPTY_SHA256,
  headers = {},
  now = new Date(),
}) {
  const origin = new URL(endpoint);
  const requestHeaders = Object.fromEntries(
    Object.entries({
      ...headers,
      host: origin.host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzTimestamp(now),
    }).map(([name, value]) => [
      name.toLowerCase(),
      String(value).trim().replace(/\s+/g, " "),
    ]),
  );
  const names = Object.keys(requestHeaders).sort();
  const canonicalHeaders = names
    .map((name) => `${name}:${requestHeaders[name]}\n`)
    .join("");
  const signedHeaderNames = names.join(";");
  const canonicalRequest = [
    method,
    canonicalUri(bucket, key),
    "",
    canonicalHeaders,
    signedHeaderNames,
    payloadHash,
  ].join("\n");
  const date = requestHeaders["x-amz-date"].slice(0, 8);
  const scope = `${date}/auto/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    requestHeaders["x-amz-date"],
    scope,
    createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n");
  const dateKey = hmac(`AWS4${secretAccessKey}`, date);
  const regionKey = hmac(dateKey, "auto");
  const serviceKey = hmac(regionKey, "s3");
  const signingKey = hmac(serviceKey, "aws4_request");
  const signature = hmac(signingKey, stringToSign, "hex");
  return {
    ...requestHeaders,
    authorization:
      `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaderNames}, Signature=${signature}`,
  };
}

function normalizeHeaders(headers) {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key.toLowerCase(),
      Array.isArray(value) ? value.join(",") : String(value ?? ""),
    ]),
  );
}

export class R2EvidenceStore {
  constructor({
    endpoint,
    bucket,
    accessKeyId,
    secretAccessKey,
    timeoutMs = 60_000,
  }) {
    this.endpoint = normalizeEndpoint(endpoint);
    if (!BUCKET_RE.test(bucket)) fail("R2 bucket name is invalid");
    if (!accessKeyId || !secretAccessKey) fail("R2 credentials are required");
    this.bucket = bucket;
    this.accessKeyId = accessKeyId;
    this.secretAccessKey = secretAccessKey;
    this.timeoutMs = timeoutMs;
  }

  async request(method, key, { body, payloadHash, headers = {}, maxBytes = 0 } = {}) {
    if (
      !key ||
      key.startsWith("/") ||
      key.includes("\\") ||
      key.split("/").some((segment) => !segment || segment === "." || segment === "..")
    ) {
      fail("R2 object key is unsafe");
    }
    const url = new URL(canonicalUri(this.bucket, key), this.endpoint);
    const signed = signedHeaders({
      method,
      endpoint: this.endpoint,
      bucket: this.bucket,
      key,
      accessKeyId: this.accessKeyId,
      secretAccessKey: this.secretAccessKey,
      payloadHash,
      headers,
    });
    return await new Promise((resolve, reject) => {
      const request = https.request(
        url,
        {
          method,
          headers: signed,
          timeout: this.timeoutMs,
        },
        (response) => {
          const chunks = [];
          let bytes = 0;
          response.on("data", (chunk) => {
            bytes += chunk.length;
            if (bytes > maxBytes) {
              request.destroy(new Error("R2 response exceeds its bounded size"));
              return;
            }
            chunks.push(chunk);
          });
          response.on("error", reject);
          response.on("end", () => {
            resolve({
              status: response.statusCode,
              headers: normalizeHeaders(response.headers),
              body: Buffer.concat(chunks),
            });
          });
        },
      );
      request.on("timeout", () => request.destroy(new Error("R2 request timed out")));
      request.on("error", reject);
      if (Buffer.isBuffer(body)) {
        request.end(body);
      } else if (typeof body === "string") {
        const stream = createReadStream(body);
        stream.on("error", (error) => request.destroy(error));
        stream.pipe(request);
      } else {
        request.end();
      }
    });
  }

  async head(key) {
    const response = await this.request("HEAD", key, {
      payloadHash: EMPTY_SHA256,
      maxBytes: 0,
    });
    if (response.status === 404) return null;
    if (response.status !== 200) {
      fail(`R2 HEAD failed for ${key}: ${response.status}`);
    }
    return response.headers;
  }

  async get(key, maxBytes = MAX_RECEIPT_BYTES) {
    const response = await this.request("GET", key, {
      payloadHash: EMPTY_SHA256,
      maxBytes,
    });
    if (response.status === 404) return null;
    if (response.status !== 200) {
      fail(`R2 GET failed for ${key}: ${response.status}`);
    }
    return response.body;
  }

  validateHead(key, observed, expected) {
    if (
      observed["content-length"] !== String(expected.bytes) ||
      observed["content-type"] !== expected.contentType ||
      observed["x-amz-meta-sha256"] !== expected.digest ||
      observed["x-amz-meta-schema-version"] !== String(SCHEMA_VERSION)
    ) {
      fail(`R2 object readback conflicts with immutable content: ${key}`);
    }
    return {
      key,
      digest: expected.digest,
      bytes: expected.bytes,
      contentType: expected.contentType,
      etag: observed.etag || "",
    };
  }

  async ensureObject(key, source) {
    const observed = await this.head(key);
    if (observed) return this.validateHead(key, observed, source);
    const headers = {
      "cache-control": "private, no-store",
      "content-length": source.bytes,
      "content-md5": source.md5Base64,
      "content-type": source.contentType,
      "if-none-match": "*",
      "x-amz-meta-schema-version": SCHEMA_VERSION,
      "x-amz-meta-sha256": source.digest,
    };
    const response = await this.request("PUT", key, {
      body: source.path || source.bytesValue,
      payloadHash: source.digest.slice("sha256:".length),
      headers,
      maxBytes: 64 * 1024,
    });
    if (![200, 201, 412].includes(response.status)) {
      fail(`R2 conditional PUT failed for ${key}: ${response.status}`);
    }
    const readback = await this.head(key);
    if (!readback) fail(`R2 object is missing after conditional PUT: ${key}`);
    return this.validateHead(key, readback, source);
  }
}

function sourceFromBytes(bytes, contentTypeValue) {
  return {
    bytes: bytes.length,
    bytesValue: bytes,
    contentType: contentTypeValue,
    digest: digestBytes(bytes),
    md5Base64: createHash("md5").update(bytes).digest("base64"),
  };
}

function receiptIdentity(receipt) {
  return {
    schemaVersion: receipt.schemaVersion,
    provider: receipt.provider,
    bucket: receipt.bucket,
    lock: receipt.lock,
    jobId: receipt.jobId,
    attempt: receipt.attempt,
    backend: receipt.backend,
    githubArtifact: receipt.githubArtifact,
    sealedAt: receipt.sealedAt,
    evidenceExpiresAt: receipt.evidenceExpiresAt,
    objectPrefix: receipt.objectPrefix,
    archive: receipt.archive,
    report: receipt.report,
  };
}

export function validateStorageReceipt(receipt, expected) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    fail("storage receipt must be an object");
  }
  const value = receiptIdentity(receipt);
  const expectedKeys = [
    "archive",
    "attempt",
    "backend",
    "bucket",
    "evidenceExpiresAt",
    "githubArtifact",
    "jobId",
    "lock",
    "objectPrefix",
    "provider",
    "report",
    "schemaVersion",
    "sealedAt",
  ];
  if (
    Object.keys(receipt).sort().join(",") !== expectedKeys.sort().join(",") ||
    value.schemaVersion !== SCHEMA_VERSION ||
    value.provider !== PROVIDER ||
    value.bucket !== expected.bucket ||
    value.jobId !== expected.jobId ||
    value.attempt !== expected.attempt ||
    value.backend !== expected.backend ||
    value.objectPrefix !== expected.objectPrefix ||
    value.sealedAt !== expected.sealedAt ||
    value.evidenceExpiresAt !== addDays(expected.sealedAt, RETENTION_DAYS) ||
    !canonicalEqual(value.githubArtifact, expected.githubArtifact) ||
    !canonicalEqual(value.lock, { ruleId: LOCK_RULE_ID, minimumDays: RETENTION_DAYS }) ||
    !canonicalEqual(value.archive, expected.archive) ||
    !canonicalEqual(value.report, expected.report)
  ) {
    fail("storage receipt does not match the immutable publication plan");
  }
  return value;
}

export async function publishEvidence({
  archivePath,
  archiveDigestPath,
  reportDir,
  jobId,
  attempt,
  backend,
  artifactId,
  artifactDigest,
  bucket = DEFAULT_BUCKET,
  viewerOrigin = DEFAULT_VIEWER_ORIGIN,
  store,
}) {
  const identity = parseJobId(jobId);
  const attemptNumber = positiveInteger(attempt, "attempt");
  const artifactNumber = positiveInteger(artifactId, "artifact_id");
  if (!["static_ssh", "ephemeral_mac"].includes(backend)) fail("backend is invalid");
  if (!DIGEST_RE.test(artifactDigest)) fail("artifact_digest is invalid");
  if (!BUCKET_RE.test(bucket)) fail("bucket is invalid");
  const origin = normalizeOrigin(viewerOrigin);
  if (origin !== DEFAULT_VIEWER_ORIGIN) fail("viewer origin is not canonical");
  const canonicalArchivePath = path.resolve(archivePath);
  const canonicalDigestPath = path.resolve(archiveDigestPath);
  if (canonicalDigestPath !== `${canonicalArchivePath}.sha256`) {
    fail("canonical archive digest must be the fixed archive sibling");
  }
  const archive = await fileDigests(canonicalArchivePath);
  const digestStat = await fs.lstat(canonicalDigestPath);
  if (!digestStat.isFile() || digestStat.isSymbolicLink()) {
    fail("canonical archive digest sidecar must be a direct file");
  }
  const sidecarSource = await fs.readFile(canonicalDigestPath, "utf8");
  const sidecar = /^([0-9a-f]{64})  ([^\r\n]+)\n$/.exec(sidecarSource);
  if (
    !sidecar ||
    sidecar[2] !== path.basename(canonicalArchivePath) ||
    `sha256:${sidecar[1]}` !== archive.digest
  ) {
    fail("canonical archive digest sidecar does not match the archive");
  }
  const { files, totalBytes } = await collectReportFiles(reportDir);
  const { sealedAt } = await readAttempt(reportDir, {
    jobId,
    attempt: attemptNumber,
    backend,
  });
  const archiveHex = archive.digest.slice("sha256:".length);
  const objectPrefix =
    `v1/jobs/${identity.mergeSha}/${identity.suiteVersion}/` +
    `attempt-${attemptNumber}/${archiveHex}`;
  const archiveKey = `${objectPrefix}/evidence.canonical.zip`;
  const reportPrefix = `${objectPrefix}/report`;
  const receiptKey = `${objectPrefix}/storage-receipt.json`;
  const archiveObject = await store.ensureObject(archiveKey, {
    ...archive,
    path: canonicalArchivePath,
    contentType: "application/zip",
  });

  const reportObjects = [];
  for (const file of files) {
    const key = `${reportPrefix}/${file.relative}`;
    const uploaded = await store.ensureObject(key, {
      bytes: file.bytes,
      contentType: file.contentType,
      digest: file.digest,
      md5Base64: file.md5Base64,
      path: file.absolute,
    });
    reportObjects.push({
      relativePath: file.relative,
      key,
      digest: uploaded.digest,
      bytes: uploaded.bytes,
      contentType: uploaded.contentType,
    });
  }
  const viewerManifest = {
    schemaVersion: SCHEMA_VERSION,
    jobId,
    attempt: attemptNumber,
    archiveDigest: archive.digest,
    objects: reportObjects,
  };
  const viewerManifestBytes = canonicalBytes(viewerManifest);
  const viewerManifestKey = `${reportPrefix}/viewer-manifest.json`;
  const viewerManifestObject = await store.ensureObject(
    viewerManifestKey,
    sourceFromBytes(viewerManifestBytes, "application/json"),
  );
  const reportUrl = `${origin}/${reportPrefix}/index.html`;
  const expectedReceipt = {
    schemaVersion: SCHEMA_VERSION,
    provider: PROVIDER,
    bucket,
    lock: { ruleId: LOCK_RULE_ID, minimumDays: RETENTION_DAYS },
    jobId,
    attempt: attemptNumber,
    backend,
    githubArtifact: {
      id: artifactNumber,
      digest: artifactDigest,
    },
    sealedAt,
    evidenceExpiresAt: addDays(sealedAt, RETENTION_DAYS),
    objectPrefix,
    archive: {
      key: archiveObject.key,
      digest: archiveObject.digest,
      bytes: archiveObject.bytes,
    },
    report: {
      indexKey: `${reportPrefix}/index.html`,
      url: reportUrl,
      manifestKey: viewerManifestObject.key,
      manifestDigest: viewerManifestObject.digest,
      objectCount: reportObjects.length,
      totalBytes,
    },
  };
  const receiptBytes = canonicalBytes(expectedReceipt);
  const receiptObject = await store.ensureObject(
    receiptKey,
    sourceFromBytes(receiptBytes, "application/json"),
  );
  const existingBytes = await store.get(receiptKey, MAX_RECEIPT_BYTES);
  if (!existingBytes || existingBytes.length !== receiptBytes.length) {
    fail("storage receipt readback is missing or truncated");
  }
  if (
    !timingSafeEqual(
      createHash("sha256").update(existingBytes).digest(),
      createHash("sha256").update(receiptBytes).digest(),
    )
  ) {
    fail("storage receipt readback digest is inconsistent");
  }
  let observedReceipt;
  try {
    observedReceipt = JSON.parse(existingBytes);
  } catch {
    fail("storage receipt readback is not JSON");
  }
  const receipt = validateStorageReceipt(observedReceipt, expectedReceipt);
  return {
    receipt,
    receiptKey,
    receiptDigest: receiptObject.digest,
    reportUrl,
  };
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      fail("publish arguments must be --name value pairs");
    }
    values[key.slice(2)] = value;
  }
  return values;
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) fail(`${name} is required`);
  return value;
}

async function appendOutputs(outputPath, result) {
  const receipt = result.receipt;
  const values = {
    report_url: result.reportUrl,
    storage_receipt_key: result.receiptKey,
    storage_receipt_digest: result.receiptDigest,
    storage_bucket: receipt.bucket,
    storage_archive_key: receipt.archive.key,
    storage_archive_digest: receipt.archive.digest,
    storage_archive_bytes: receipt.archive.bytes,
    storage_manifest_key: receipt.report.manifestKey,
    storage_manifest_digest: receipt.report.manifestDigest,
    evidence_expires_at: receipt.evidenceExpiresAt,
  };
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}\n`);
  await fs.appendFile(outputPath, lines.join(""), { mode: 0o600 });
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (command !== "publish") fail("usage: publish-private-evidence.mjs publish ...");
  const args = parseArgs(rest);
  const bucket = requireEnv("E2E_EVIDENCE_R2_BUCKET");
  if (bucket !== DEFAULT_BUCKET) fail("evidence bucket is not canonical");
  if (requireEnv("E2E_EVIDENCE_LOCK_RULE_ID") !== LOCK_RULE_ID) {
    fail("evidence bucket lock rule is not canonical");
  }
  if (requireEnv("E2E_EVIDENCE_RETENTION_DAYS") !== String(RETENTION_DAYS)) {
    fail("evidence retention is not canonical");
  }
  const store = new R2EvidenceStore({
    endpoint: requireEnv("E2E_EVIDENCE_R2_ENDPOINT"),
    bucket,
    accessKeyId: requireEnv("E2E_EVIDENCE_R2_ACCESS_KEY_ID"),
    secretAccessKey: requireEnv("E2E_EVIDENCE_R2_SECRET_ACCESS_KEY"),
  });
  const result = await publishEvidence({
    archivePath: args.archive,
    archiveDigestPath: args["archive-digest"],
    reportDir: args["report-dir"],
    jobId: args["job-id"],
    attempt: args.attempt,
    backend: args.backend,
    artifactId: args["artifact-id"],
    artifactDigest: args["artifact-digest"],
    bucket,
    viewerOrigin: requireEnv("E2E_EVIDENCE_VIEWER_ORIGIN"),
    store,
  });
  await appendOutputs(args.output, result);
  process.stdout.write(
    JSON.stringify({
      ok: true,
      receiptKey: result.receiptKey,
      receiptDigest: result.receiptDigest,
      reportUrl: result.reportUrl,
    }) + "\n",
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`private evidence publication failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
