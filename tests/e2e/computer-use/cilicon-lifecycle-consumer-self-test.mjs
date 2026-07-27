#!/usr/bin/env node

import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";

import {
  GitHubProtectedSinkClient,
  HttpDurableLifecycleStore,
} from "../../../ops/runner/cilicon-lifecycle-consumer.mjs";

const commit = "a".repeat(40);
const blobSha = "b".repeat(40);
const repository = "darkmatter/nixmac-e2e-attestations";
const sinkPath = `lifecycle/${"c".repeat(64)}.json`;
const attestation = {
  version: 1,
  result: "destroyed",
  provenance: {
    blobDigest: `sha256:${"d".repeat(64)}`,
  },
};
const encodedAttestation = Buffer.from(`${JSON.stringify(attestation)}\n`).toString("base64");
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" });
const githubCalls = [];
const branchProtection = {
  required_status_checks: {
    strict: true,
    contexts: ["verify-lifecycle-attestation"],
    checks: [{ context: "verify-lifecycle-attestation", app_id: 4004 }],
  },
  enforce_admins: { enabled: true },
  required_linear_history: { enabled: true },
  allow_force_pushes: { enabled: false },
  allow_deletions: { enabled: false },
  restrictions: {
    users: [],
    teams: [],
    apps: [{ id: 4004, slug: "nixmac-e2e-sink-writer" }],
  },
};

const githubFetch = async (url, options = {}) => {
  githubCalls.push({ url: String(url), options });
  const parsed = new URL(url);
  const json = (value, status = 200) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { "content-type": "application/json" },
    });
  if (parsed.pathname === "/app/installations/303") {
    return json({ id: 303, app_id: 3003, repository_selection: "selected" });
  }
  if (parsed.pathname === "/app/installations/303/access_tokens") {
    return json(
      {
        token: "installation-token",
        expires_at: "2026-07-26T19:30:00.000Z",
        permissions: {
          administration: "read",
          checks: "read",
          contents: "read",
        },
        repositories: [{ full_name: repository }],
      },
      201,
    );
  }
  assert.equal(options.headers.authorization, "Bearer installation-token");
  if (parsed.pathname.endsWith("/git/ref/heads/attestations")) {
    return json({
      ref: "refs/heads/attestations",
      object: { type: "commit", sha: commit },
    });
  }
  if (parsed.pathname.endsWith("/branches/attestations/protection")) {
    return json(branchProtection);
  }
  if (parsed.pathname.endsWith(`/commits/${commit}/check-runs`)) {
    return json({
      check_runs: [
        {
          name: "verify-lifecycle-attestation",
          head_sha: commit,
          status: "completed",
          conclusion: "success",
          app: { id: 4004 },
        },
      ],
    });
  }
  if (parsed.pathname.includes("/contents/")) {
    assert.equal(parsed.searchParams.get("ref"), commit);
    return json({
      type: "file",
      path: sinkPath,
      sha: blobSha,
      encoding: "base64",
      content: encodedAttestation,
    });
  }
  if (parsed.pathname.endsWith(`/git/blobs/${blobSha}`)) {
    return json({
      sha: blobSha,
      encoding: "base64",
      content: encodedAttestation,
    });
  }
  throw new Error(`unexpected GitHub request: ${parsed.pathname}`);
};

const sink = new GitHubProtectedSinkClient({
  appId: 3003,
  installationId: 303,
  privateKeyPem,
  repository,
  fetchImpl: githubFetch,
  now: () => new Date("2026-07-26T18:31:00.000Z"),
});
const fetched = await sink.fetchAttestation({
  repository,
  ref: "refs/heads/attestations",
  path: sinkPath,
  requiredStatusCheck: "verify-lifecycle-attestation",
  requiredStatusCheckAppId: 4004,
});
assert.deepEqual(fetched.attestation, attestation);
assert.deepEqual(fetched.sourceObservation, {
  repository,
  ref: "refs/heads/attestations",
  path: sinkPath,
  commit,
  blobSha,
  blobDigest: attestation.provenance.blobDigest,
  fetchedAt: "2026-07-26T18:31:00.000Z",
  authenticatedBy: {
    appId: 3003,
    installationId: 303,
  },
  branchProtectionVerified: true,
  readbackVerified: true,
  requiredStatusChecks: ["verify-lifecycle-attestation"],
  requiredStatusCheckAppId: 4004,
});
assert.match(githubCalls[0].options.headers.authorization, /^Bearer eyJ/);
assert.equal(githubCalls[0].options.redirect, "error");
assert.equal(githubCalls[1].options.method, "POST");
assert.deepEqual(JSON.parse(githubCalls[1].options.body), {
  repositories: ["nixmac-e2e-attestations"],
  permissions: {
    administration: "read",
    checks: "read",
    contents: "read",
  },
});

