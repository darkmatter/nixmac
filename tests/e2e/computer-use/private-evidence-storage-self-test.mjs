#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { promises as fs } from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";

import {
  publishEvidence,
  R2EvidenceStore,
  signedHeaders,
  validateStorageReceipt,
} from "../../../ops/scripts/e2e/publish-private-evidence.mjs";

const mergeSha = "a".repeat(40);
const jobId = `darkmatter/nixmac:${mergeSha}:v1`;
const artifactDigest = `sha256:${"b".repeat(64)}`;
const sealedAt = "2026-07-27T12:34:56.789Z";

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

class FakeImmutableStore {
  constructor() {
    this.objects = new Map();
    this.writeCount = 0;
  }

  async ensureObject(key, source) {
    const bytes = source.bytesValue
      ? Buffer.from(source.bytesValue)
      : await fs.readFile(source.path);
    assert.equal(bytes.length, source.bytes);
    assert.equal(digest(bytes), source.digest);
    const candidate = {
      bytes,
      contentType: source.contentType,
      digest: source.digest,
    };
    const existing = this.objects.get(key);
    if (existing) {
      assert.equal(existing.digest, candidate.digest, `immutable conflict at ${key}`);
      assert.equal(existing.contentType, candidate.contentType);
    } else {
      this.objects.set(key, candidate);
      this.writeCount += 1;
    }
    return {
      key,
      digest: candidate.digest,
      bytes: candidate.bytes.length,
      contentType: candidate.contentType,
      etag: `"${candidate.digest.slice("sha256:".length)}"`,
    };
  }

  async get(key) {
    const object = this.objects.get(key);
    return object ? Buffer.from(object.bytes) : null;
  }
}

class CorruptReceiptReadbackStore extends FakeImmutableStore {
  constructor(mode) {
    super();
    this.mode = mode;
  }

  async get(key) {
    const bytes = await super.get(key);
    if (!bytes || !key.endsWith("/storage-receipt.json")) return bytes;
    if (this.mode === "truncated") return bytes.subarray(0, bytes.length - 1);
    if (this.mode === "divergent") {
      const divergent = Buffer.from(bytes);
      divergent[Math.floor(divergent.length / 2)] ^= 1;
      return divergent;
    }
    return bytes;
  }
}

class ScriptedR2Store extends R2EvidenceStore {
  constructor(responses) {
    super({
      endpoint: `https://${"c".repeat(32)}.r2.cloudflarestorage.com`,
      bucket: "nixmac-e2e-evidence",
      accessKeyId: "access-key",
      secretAccessKey: "secret-key",
    });
    this.responses = [...responses];
    this.calls = [];
  }