for (const [name, mutate] of [
  [
    "mutable writer App policy",
    (value) => {
      value.required_status_checks.checks[0].app_id = 9999;
    },
  ],
  [
    "force pushes enabled",
    (value) => {
      value.allow_force_pushes.enabled = true;
    },
  ],
  [
    "unrestricted push identity",
    (value) => {
      value.restrictions.apps = [];
    },
  ],
]) {
  const invalidProtectionFetch = async (url, options = {}) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith("/branches/attestations/protection")) {
      const value = structuredClone(branchProtection);
      mutate(value);
      return new Response(JSON.stringify(value), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return githubFetch(url, options);
  };
  const invalidProtectionSink = new GitHubProtectedSinkClient({
    appId: 3003,
    installationId: 303,
    privateKeyPem,
    repository,
    fetchImpl: invalidProtectionFetch,
    now: () => new Date("2026-07-26T18:31:00.000Z"),
  });
  await assert.rejects(
    invalidProtectionSink.fetchAttestation({
      repository,
      ref: "refs/heads/attestations",
      path: sinkPath,
      requiredStatusCheck: "verify-lifecycle-attestation",
      requiredStatusCheckAppId: 4004,
    }),
    /branch protection or required status policy/,
    name,
  );
}

const mismatchedCheckFetch = async (url, options = {}) => {
  const parsed = new URL(url);
  if (parsed.pathname.endsWith(`/commits/${commit}/check-runs`)) {
    return new Response(
      JSON.stringify({
        check_runs: [
          {
            name: "verify-lifecycle-attestation",
            head_sha: commit,
            status: "completed",
            conclusion: "success",
            app: { id: 9999 },
          },
        ],
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  }
  return githubFetch(url, options);
};
const mismatchedCheckSink = new GitHubProtectedSinkClient({
  appId: 3003,
  installationId: 303,
  privateKeyPem,
  repository,
  fetchImpl: mismatchedCheckFetch,
  now: () => new Date("2026-07-26T18:31:00.000Z"),
});
await assert.rejects(
  () =>
    mismatchedCheckSink.fetchAttestation({
      repository,
      ref: "refs/heads/attestations",
      path: sinkPath,
      requiredStatusCheck: "verify-lifecycle-attestation",
      requiredStatusCheckAppId: 4004,
    }),
  /required status check App identity/,
);

const lifecycleKey = "e".repeat(64);
const record = {
  observedAt: "2026-07-26T18:31:00.000Z",
  sinkCommit: commit,
  blobDigest: attestation.provenance.blobDigest,
};
let durableReceipt;
const storeCalls = [];
const storeFetch = async (url, options = {}) => {
  storeCalls.push({ url: String(url), options });
  if (options.method === "PUT") {
    const proposed = JSON.parse(options.body);
    durableReceipt = {
      ...proposed,
      durable: true,
      atomicCreate: true,
    };
    return new Response(JSON.stringify(durableReceipt), {
      status: 201,
      headers: {
        "content-type": "application/json",
        etag: `"${proposed.recordDigest}"`,
      },
    });
  }
  return new Response(JSON.stringify(durableReceipt), {
    status: 200,
    headers: {
      "content-type": "application/json",
      etag: `"${durableReceipt.recordDigest}"`,
    },
  });
};
const store = new HttpDurableLifecycleStore({
  baseUrl: "https://centaur-storage.example.invalid",
  bearerToken: "store-token",
  fetchImpl: storeFetch,
});
assert.equal(await store.consume(lifecycleKey, record), true);
assert.equal(storeCalls.length, 2, "atomic create must be followed by durable readback");
assert.equal(storeCalls[0].options.method, "PUT");
assert.equal(storeCalls[0].options.headers["if-none-match"], "*");
assert.equal(storeCalls[1].options.method, "GET");
assert.equal(storeCalls[0].options.headers.authorization, "Bearer store-token");

const replayStore = new HttpDurableLifecycleStore({
  baseUrl: "https://centaur-storage.example.invalid",
  bearerToken: "store-token",
  fetchImpl: async () => new Response("", { status: 412 }),
});
assert.equal(await replayStore.consume(lifecycleKey, record), false);
assert.throws(
  () =>
    new HttpDurableLifecycleStore({
      baseUrl: "http://centaur-storage.example.invalid",
      bearerToken: "store-token",
    }),
  /HTTPS/,
);

console.log("Cilicon lifecycle consumer self-test passed.");