  async request(method, key, options = {}) {
    this.calls.push({ method, key, options });
    assert.ok(this.responses.length > 0, "unexpected scripted R2 request");
    const response = this.responses.shift();
    if (response instanceof Error) throw response;
    return response;
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function fixture(root) {
  const archivePath = path.join(root, "evidence.canonical.zip");
  const reportDir = path.join(root, "report");
  const archiveBytes = Buffer.from("canonical archive fixture\n");
  await fs.mkdir(reportDir, { recursive: true });
  await fs.writeFile(archivePath, archiveBytes);
  await fs.writeFile(
    `${archivePath}.sha256`,
    `${digest(archiveBytes).slice("sha256:".length)}  ${path.basename(archivePath)}\n`,
  );
  await fs.writeFile(path.join(reportDir, "index.html"), "<!doctype html><p>private evidence</p>\n");
  await writeJson(path.join(reportDir, "attempt.json"), {
    version: 1,
    jobId,
    number: 1,
    endedAt: sealedAt,
    evidencePrefix: `computer-use-e2e/jobs/${encodeURIComponent(jobId)}/attempt-1/`,
    finalized: true,
  });
  await writeJson(path.join(reportDir, "runner", "identity.json"), {
    version: 1,
    jobId,
    runnerBackend: "ephemeral_mac",
  });
  return { archivePath, reportDir };
}

async function publish(store, paths) {
  return await publishEvidence({
    archivePath: paths.archivePath,
    archiveDigestPath: `${paths.archivePath}.sha256`,
    reportDir: paths.reportDir,
    jobId,
    attempt: "1",
    backend: "ephemeral_mac",
    artifactId: "12345",
    artifactDigest,
    store,
  });
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), "nixmac-private-evidence-"));
try {
  const paths = await fixture(root);
  const store = new FakeImmutableStore();
  const first = await publish(store, paths);
  const firstWriteCount = store.writeCount;
  const second = await publish(store, paths);

  assert.deepEqual(second, first);
  assert.equal(store.writeCount, firstWriteCount, "idempotent replay must not write");
  assert.equal(
    first.reportUrl,
    `https://e2e-evidence.nixmac.com/${first.receipt.report.indexKey}`,
  );
  assert.equal(first.receipt.lock.minimumDays, 365);
  assert.equal(first.receipt.bucket, "nixmac-e2e-evidence");
  assert.equal(first.receipt.sealedAt, sealedAt);
  assert.equal(first.receipt.evidenceExpiresAt, "2027-07-27T12:34:56.789Z");
  assert.equal(first.receipt.archive.digest, digest(await fs.readFile(paths.archivePath)));
  assert.equal(first.receipt.report.objectCount, 3);
  assert.ok(store.objects.has(first.receiptKey), "receipt must be committed");
  validateStorageReceipt(first.receipt, first.receipt);
  assert.throws(
    () =>
      validateStorageReceipt(
        { ...first.receipt, backend: "static_ssh" },
        first.receipt,
      ),
    /does not match the immutable publication plan/,
    "receipt validation must reject a semantically divergent receipt",
  );

  await fs.writeFile(path.join(paths.reportDir, "index.html"), "<p>mutated</p>\n");
  await assert.rejects(
    publish(store, paths),
    /immutable conflict/,
    "same immutable prefix must reject conflicting content",
  );

  await fs.writeFile(path.join(paths.reportDir, "index.html"), "<p>restored</p>\n");
  await assert.rejects(
    publish(new CorruptReceiptReadbackStore("truncated"), paths),
    /missing or truncated/,
    "truncated receipt readback must fail closed",
  );
  await assert.rejects(
    publish(new CorruptReceiptReadbackStore("divergent"), paths),
    /digest is inconsistent/,
    "divergent receipt readback must fail closed",
  );
  const symlinkPath = path.join(paths.reportDir, "unsafe-link");
  await fs.symlink(path.join(paths.reportDir, "index.html"), symlinkPath);
  await assert.rejects(publish(new FakeImmutableStore(), paths), /unsafe entry/);
  await fs.unlink(symlinkPath);

  const signature = signedHeaders({
    method: "HEAD",
    endpoint: `https://${"c".repeat(32)}.r2.cloudflarestorage.com`,
    bucket: "nixmac-e2e-evidence",
    key: "v1/example",
    accessKeyId: "access-key",
    secretAccessKey: "secret-key",
    now: new Date("2026-07-27T00:00:00.000Z"),
  });
  assert.equal(signature["x-amz-date"], "20260727T000000Z");
  assert.equal(
    signature.authorization,
    "AWS4-HMAC-SHA256 Credential=access-key/20260727/auto/s3/aws4_request, " +
      "SignedHeaders=host;x-amz-content-sha256;x-amz-date, " +
      "Signature=fc3c05ca3c5d8abf635b23d74dc27403d661a4e2956357767a72543a692714d3",
  );
  assert.ok(!JSON.stringify(signature).includes("secret-key"));

  const objectBytes = Buffer.from("conditional object\n");
  const objectDigest = digest(objectBytes);
  const objectSource = {
    bytes: objectBytes.length,
    bytesValue: objectBytes,
    contentType: "application/json",
    digest: objectDigest,
    md5Base64: createHash("md5").update(objectBytes).digest("base64"),
  };
  const objectHeaders = {
    "content-length": String(objectBytes.length),
    "content-type": "application/json",
    "x-amz-meta-schema-version": "1",
    "x-amz-meta-sha256": objectDigest,
    etag: '"race-winner"',
  };
  const scriptedStore = new ScriptedR2Store([
    { status: 404, headers: {}, body: Buffer.alloc(0) },
    { status: 412, headers: {}, body: Buffer.alloc(0) },
    { status: 200, headers: objectHeaders, body: Buffer.alloc(0) },
  ]);
  const raceWinner = await scriptedStore.ensureObject("v1/test/object.json", objectSource);
  assert.equal(raceWinner.digest, objectDigest);
  assert.deepEqual(
    scriptedStore.calls.map(({ method }) => method),
    ["HEAD", "PUT", "HEAD"],
  );
  assert.equal(scriptedStore.calls[1].options.headers["if-none-match"], "*");
  assert.equal(
    scriptedStore.calls[1].options.payloadHash,
    objectDigest.slice("sha256:".length),
  );

  const conflictingStore = new ScriptedR2Store([
    {
      status: 200,
      headers: {
        ...objectHeaders,
        "x-amz-meta-sha256": `sha256:${"d".repeat(64)}`,
      },
      body: Buffer.alloc(0),
    },
  ]);
  await assert.rejects(
    conflictingStore.ensureObject("v1/test/object.json", objectSource),
    /readback conflicts with immutable content/,
    "production HEAD validation must reject immutable metadata conflicts",
  );

  const headFailureStore = new ScriptedR2Store([
    { status: 500, headers: {}, body: Buffer.alloc(0) },
  ]);
  await assert.rejects(
    headFailureStore.ensureObject("v1/test/object.json", objectSource),
    /R2 HEAD failed.*500/,
  );

  const putFailureStore = new ScriptedR2Store([
    { status: 404, headers: {}, body: Buffer.alloc(0) },
    { status: 403, headers: {}, body: Buffer.alloc(0) },
  ]);
  await assert.rejects(
    putFailureStore.ensureObject("v1/test/object.json", objectSource),
    /R2 conditional PUT failed.*403/,
  );

  const missingReadbackStore = new ScriptedR2Store([
    { status: 404, headers: {}, body: Buffer.alloc(0) },
    { status: 201, headers: {}, body: Buffer.alloc(0) },
    { status: 404, headers: {}, body: Buffer.alloc(0) },
  ]);
  await assert.rejects(
    missingReadbackStore.ensureObject("v1/test/object.json", objectSource),
    /R2 object is missing after conditional PUT/,
  );

  const timeoutStore = new ScriptedR2Store([new Error("R2 request timed out")]);
  await assert.rejects(
    timeoutStore.ensureObject("v1/test/object.json", objectSource),
    /R2 request timed out/,
  );

  const originalHttpsRequest = https.request;
  try {
    https.request = (_url, options) => {
      assert.equal(
        options.timeout,
        1,
        "production request must arm the configured HTTPS timeout",
      );
      const request = new EventEmitter();
      request.destroy = (error) => request.emit("error", error);
      request.end = () => queueMicrotask(() => request.emit("timeout"));
      return request;
    };
    const liveTimeoutStore = new R2EvidenceStore({
      endpoint: `https://${"c".repeat(32)}.r2.cloudflarestorage.com`,
      bucket: "nixmac-e2e-evidence",
      accessKeyId: "access-key",
      secretAccessKey: "secret-key",
      timeoutMs: 1,
    });
    await assert.rejects(
      liveTimeoutStore.request("HEAD", "v1/test/timeout.json", {
        payloadHash: createHash("sha256").update("").digest("hex"),
        maxBytes: 0,
      }),
      /R2 request timed out/,
      "production timeout event must destroy and reject the request",
    );

    https.request = (_url, _options, onResponse) => {
      const request = new EventEmitter();
      request.destroy = (error) => request.emit("error", error);
      request.end = () =>
        queueMicrotask(() => {
          const response = new EventEmitter();
          response.statusCode = 200;
          response.headers = {};
          onResponse(response);
          response.emit("data", Buffer.from("a"));
          response.emit("data", Buffer.from("b"));
          response.emit("end");
        });
      return request;
    };
    await assert.rejects(
      liveTimeoutStore.request("GET", "v1/test/oversized.json", {
        payloadHash: createHash("sha256").update("").digest("hex"),
        maxBytes: 1,
      }),
      /R2 response exceeds its bounded size/,
      "production response cap must accumulate chunks before rejecting oversized reads",
    );

    let uploadDestroyed = false;
    https.request = () => {
      const request = new EventEmitter();
      request.destroy = (error) => {
        uploadDestroyed = true;
        request.emit("error", error);
      };
      return request;
    };
    await assert.rejects(
      liveTimeoutStore.request("PUT", "v1/test/missing-upload.json", {
        body: path.join(root, "missing-upload.json"),
        payloadHash: createHash("sha256").update("missing").digest("hex"),
        maxBytes: 1,
      }),
      /ENOENT/,
      "upload stream failures must reject the request",
    );
    assert.equal(
      uploadDestroyed,
      true,
      "upload stream failures must destroy the in-flight HTTPS request",
    );
  } finally {
    https.request = originalHttpsRequest;
  }

  process.stdout.write("private evidence storage self-test passed\n");
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
