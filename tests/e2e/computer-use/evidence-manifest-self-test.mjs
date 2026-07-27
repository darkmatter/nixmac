#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import {
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { hashCuaBundleTree } from "./drivers/cua-driver.mjs";
import * as evidenceGuard from "./evidence-guard.mjs";
import { createEvidenceManifest, verifyEvidenceManifest } from "./evidence-manifest.mjs";
import * as evidenceManifest from "./evidence-manifest.mjs";
import * as runMetadata from "./run-metadata.mjs";
import {
  assertRunPreflight,
  createControllerCleanupProbe,
  finalizeControllerEvidence,
  finalizeLocalEvidence as finalizeLocalEvidenceProduction,
  preflightInputFromEnvironment,
  resolveRunPreflightIdentity,
  stageControllerEvidence,
  transitionRunAttempt,
  writeControllerFinalization,
  writeRunCleanup,
  writeRunPreflight,
} from "./run-metadata.mjs";
import { assertCuratedSafeFrameVideoMetadata, safeFrameVideoPath } from "./report.mjs";
import { prepareSuiteDriver, renderSuiteErrorReport } from "./run-remote-cua.mjs";
import { suiteContract } from "./suite-contract.mjs";
import { addEvent, saveState } from "./state.mjs";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);
const DIGEST_C = "c".repeat(64);
const ATTESTATION_NONCE = "n".repeat(64);
const VALID_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAACXBIWXMAAAABAAAAAQBPJcTWAAAAFElEQVR4nGNkIBGwjGoY1TB8NQAAYgAAPn161xsAAAAASUVORK5CYII=";
let fixtureSequence = 0;
let validMp4Fixture = null;

function validScenarioFixture() {
  return Object.fromEntries(
    suiteContract.requiredScenarioKeys.map((key) => [
      key,
      {
        accessibilityRisk: "none",
        accessibilityRiskReason: "The fixture has no accessibility-specific risk.",
        assertionTypes: ["fixture"],
        evidenceStrength: "strong",
        evidenceStrengthReason: "The fixture supplies deterministic evidence.",
        failureClass: "none",
        failureClassReason: "The fixture scenario passed.",
        label: key,
        notes: ["Deterministic fixture scenario."],
        status: key === "reportInspection" ? "not_required" : "pass",
      },
    ]),
  );
}

async function waitForPath(filePath, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await lstat(filePath);
      return;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    if (Date.now() >= deadline) {
      throw new Error(`timed out waiting for test path: ${filePath}`);
    }
    await delay(10);
  }
}

async function writeValidMediaFixtures(runDir) {
  const screenshotPath = path.join(runDir, "screenshots", "launch.png");
  const videoPath = path.join(runDir, "video", "computer-use-evidence.mp4");
  await writeFile(screenshotPath, Buffer.from(VALID_PNG_BASE64, "base64"));
  if (!validMp4Fixture) {
    const generated = spawnSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-loop",
        "1",
        "-i",
        screenshotPath,
        "-t",
        "0.04",
        "-r",
        "1",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        videoPath,
      ],
      { encoding: "utf8", timeout: 10_000 },
    );
    assert.equal(generated.status, 0, generated.stderr || generated.error?.message);
    validMp4Fixture = await readFile(videoPath);
  } else {
    await writeFile(videoPath, validMp4Fixture);
  }
}

function validPreflight(appBundlePath) {
  const jobId = `darkmatter/nixmac:${SHA_A}:computer-use-v1`;
  const stagingParent = path.dirname(appBundlePath);
  const daemonSocketDirectory = path.join(
    path.dirname(stagingParent),
    `nx-cua-${path.basename(stagingParent)}`,
  );
  return {
    jobId,
    repo: "darkmatter/nixmac",
    mergeSha: SHA_A,
    appArtifactSha: SHA_A,
    suiteVersion: "computer-use-v1",
    harnessSha: SHA_B,
    actionsRunId: "123456",
    actionsJobId: "789012",
    attemptNumber: 1,
    attestationNonceDigest: `sha256:${createHash("sha256")
      .update(ATTESTATION_NONCE)
      .digest("hex")}`,
    runnerName: "mac-e2e-01",
    runnerBackend: "ephemeral_mac",
    runnerImageDigest: `sha256:${DIGEST_A}`,
    buildRunId: "456789",
    artifactId: "987654",
    artifactDigest: `sha256:${DIGEST_B}`,
    stagingParent,
    appBundlePath,
    appBundleDigest: DIGEST_C,
    disposableConfigPath: path.join(stagingParent, "config"),
    daemonSocketDirectory,
    daemonSocketPath: path.join(daemonSocketDirectory, "d.sock"),
    cuaDriverCliVersion: "0.12.6",
    cuaDriverAppVersion: "0.12.6",
    captureMode: "safe-frame",
    finalizationMode: "local-finalize",
    accessibilityGranted: true,
    screenRecordingGranted: true,
    startedAt: "2026-07-26T00:00:00.000Z",
    evidencePrefix: `computer-use-e2e/jobs/${encodeURIComponent(jobId)}/attempt-1/`,
  };
}

async function createEvidenceFixture(
  root,
  { backend = "ephemeral_mac", writePreflight = true } = {},
) {
  fixtureSequence += 1;
  const runDir = path.join(root, `run-${fixtureSequence}-${backend}`);
  const stagingParent = path.join(root, `staging-${fixtureSequence}-${backend}`);
  const appBundlePath = path.join(stagingParent, "nixmac.app");
  await mkdir(path.join(appBundlePath, "Contents"), { recursive: true });
  await writeFile(path.join(appBundlePath, "Contents", "Info.plist"), "fixture app\n");
  await mkdir(path.join(stagingParent, "config"), { recursive: true });
  await mkdir(path.join(runDir, "screenshots"), { recursive: true });
  await mkdir(path.join(runDir, "texts"), { recursive: true });
  await mkdir(path.join(runDir, "video"), { recursive: true });
  await writeValidMediaFixtures(runDir);
  await writeFile(path.join(runDir, "texts", "launch.txt"), "safe text fixture\n");
  await writeFile(
    path.join(runDir, "events.json"),
    '[{"ts":"2026-07-26T00:00:00.000Z","type":"fixture"}]\n',
  );
  await writeFile(
    path.join(runDir, "state.json"),
    `${JSON.stringify(
      {
        verdict: "pass",
        scenarios: validScenarioFixture(),
        screenshots: [{ path: "screenshots/launch.png" }],
        textSnapshots: [{ path: "texts/launch.txt" }],
        video: {
          status: "available",
          path: "video/computer-use-evidence.mp4",
          source: "curated-safe-frames",
        },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(path.join(runDir, "index.html"), "<html>fixture report</html>\n");
  const input = {
    ...validPreflight(appBundlePath),
    daemonSocketDirectory: `/private/tmp/nx-cua-fixture-${fixtureSequence}`,
    daemonSocketPath: `/private/tmp/nx-cua-fixture-${fixtureSequence}/d.sock`,
    runnerBackend: backend,
    finalizationMode: backend === "static_ssh" ? "controller-finalize" : "local-finalize",
  };
  if (writePreflight) await writeRunPreflight(runDir, input);
  return { appBundlePath, input, runDir };
}

function cleanCleanup(fixture, { mode = "local" } = {}) {
  const stagingParent = fixture.input.stagingParent;
  const pathKind = mode === "local" ? "staging-parent" : "remote-staging";
  return {
    ownershipMode: mode === "local" ? "local-ephemeral" : "controller-static",
    attempted: true,
    restored: true,
    clean: true,
    startedAt: "2026-07-26T00:04:00.000Z",
    completedAt: "2026-07-26T00:05:00.000Z",
    ownedPaths: [
      {
        kind: pathKind,
        path: stagingParent,
        expectedFinalState: "absent",
        observedFinalState: "absent",
      },
      {
        kind: "app-bundle",
        path: fixture.input.appBundlePath,
        expectedFinalState: "absent",
        observedFinalState: "absent",
      },
      {
        kind: mode === "local" ? "disposable-config" : "remote-config",
        path: fixture.input.disposableConfigPath,
        expectedFinalState: "absent",
        observedFinalState: "absent",
      },
      {
        kind: "daemon-socket-directory",
        path: fixture.input.daemonSocketDirectory,
        expectedFinalState: "absent",
        observedFinalState: "absent",
      },
      {
        kind: "daemon-socket",
        path: fixture.input.daemonSocketPath,
        expectedFinalState: "absent",
        observedFinalState: "absent",
      },
    ],
    processInstances: [
      {
        role: "target",
        status: "owned",
        pid: 123,
        birthMarker: "100.000001",
        executable: path.join(fixture.input.appBundlePath, "Contents", "MacOS", "nixmac"),
        terminated: true,
      },
      {
        role: "daemon",
        status: "owned",
        pid: 456,
        birthMarker: "100.000002",
        executable: "/Applications/CuaDriver.app/Contents/MacOS/cua-driver",
        terminated: true,
      },
    ],
    remainingProcesses: [],
    failureReason: "",
    lifecycle: {
      driverCloseAttempted: true,
      driverClosed: true,
      ownershipMatched: true,
      pathsProbed: true,
      processesProbed: true,
    },
  };
}

function finalizeLocalEvidence(runDir, options) {
  return finalizeLocalEvidenceProduction(runDir, options, {
    pathExists: async () => false,
    processExists: async () => false,
  });
}

const TRUSTED_OWNER_TOKEN = "trusted-owner-token-job-123";

function releasedLease() {
  const ownerHash = createHash("sha256").update(TRUSTED_OWNER_TOKEN).digest("hex");
  return {
    acquired: true,
    released: true,
    repo: "darkmatter/nixmac",
    jobId: `darkmatter/nixmac:${SHA_A}:computer-use-v1`,
    attempt: 1,
    host: "mac-e2e-01",
    acquiredOwnerTokenHash: ownerHash,
    releasedOwnerTokenHash: ownerHash,
    acquiredAt: "2026-07-26T00:00:00.000Z",
    releasedAt: "2026-07-26T00:05:00.000Z",
    lastHeartbeatAt: "2026-07-26T00:04:30.000Z",
    waitReason: "",
    quarantineReason: "",
  };
}

function controllerCleanupProbe(fixture, cleanup) {
  return createControllerCleanupProbe({
    cleanup: { version: 1, ...cleanup },
    repo: fixture.input.repo,
    jobId: fixture.input.jobId,
    attempt: fixture.input.attemptNumber,
    host: fixture.input.runnerName,
    trustedOwnerToken: TRUSTED_OWNER_TOKEN,
  });
}

async function runSelfTest() {
  assert.equal(
    typeof evidenceManifest.createCanonicalEvidenceArchive,
    "function",
    "finalization must produce a canonical archive instead of claiming the mutable tree stays verified",
  );
  assert.equal(
    typeof evidenceManifest.verifyCanonicalEvidenceArchive,
    "function",
    "canonical evidence must be verified independently from the mutable source tree",
  );
  const sharedCaseBytes = await readFile(new URL("./fixtures/cases.json", import.meta.url));
  assert.equal(
    createHash("sha256").update(sharedCaseBytes).digest("hex"),
    "ea493777018c7ff31cafc5f6834a4d172db04d0a2c07f72ae9977eda33e45293",
    "the language-neutral verifier cases declaration must remain immutable",
  );
  const sharedCases = JSON.parse(sharedCaseBytes);
  const requiredNodeCases = sharedCases.cases
    .filter((item) => item.node_compatible)
    .map((item) => item.name)
    .sort();
  const executedNodeCases = new Set();
  const canonicalJobId = `darkmatter/nixmac:${SHA_A}:computer-use-v1`;
  const identityEnv = {
    GITHUB_REPOSITORY: "darkmatter/nixmac",
    NIXMAC_E2E_JOB_ID: canonicalJobId,
    NIXMAC_E2E_REPO: "darkmatter/nixmac",
    NIXMAC_E2E_MERGE_SHA: SHA_A,
    NIXMAC_E2E_SUITE_VERSION: "computer-use-v1",
    NIXMAC_E2E_HARNESS_SHA: SHA_B,
    NIXMAC_E2E_APP_ARTIFACT_SHA: SHA_A,
    NIXMAC_E2E_ACTIONS_RUN_ID: "123456",
    NIXMAC_E2E_ACTIONS_JOB_ID: "789012",
    NIXMAC_E2E_ATTEMPT: "1",
    NIXMAC_E2E_ATTESTATION_NONCE: ATTESTATION_NONCE,
    NIXMAC_E2E_RUNNER_NAME: "mac-e2e-01",
    NIXMAC_E2E_RUNNER_BACKEND: "ephemeral_mac",
    NIXMAC_E2E_RUNNER_IMAGE_DIGEST: `sha256:${DIGEST_A}`,
    NIXMAC_E2E_BUILD_RUN_ID: "456789",
    NIXMAC_E2E_ARTIFACT_ID: "987654",
    NIXMAC_E2E_ARTIFACT_DIGEST: `sha256:${DIGEST_B}`,
    NIXMAC_E2E_FINALIZATION_MODE: "local-finalize",
    NIXMAC_E2E_ATTEMPT_STARTED_AT: "2026-07-26T00:00:00.000Z",
    NIXMAC_E2E_STAGING_PARENT: "/private/tmp/nixmac-e2e-staging/job-123",
    NIXMAC_E2E_DISPOSABLE_CONFIG_PATH: "/private/tmp/nixmac-e2e-staging/job-123/config",
    NIXMAC_E2E_DAEMON_SOCKET_DIRECTORY: "/private/tmp/nx-cua-job-123",
    NIXMAC_E2E_DAEMON_SOCKET_PATH: "/private/tmp/nx-cua-job-123/d.sock",
  };
  const resolvedIdentity = await resolveRunPreflightIdentity(
    {
      env: identityEnv,
      appBundlePath: "/private/tmp/nixmac-e2e-staging/job-123/nixmac.app",
      appBundleDigest: DIGEST_C,
      cuaDriverCliVersion: "0.12.6",
      cuaDriverAppVersion: "0.12.6",
      accessibilityGranted: true,
      screenRecordingGranted: true,
    },
    {
      probeHarnessSha: async () => SHA_B,
      probeRunnerIdentity: async () => ({
        name: "mac-e2e-01",
        backend: "ephemeral_mac",
        imageDigest: `sha256:${DIGEST_A}`,
      }),
      probeArtifactIdentity: async () => ({
        artifactId: "987654",
        artifactDigest: `sha256:${DIGEST_B}`,
        buildRunId: "456789",
        mergeSha: SHA_A,
        appBundleDigest: DIGEST_C,
        verified: true,
      }),
    },
  );
  assert.equal(resolvedIdentity.jobId, canonicalJobId);
  assert.equal(resolvedIdentity.appArtifactSha, resolvedIdentity.mergeSha);
  for (const [label, mutateEnv, mutateProbe, expected] of [
    ["canonical job", { NIXMAC_E2E_JOB_ID: "job-123" }, {}, /canonical jobId/i],
    [
      "repository",
      {
        NIXMAC_E2E_REPO: "other/nixmac",
        NIXMAC_E2E_JOB_ID: `other/nixmac:${SHA_A}:computer-use-v1`,
      },
      {},
      /repository/i,
    ],
    ["app artifact SHA", { NIXMAC_E2E_APP_ARTIFACT_SHA: SHA_B }, {}, /artifact SHA/i],
    ["harness", {}, { harnessSha: SHA_A }, /harness SHA/i],
    ["runner name", {}, { runnerName: "other-runner" }, /runner name/i],
    ["runner backend", {}, { runnerBackend: "static_ssh" }, /runner backend/i],
    ["runner image", {}, { runnerImageDigest: `sha256:${DIGEST_C}` }, /runner image/i],
    ["artifact ID", {}, { artifactId: "other-artifact" }, /artifact ID/i],
    ["artifact digest", {}, { artifactDigest: `sha256:${DIGEST_C}` }, /artifact digest/i],
    [
      "verified app bundle digest",
      {},
      { appBundleDigest: DIGEST_A },
      /verified app bundle digest/i,
    ],
  ]) {
    let prepareCalls = 0;
    const runnerProbe = {
      name: mutateProbe.runnerName || "mac-e2e-01",
      backend: mutateProbe.runnerBackend || "ephemeral_mac",
      imageDigest: mutateProbe.runnerImageDigest || `sha256:${DIGEST_A}`,
    };
    const artifactProbe = {
      artifactId: mutateProbe.artifactId || "987654",
      artifactDigest: mutateProbe.artifactDigest || `sha256:${DIGEST_B}`,
      buildRunId: "456789",
      mergeSha: SHA_A,
      appBundleDigest: mutateProbe.appBundleDigest || DIGEST_C,
      verified: true,
    };
    await assert.rejects(
      () =>
        prepareSuiteDriver(
          {
            async connect() {},
            async prepareTarget() {
              prepareCalls += 1;
            },
          },
          {
            executionTopology: "local-cua-driver",
            appBundleId: "com.darkmatter.nixmac",
            localPreflight: {
              appPath: "/private/tmp/nixmac-e2e-staging/job-123/nixmac.app",
            },
            beforePrepareTarget: () =>
              resolveRunPreflightIdentity(
                {
                  env: { ...identityEnv, ...mutateEnv },
                  appBundlePath: "/private/tmp/nixmac-e2e-staging/job-123/nixmac.app",
                  appBundleDigest: DIGEST_C,
                  cuaDriverCliVersion: "0.12.6",
                  cuaDriverAppVersion: "0.12.6",
                  accessibilityGranted: true,
                  screenRecordingGranted: true,
                },
                {
                  probeHarnessSha: async () => mutateProbe.harnessSha || SHA_B,
                  probeRunnerIdentity: async () => runnerProbe,
                  probeArtifactIdentity: async () => artifactProbe,
                },
              ),
          },
        ),
      expected,
      label,
    );
    assert.equal(prepareCalls, 0, `${label} mismatch must not prepare UI`);
  }
  assert.equal(safeFrameVideoPath, "video/computer-use-evidence.mp4");
  assert.deepEqual(
    assertCuratedSafeFrameVideoMetadata({
      status: "available",
      path: safeFrameVideoPath,
      source: "curated-safe-frames",
    }),
    {
      status: "available",
      path: safeFrameVideoPath,
      source: "curated-safe-frames",
    },
  );
  assert.throws(
    () =>
      assertCuratedSafeFrameVideoMetadata({
        status: "available",
        path: "video/raw.mp4",
        source: "screen-recording",
      }),
    /curated safe-frame/i,
  );
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "nixmac-evidence-manifest-")));
  try {
    const valid = await createEvidenceFixture(root);
    const asserted = await assertRunPreflight(valid.runDir, {
      computeAppBundleDigest: async () => DIGEST_C,
    });
    assert.equal(asserted.app.appBundleDigest, DIGEST_C);
    assert.equal(
      typeof runMetadata.assertRunPostRunIdentity,
      "function",
      "phase-aware post-run identity revalidation must be exported",
    );
    const assertRunPostRunIdentity = runMetadata.assertRunPostRunIdentity;

    const progressed = await createEvidenceFixture(root);
    await transitionRunAttempt(progressed.runDir, "RUNNING", {
      at: "2026-07-26T00:01:00.000Z",
    });
    await assert.rejects(
      () =>
        assertRunPreflight(progressed.runDir, {
          computeAppBundleDigest: async () => DIGEST_C,
        }),
      /preflight|before UI|READY/i,
      "strict pre-UI validation must stay fail-closed after the UI lifecycle starts",
    );
    assert.equal(
      (
        await assertRunPostRunIdentity(progressed.runDir, {
          computeAppBundleDigest: async () => DIGEST_C,
        })
      ).attempt.lifecycle.current,
      "RUNNING",
    );
    await transitionRunAttempt(progressed.runDir, "UPLOADING", {
      at: "2026-07-26T00:02:00.000Z",
    });
    assert.equal(
      (
        await assertRunPostRunIdentity(progressed.runDir, {
          computeAppBundleDigest: async () => DIGEST_C,
        })
      ).attempt.lifecycle.current,
      "UPLOADING",
      "post-run identity revalidation must accept the exact progressed lifecycle",
    );

    const sidecarPaths = [
      "runner/identity.json",
      "runner/permissions.json",
      "artifact/source.json",
      "attempt.json",
    ];
    for (const relativePath of sidecarPaths) {
      assert.ok(
        (await readFile(path.join(valid.runDir, relativePath), "utf8")).trim(),
        `${relativePath} should be written before UI`,
      );
    }

    const requiredFields = Object.keys(valid.input);
    for (const field of requiredFields) {
      const fixture = await createEvidenceFixture(root);
      await rm(fixture.runDir, { recursive: true, force: true });
      await mkdir(fixture.runDir, { recursive: true });
      const invalid = { ...fixture.input };
      delete invalid[field];
      let prepareCalls = 0;
      const driver = {
        async connect() {},
        async prepareTarget() {
          prepareCalls += 1;
        },
      };
      await assert.rejects(
        () =>
          prepareSuiteDriver(driver, {
            executionTopology: "local-cua-driver",
            appBundleId: "com.darkmatter.nixmac",
            localPreflight: { appPath: fixture.appBundlePath },
            beforePrepareTarget: async () => {
              await writeRunPreflight(fixture.runDir, invalid);
              await assertRunPreflight(fixture.runDir, {
                computeAppBundleDigest: async () => DIGEST_C,
              });
            },
          }),
        new RegExp(field, "i"),
        `${field} must fail closed before target preparation`,
      );
      assert.equal(prepareCalls, 0, `${field} must not reach prepareTarget`);
    }

    for (const permission of ["accessibilityGranted", "screenRecordingGranted"]) {
      const fixture = await createEvidenceFixture(root);
      await rm(fixture.runDir, { recursive: true, force: true });
      await mkdir(fixture.runDir, { recursive: true });
      let prepareCalls = 0;
      await assert.rejects(
        () =>
          prepareSuiteDriver(
            {
              async connect() {},
              async prepareTarget() {
                prepareCalls += 1;
              },
            },
            {
              executionTopology: "local-cua-driver",
              appBundleId: "com.darkmatter.nixmac",
              localPreflight: { appPath: fixture.appBundlePath },
              beforePrepareTarget: async () => {
                await writeRunPreflight(fixture.runDir, {
                  ...fixture.input,
                  [permission]: false,
                });
              },
            },
          ),
        new RegExp(permission, "i"),
      );
      assert.equal(prepareCalls, 0, `${permission}=false must not reach prepareTarget`);
    }

    const envInput = preflightInputFromEnvironment({
      env: {
        NIXMAC_E2E_JOB_ID: valid.input.jobId,
        NIXMAC_E2E_REPO: "darkmatter/nixmac",
        NIXMAC_E2E_MERGE_SHA: SHA_A,
        NIXMAC_E2E_APP_ARTIFACT_SHA: SHA_A,
        NIXMAC_E2E_SUITE_VERSION: "computer-use-v1",
        NIXMAC_E2E_HARNESS_SHA: SHA_B,
        NIXMAC_E2E_ACTIONS_RUN_ID: "123456",
        NIXMAC_E2E_ACTIONS_JOB_ID: "789012",
        NIXMAC_E2E_ATTEMPT: "1",
        NIXMAC_E2E_ATTESTATION_NONCE: ATTESTATION_NONCE,
        NIXMAC_E2E_RUNNER_NAME: "mac-e2e-01",
        NIXMAC_E2E_RUNNER_BACKEND: "ephemeral_mac",
        NIXMAC_E2E_RUNNER_IMAGE_DIGEST: `sha256:${DIGEST_A}`,
        NIXMAC_E2E_BUILD_RUN_ID: "456789",
        NIXMAC_E2E_ARTIFACT_ID: "987654",
        NIXMAC_E2E_ARTIFACT_DIGEST: `sha256:${DIGEST_B}`,
        NIXMAC_E2E_FINALIZATION_MODE: "local-finalize",
        NIXMAC_E2E_STAGING_PARENT: valid.input.stagingParent,
        NIXMAC_E2E_DISPOSABLE_CONFIG_PATH: valid.input.disposableConfigPath,
        NIXMAC_E2E_DAEMON_SOCKET_DIRECTORY: valid.input.daemonSocketDirectory,
        NIXMAC_E2E_DAEMON_SOCKET_PATH: valid.input.daemonSocketPath,
        NIXMAC_E2E_ATTEMPT_STARTED_AT: valid.input.startedAt,
      },
      appBundlePath: valid.appBundlePath,
      appBundleDigest: DIGEST_C,
      cuaDriverCliVersion: "0.12.6",
      cuaDriverAppVersion: "0.12.6",
      accessibilityGranted: true,
      screenRecordingGranted: true,
    });
    assert.deepEqual(envInput, valid.input);

    const mismatchedApp = await createEvidenceFixture(root);
    await assert.rejects(
      () =>
        assertRunPreflight(mismatchedApp.runDir, {
          computeAppBundleDigest: async () => DIGEST_A,
        }),
      /app bundle digest mismatch/i,
    );

    const realDigestFixture = await createEvidenceFixture(root, { writePreflight: false });
    const computeSelfTestBundleDigest =
      process.platform === "darwin" ? hashCuaBundleTree : async () => DIGEST_C;
    const realBundleDigest = await computeSelfTestBundleDigest(realDigestFixture.appBundlePath);
    await writeRunPreflight(realDigestFixture.runDir, {
      ...realDigestFixture.input,
      appBundleDigest: realBundleDigest,
    });
    const realDigestPreflight = await assertRunPreflight(realDigestFixture.runDir, {
      computeAppBundleDigest: computeSelfTestBundleDigest,
    });
    assert.equal(
      realDigestPreflight.app.appBundleDigest,
      realBundleDigest,
      "production preflight must recompute the real app bundle tree digest",
    );
    await assert.rejects(
      () =>
        writeRunPreflight(realDigestFixture.runDir, {
          ...realDigestFixture.input,
          appBundleDigest: realBundleDigest,
        }),
      /already bound|identity\\.json/i,
      "run identity must become immutable as soon as preflight sidecars are written",
    );

    for (const relativePath of [
      "runner/identity.json",
      "runner/permissions.json",
      "artifact/source.json",
      "attempt.json",
    ]) {
      for (const mode of ["missing", "corrupt"]) {
        const fixture = await createEvidenceFixture(root);
        if (mode === "missing") {
          await rm(path.join(fixture.runDir, relativePath));
        } else {
          await writeFile(path.join(fixture.runDir, relativePath), "{not-json\n");
        }
        let prepareCalls = 0;
        await assert.rejects(
          () =>
            prepareSuiteDriver(
              {
                async connect() {},
                async prepareTarget() {
                  prepareCalls += 1;
                },
              },
              {
                executionTopology: "local-cua-driver",
                appBundleId: "com.darkmatter.nixmac",
                localPreflight: { appPath: fixture.appBundlePath },
                beforePrepareTarget: () =>
                  assertRunPreflight(fixture.runDir, {
                    computeAppBundleDigest: async () => DIGEST_C,
                  }),
              },
            ),
          /missing|invalid JSON/i,
          `${relativePath} ${mode}`,
        );
        assert.equal(prepareCalls, 0, `${relativePath} ${mode} must fail before prepareTarget`);
      }
    }

    for (const [label, mutate, expected] of [
      ["owned paths", (cleanup) => (cleanup.ownedPaths = []), /ownedPaths|owned paths/i],
      [
        "missing config ownership",
        (cleanup) =>
          (cleanup.ownedPaths = cleanup.ownedPaths.filter(
            (entry) => entry.kind !== "disposable-config",
          )),
        /disposable-config|ownedPaths|owned paths/i,
      ],
      [
        "path still present",
        (cleanup) => (cleanup.ownedPaths[0].observedFinalState = "present"),
        /observedFinalState|absent/i,
      ],
      [
        "target process missing",
        (cleanup) =>
          (cleanup.processInstances = cleanup.processInstances.filter(
            (entry) => entry.role !== "target",
          )),
        /target|process/i,
      ],
      [
        "daemon process alive",
        (cleanup) => (cleanup.processInstances[1].terminated = false),
        /terminated|process/i,
      ],
      [
        "remaining process",
        (cleanup) => cleanup.remainingProcesses.push({ pid: 999 }),
        /remainingProcesses|clean/i,
      ],
      [
        "wrong ownership lane",
        (cleanup) => (cleanup.ownershipMode = "controller-static"),
        /ownershipMode|local/i,
      ],
      [
        "unproven lifecycle",
        (cleanup) => (cleanup.lifecycle.pathsProbed = false),
        /pathsProbed|lifecycle/i,
      ],
      [
        "nonmonotonic cleanup timestamps",
        (cleanup) => (cleanup.completedAt = "2026-07-25T23:59:00.000Z"),
        /timestamp|completedAt/i,
      ],
      [
        "cleanup failure",
        (cleanup) => (cleanup.failureReason = "removal failed"),
        /failureReason|clean/i,
      ],
    ]) {
      const fixture = await createEvidenceFixture(root);
      const cleanup = structuredClone(cleanCleanup(fixture));
      mutate(cleanup);
      await assert.rejects(
        () => finalizeLocalEvidence(fixture.runDir, { cleanup, verdict: "pass" }),
        expected,
        label,
      );
    }

    const invalidCapture = await createEvidenceFixture(root);
    await assert.rejects(
      () =>
        finalizeLocalEvidence(invalidCapture.runDir, {
          cleanup: cleanCleanup(invalidCapture),
          verdict: "inconclusive",
          capture: { status: "not_started", uiStarted: false, reason: "" },
        }),
      /capture|reason|UI never started/i,
    );
    await assert.rejects(
      () => readFile(path.join(invalidCapture.runDir, "runner", "cleanup.json"), "utf8"),
      /ENOENT/,
      "invalid final capture must be rejected before any finalization sidecar is written",
    );
    const invalidCaptureAttempt = JSON.parse(
      await readFile(path.join(invalidCapture.runDir, "attempt.json"), "utf8"),
    );
    assert.equal(invalidCaptureAttempt.status, "preflight");
    assert.equal(invalidCaptureAttempt.finalized, false);

    const local = await createEvidenceFixture(root);
    await assert.rejects(
      () =>
        finalizeLocalEvidenceProduction(local.runDir, {
          cleanup: cleanCleanup(local),
          verdict: "pass",
        }),
      /live cleanup probe|still exists|present/i,
      "local finalization must independently reject a still-present owned path",
    );
    await assert.rejects(
      () =>
        finalizeLocalEvidenceProduction(
          local.runDir,
          {
            cleanup: cleanCleanup(local),
            verdict: "pass",
          },
          {
            pathExists: async () => false,
            processExists: async (processInstance) => processInstance.role === "daemon",
          },
        ),
      /live cleanup probe|process still exists/i,
      "local finalization must independently reject a still-running owned process",
    );
    const localFinalization = await finalizeLocalEvidence(local.runDir, {
      cleanup: cleanCleanup(local),
      verdict: "pass",
    });
    const { archive: localArchive, manifest: localManifest } = localFinalization;
    assert.equal(localManifest.version, 1);
    assert.deepEqual(
      localManifest.files.map((entry) => entry.path),
      localManifest.files.map((entry) => entry.path).sort(),
      "manifest paths must have stable lexical ordering",
    );
    assert.ok(
      localManifest.files.every((entry) => /^[0-9a-f]{64}$/.test(entry.sha256) && entry.bytes > 0),
      "manifest must bind every required file by non-empty size and SHA-256",
    );
    assert.equal(localManifest.cuaDriver.captureMode, "safe-frame");
    assert.equal(localArchive.format, "zip");
    assert.equal(path.dirname(localArchive.archivePath), path.dirname(local.runDir));
    assert.equal(
      localArchive.archivePath.startsWith(`${local.runDir}${path.sep}`),
      false,
      "canonical archive must be outside the mutable evidence root",
    );
    assert.match(localArchive.sha256, /^[0-9a-f]{64}$/);
    assert.ok(localArchive.bytes > 0);
    assert.equal(localArchive.digestPath, `${localArchive.archivePath}.sha256`);
    assert.deepEqual(
      await evidenceManifest.verifyCanonicalEvidenceArchive(localArchive.archivePath, {
        digestPath: localArchive.digestPath,
      }),
      localFinalization,
      "the exact canonical archive and digest must verify independently",
    );
    const materializedPath = path.join(root, "materialized-canonical-evidence");
    assert.deepEqual(
      await evidenceManifest.verifyCanonicalEvidenceArchive(localArchive.archivePath, {
        digestPath: localArchive.digestPath,
        materializeOut: materializedPath,
      }),
      localFinalization,
      "publisher materialization must come from the same independently verified archive",
    );
    assert.equal(
      JSON.parse(await readFile(path.join(materializedPath, "state.json"), "utf8")).verdict,
      "pass",
    );
    assert.match(
      await readFile(path.join(materializedPath, "index.html"), "utf8"),
      /final-result-attestation/,
    );
    await assert.rejects(
      () =>
        evidenceManifest.verifyCanonicalEvidenceArchive(localArchive.archivePath, {
          digestPath: localArchive.digestPath,
          materializeOut: materializedPath,
        }),
      /materialization target must be absent/i,
      "publisher materialization must never overwrite an existing path",
    );
    const foreignMaterializationTarget = path.join(root, "foreign-materialization-target");
    await mkdir(foreignMaterializationTarget);
    await writeFile(
      path.join(foreignMaterializationTarget, "owner.txt"),
      "created by another publisher\n",
    );
    await assert.rejects(
      () =>
        evidenceManifest.verifyCanonicalEvidenceArchive(localArchive.archivePath, {
          digestPath: localArchive.digestPath,
          materializeOut: foreignMaterializationTarget,
        }),
      /materialization target must be absent/i,
    );
    assert.equal(
      await readFile(path.join(foreignMaterializationTarget, "owner.txt"), "utf8"),
      "created by another publisher\n",
      "a failed invocation must never delete a materialization target it does not own",
    );
    const racedMaterializationTarget = path.join(root, "raced-materialization-target");
    const ffprobeEntered = path.join(root, "materialize-ffprobe-entered");
    const ffprobeRelease = path.join(root, "materialize-ffprobe-release");
    const ffprobeWrapper = path.join(root, "blocking-ffprobe.sh");
    const realFfprobe = spawnSync("which", ["ffprobe"], { encoding: "utf8" }).stdout.trim();
    assert.ok(realFfprobe);
    await writeFile(
      ffprobeWrapper,
      `#!/bin/sh
set -eu
: > "$NIXMAC_E2E_TEST_FFPROBE_ENTERED"
while [ ! -e "$NIXMAC_E2E_TEST_FFPROBE_RELEASE" ]; do sleep 0.01; done
exec "$NIXMAC_E2E_TEST_REAL_FFPROBE" "$@"
`,
      { mode: 0o700 },
    );
    const materializeRace = spawn(
      process.execPath,
      [
        path.join(process.cwd(), "tests/e2e/computer-use/evidence-manifest.mjs"),
        "materialize",
        "--archive",
        localArchive.archivePath,
        "--out",
        racedMaterializationTarget,
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          NIXMAC_E2E_FFPROBE_PATH: ffprobeWrapper,
          NIXMAC_E2E_TEST_FFPROBE_ENTERED: ffprobeEntered,
          NIXMAC_E2E_TEST_FFPROBE_RELEASE: ffprobeRelease,
          NIXMAC_E2E_TEST_REAL_FFPROBE: realFfprobe,
        },
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    let materializeRaceError = "";
    materializeRace.stderr.on("data", (chunk) => {
      materializeRaceError += chunk;
    });
    const materializeRaceExit = once(materializeRace, "exit");
    await waitForPath(ffprobeEntered);
    await mkdir(racedMaterializationTarget);
    await writeFile(
      path.join(racedMaterializationTarget, "owner.txt"),
      "won target creation race\n",
    );
    await writeFile(ffprobeRelease, "release\n");
    const [materializeRaceCode] = await materializeRaceExit;
    assert.notEqual(materializeRaceCode, 0, materializeRaceError);
    assert.equal(
      await readFile(path.join(racedMaterializationTarget, "owner.txt"), "utf8"),
      "won target creation race\n",
      "a target created after validation must survive the failed materialization",
    );
    const sharedMaterializationTarget = path.join(root, "shared-materialization-target");
    const materializeBarrierRelease = path.join(root, "materialize-barrier-release");
    const spawnMaterializeContender = (label) => {
      const enteredPath = path.join(root, `materialize-${label}-entered`);
      const child = spawn(
        process.execPath,
        [
          path.join(process.cwd(), "tests/e2e/computer-use/evidence-manifest.mjs"),
          "materialize",
          "--archive",
          localArchive.archivePath,
          "--out",
          sharedMaterializationTarget,
        ],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            NIXMAC_E2E_FFPROBE_PATH: ffprobeWrapper,
            NIXMAC_E2E_TEST_FFPROBE_ENTERED: enteredPath,
            NIXMAC_E2E_TEST_FFPROBE_RELEASE: materializeBarrierRelease,
            NIXMAC_E2E_TEST_REAL_FFPROBE: realFfprobe,
          },
          stdio: ["ignore", "ignore", "pipe"],
        },
      );
      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      return {
        child,
        enteredPath,
        exit: once(child, "exit").then(([code, signal]) => ({ code, signal, stderr })),
      };
    };
    const materializeA = spawnMaterializeContender("a");
    const materializeB = spawnMaterializeContender("b");
    await Promise.all([
      waitForPath(materializeA.enteredPath),
      waitForPath(materializeB.enteredPath),
    ]);
    await writeFile(materializeBarrierRelease, "release\n");
    const materializeResults = await Promise.all([materializeA.exit, materializeB.exit]);
    assert.deepEqual(
      materializeResults.map(({ code }) => code).sort(),
      [0, 1],
      materializeResults.map(({ stderr }) => stderr).join("\n"),
    );
    assert.equal(
      JSON.parse(await readFile(path.join(sharedMaterializationTarget, "state.json"), "utf8"))
        .verdict,
      "pass",
      "one atomic no-replace materializer must win without loser cleanup deleting it",
    );
    const originalDigestSidecar = await readFile(localArchive.digestPath, "utf8");
    const invalidSidecarTarget = path.join(root, "invalid-sidecar-target");
    const invalidSidecarProbeMarker = path.join(root, "invalid-sidecar-probe-entered");
    await writeFile(
      localArchive.digestPath,
      `${"0".repeat(64)}  ${path.basename(localArchive.archivePath)}\n`,
    );
    const invalidSidecarMaterialize = spawnSync(
      process.execPath,
      [
        path.join(process.cwd(), "tests/e2e/computer-use/evidence-manifest.mjs"),
        "materialize",
        "--archive",
        localArchive.archivePath,
        "--out",
        invalidSidecarTarget,
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          NIXMAC_E2E_FFPROBE_PATH: ffprobeWrapper,
          NIXMAC_E2E_TEST_FFPROBE_ENTERED: invalidSidecarProbeMarker,
          NIXMAC_E2E_TEST_FFPROBE_RELEASE: materializeBarrierRelease,
          NIXMAC_E2E_TEST_REAL_FFPROBE: realFfprobe,
        },
      },
    );
    assert.notEqual(invalidSidecarMaterialize.status, 0);
    await assert.rejects(() => lstat(invalidSidecarProbeMarker), /ENOENT/);
    await assert.rejects(() => lstat(invalidSidecarTarget), /ENOENT/);
    await writeFile(localArchive.digestPath, originalDigestSidecar);
    executedNodeCases.add("valid-ephemeral-safe-frame");
    const localAttempt = JSON.parse(
      await readFile(path.join(local.runDir, "attempt.json"), "utf8"),
    );
    assert.equal(localAttempt.startedAt, local.input.startedAt);
    assert.ok(Number.isFinite(Date.parse(localAttempt.endedAt)));
    assert.equal(localAttempt.failureClass, "none");
    assert.equal(localAttempt.evidencePrefix, local.input.evidencePrefix);
    assert.equal(localAttempt.lifecycle.current, "SUCCEEDED");
    assert.deepEqual(
      localAttempt.lifecycle.history.map((transition) => transition.state),
      ["PROVISIONING", "READY", "RUNNING", "UPLOADING", "VERIFYING", "SUCCEEDED"],
    );
    assert.ok(
      localAttempt.lifecycle.history.every(
        (transition, index, history) =>
          Number.isFinite(Date.parse(transition.at)) &&
          (index === 0 || Date.parse(transition.at) >= Date.parse(history[index - 1].at)),
      ),
      "attempt lifecycle transitions must have monotonic canonical timestamps",
    );
    for (const [label, mutate] of [
      ["preflight writer", () => writeRunPreflight(local.runDir, local.input)],
      ["cleanup writer", () => writeRunCleanup(local.runDir, cleanCleanup(local))],
      [
        "controller staging writer",
        () => stageControllerEvidence(local.runDir, { verdict: "pass" }),
      ],
    ]) {
      await assert.rejects(mutate, /immutable|already exists/i, label);
    }
    await assert.rejects(
      () =>
        finalizeLocalEvidence(local.runDir, {
          cleanup: {
            ...cleanCleanup(local),
            ownedPaths: [],
          },
          verdict: "pass",
        }),
      /immutable|already exists/i,
    );
    assert.deepEqual(
      await verifyEvidenceManifest(local.runDir),
      localManifest,
      "every post-seal writer refusal must leave the manifest valid",
    );
    const sealedState = {
      ...JSON.parse(await readFile(path.join(local.runDir, "state.json"), "utf8")),
      runDir: local.runDir,
    };
    for (const [label, mutate] of [
      ["state writer", () => saveState(sealedState)],
      ["event writer", () => addEvent(sealedState, "post-seal-event", { forbidden: true })],
      [
        "crash fallback renderer",
        () =>
          renderSuiteErrorReport(new Error("post-seal crash"), ["--run-dir", local.runDir], {
            executionTopology: "local-cua-driver",
          }),
      ],
    ]) {
      await assert.rejects(mutate, /manifest\\.json|immutable|sealed/i, label);
      assert.deepEqual(
        await verifyEvidenceManifest(local.runDir),
        localManifest,
        `${label} refusal must leave verified evidence unchanged`,
      );
    }

    for (const blockerCode of ["local_preflight", "permissions", "competing_process"]) {
      const blocker = await createEvidenceFixture(root);
      await rm(path.join(blocker.runDir, "screenshots"), { recursive: true, force: true });
      await rm(path.join(blocker.runDir, "video"), { recursive: true, force: true });
      const blockerState = JSON.parse(
        await readFile(path.join(blocker.runDir, "state.json"), "utf8"),
      );
      blockerState.verdict = "inconclusive";
      blockerState.screenshots = [];
      await rm(path.join(blocker.runDir, "texts", "launch.txt"));
      await writeFile(
        path.join(blocker.runDir, "texts", "pre-ui-blocker.txt"),
        `${blockerCode} blocked before UI\n`,
      );
      blockerState.textSnapshots = [
        { path: "texts/pre-ui-blocker.txt", label: "Pre-UI infrastructure blocker" },
      ];
      blockerState.video = {
        status: "not_started",
        note: "UI capture never began because a classified infrastructure blocker stopped the run.",
      };
      blockerState.runFailure = {
        category: "infrastructure",
        code: blockerCode,
        infrastructureBlocker: true,
        phase:
          blockerCode === "local_preflight"
            ? "preflight"
            : blockerCode === "permissions"
              ? "permissions"
              : "target_preparation",
      };
      await writeFile(
        path.join(blocker.runDir, "state.json"),
        `${JSON.stringify(blockerState, null, 2)}\n`,
      );
      const blockerCleanup = cleanCleanup(blocker);
      blockerCleanup.processInstances = [
        {
          role: "target",
          status: "not_started",
          pid: null,
          birthMarker: null,
          executable: null,
          terminated: true,
        },
        {
          role: "daemon",
          status: "not_started",
          pid: null,
          birthMarker: null,
          executable: null,
          terminated: true,
        },
      ];
      const blockerFinalization = await finalizeLocalEvidence(blocker.runDir, {
        cleanup: blockerCleanup,
        verdict: "inconclusive",
        capture: {
          status: "not_started",
          uiStarted: false,
          reason: `${blockerCode} blocked execution before the UI lifecycle began`,
        },
      });
      const blockerManifest = blockerFinalization.manifest;
      assert.deepEqual(
        await verifyEvidenceManifest(blocker.runDir),
        blockerManifest,
        `${blockerCode} pre-UI blocker evidence must create and verify without visual files`,
      );
      assert.equal(
        blockerManifest.files.some(
          (file) => file.path.startsWith("screenshots/") || file.path.startsWith("video/"),
        ),
        false,
        `${blockerCode} must not fabricate visual proof`,
      );
      const blockerAttempt = JSON.parse(
        await readFile(path.join(blocker.runDir, "attempt.json"), "utf8"),
      );
      assert.equal(blockerAttempt.lifecycle.current, "ABORTED");
      assert.deepEqual(
        blockerAttempt.lifecycle.history.map((transition) => transition.state),
        ["PROVISIONING", "READY", "ABORTED"],
      );
    }

    await writeFile(path.join(local.runDir, "texts", "launch.txt"), "mutated evidence\n");
    await assert.rejects(
      () => verifyEvidenceManifest(local.runDir),
      /digest mismatch/i,
      "the mutable source tree must be described only as a point-in-time snapshot",
    );
    assert.deepEqual(
      await evidenceManifest.verifyCanonicalEvidenceArchive(localArchive.archivePath, {
        digestPath: localArchive.digestPath,
      }),
      localFinalization,
      "source mutation after archive creation must not change or poison the canonical result",
    );
    const corruptedArchiveBytes = await readFile(localArchive.archivePath);
    corruptedArchiveBytes[Math.floor(corruptedArchiveBytes.length / 2)] ^= 0xff;
    await writeFile(localArchive.archivePath, corruptedArchiveBytes);
    await assert.rejects(
      () =>
        evidenceManifest.verifyCanonicalEvidenceArchive(localArchive.archivePath, {
          digestPath: localArchive.digestPath,
        }),
      /digest|archive|ZIP|mismatch/i,
      "the Node verifier must reject the language-neutral digest-mismatch case",
    );
    executedNodeCases.add("digest-mismatch");

    const controller = await createEvidenceFixture(root, { backend: "static_ssh" });
    await stageControllerEvidence(controller.runDir, { verdict: "pass" });
    await assert.rejects(
      () =>
        writeControllerFinalization(controller.runDir, {
          cleanup: cleanCleanup(controller, { mode: "controller" }),
          hostLease: releasedLease(),
          trustedOwnerToken: TRUSTED_OWNER_TOKEN,
          verdict: "pass",
        }),
      /controller.*probe|probe attestation/i,
      "controller cleanup strings without an independently bound probe must never finalize",
    );
    const rejectedControllerCleanup = cleanCleanup(controller, { mode: "controller" });
    await assert.rejects(
      () =>
        writeControllerFinalization(controller.runDir, {
          cleanup: rejectedControllerCleanup,
          cleanupProbe: {
            ...controllerCleanupProbe(controller, rejectedControllerCleanup),
            ownerTokenHmac: "0".repeat(64),
          },
          hostLease: releasedLease(),
          trustedOwnerToken: TRUSTED_OWNER_TOKEN,
          verdict: "pass",
        }),
      /probe attestation|trusted observations/i,
      "controller finalization must reject a forged cleanup-probe HMAC",
    );
    await assert.rejects(
      () => readFile(path.join(controller.runDir, "manifest.json"), "utf8"),
      /ENOENT/,
      "remote static runner must not create manifest.json",
    );
    const prematureSeal = await createEvidenceFixture(root, { backend: "static_ssh" });
    await stageControllerEvidence(prematureSeal.runDir, { verdict: "pass" });
    await assert.rejects(
      () => createEvidenceManifest(prematureSeal.runDir),
      /cleanup|finalized/i,
      "controller-finalized evidence must not seal before controller cleanup",
    );
    const controllerCleanup = cleanCleanup(controller, { mode: "controller" });
    for (const rawTokenField of [
      "owner_token",
      "owner-token",
      "owner token",
      "ownerToken",
      "raw_owner_token",
    ]) {
      const rawTokenFixture = await createEvidenceFixture(root, { backend: "static_ssh" });
      await stageControllerEvidence(rawTokenFixture.runDir, { verdict: "pass" });
      const rawTokenCleanup = cleanCleanup(rawTokenFixture, { mode: "controller" });
      await assert.rejects(
        () =>
          writeControllerFinalization(rawTokenFixture.runDir, {
            cleanup: rawTokenCleanup,
            cleanupProbe: controllerCleanupProbe(rawTokenFixture, rawTokenCleanup),
            hostLease: {
              ...releasedLease(),
              [rawTokenField]: TRUSTED_OWNER_TOKEN,
            },
            trustedOwnerToken: TRUSTED_OWNER_TOKEN,
            verdict: "pass",
          }),
        /raw owner token|host lease.*field|unexpected/i,
        `${rawTokenField} must never survive normalization into evidence`,
      );
    }
    for (const [label, mutateLease] of [
      [
        "raw token in allowed waitReason",
        (lease) => {
          lease.waitReason = TRUSTED_OWNER_TOKEN;
        },
      ],
      [
        "raw token embedded in allowed waitReason",
        (lease) => {
          lease.waitReason = `waited-for-${TRUSTED_OWNER_TOKEN}-owner`;
        },
      ],
      [
        "raw token in a nested value",
        (lease) => {
          lease.metadata = { nested: { reason: TRUSTED_OWNER_TOKEN } };
        },
      ],
    ]) {
      const rawTokenFixture = await createEvidenceFixture(root, { backend: "static_ssh" });
      await stageControllerEvidence(rawTokenFixture.runDir, { verdict: "pass" });
      const rawTokenCleanup = cleanCleanup(rawTokenFixture, { mode: "controller" });
      const rawTokenLease = releasedLease();
      mutateLease(rawTokenLease);
      await assert.rejects(
        () =>
          writeControllerFinalization(rawTokenFixture.runDir, {
            cleanup: rawTokenCleanup,
            cleanupProbe: controllerCleanupProbe(rawTokenFixture, rawTokenCleanup),
            hostLease: rawTokenLease,
            trustedOwnerToken: TRUSTED_OWNER_TOKEN,
            verdict: "pass",
          }),
        /raw owner token|trusted owner token/i,
        label,
      );
    }
    await writeControllerFinalization(controller.runDir, {
      cleanup: controllerCleanup,
      cleanupProbe: controllerCleanupProbe(controller, controllerCleanup),
      hostLease: releasedLease(),
      trustedOwnerToken: TRUSTED_OWNER_TOKEN,
      verdict: "pass",
    });
    const persistedLease = await readFile(
      path.join(controller.runDir, "runner", "host-lease.json"),
      "utf8",
    );
    assert.doesNotMatch(
      persistedLease,
      new RegExp(TRUSTED_OWNER_TOKEN),
      "raw owner token must never be retained in evidence",
    );
    await assert.rejects(
      () => readFile(path.join(controller.runDir, "manifest.json"), "utf8"),
      /ENOENT/,
      "controller sidecar finalization must remain separate from manifest creation",
    );
    const persistedControllerState = JSON.parse(
      await readFile(path.join(controller.runDir, "state.json"), "utf8"),
    );
    assert.equal(persistedControllerState.cleanup.clean, true);
    assert.equal(persistedControllerState.cleanup.ownershipMode, "controller-static");
    assert.match(
      await readFile(path.join(controller.runDir, "index.html"), "utf8"),
      /controller cleanup attestation|owner-matched.*clean/i,
      "the human report must expose controller-owned final cleanup",
    );
    const controllerManifest = await createEvidenceManifest(controller.runDir, {
      trustedOwnerToken: TRUSTED_OWNER_TOKEN,
    });
    await verifyEvidenceManifest(controller.runDir, {
      trustedOwnerToken: TRUSTED_OWNER_TOKEN,
    });
    assert.equal(controllerManifest.runner.backend, "static_ssh");
    assert.deepEqual(
      await verifyEvidenceManifest(controller.runDir, {
        trustedOwnerToken: TRUSTED_OWNER_TOKEN,
      }),
      controllerManifest,
    );
    for (const [label, mutate] of [
      [
        "controller finalization writer",
        () =>
          writeControllerFinalization(controller.runDir, {
            cleanup: controllerCleanup,
            cleanupProbe: controllerCleanupProbe(controller, controllerCleanup),
            hostLease: releasedLease(),
            trustedOwnerToken: TRUSTED_OWNER_TOKEN,
            verdict: "pass",
          }),
      ],
      [
        "controller finalization sealer",
        () =>
          finalizeControllerEvidence(controller.runDir, {
            cleanup: controllerCleanup,
            cleanupProbe: controllerCleanupProbe(controller, controllerCleanup),
            hostLease: releasedLease(),
            trustedOwnerToken: TRUSTED_OWNER_TOKEN,
            verdict: "pass",
          }),
      ],
    ]) {
      await assert.rejects(mutate, /immutable|already exists/i, label);
    }

    assert.equal(
      typeof evidenceGuard.withEvidenceTreeMutation,
      "function",
      "evidence writers and the sealer need one atomic mutation boundary",
    );
    const racedSeal = await createEvidenceFixture(root, { backend: "static_ssh" });
    await stageControllerEvidence(racedSeal.runDir, { verdict: "pass" });
    const racedCleanup = cleanCleanup(racedSeal, { mode: "controller" });
    await writeControllerFinalization(racedSeal.runDir, {
      cleanup: racedCleanup,
      cleanupProbe: controllerCleanupProbe(racedSeal, racedCleanup),
      hostLease: releasedLease(),
      trustedOwnerToken: TRUSTED_OWNER_TOKEN,
      verdict: "pass",
    });
    assert.equal(
      typeof evidenceGuard.evidenceControlPaths,
      "function",
      "the writer/sealer protocol must expose its file-backed control paths for audit tests",
    );
    assert.equal(
      typeof evidenceGuard.evidenceControlPaths(racedSeal.runDir).staleOwnersDirectory,
      "string",
      "crashed owner recovery must retain an auditable stale-owner quarantine",
    );
    const writerEnteredPath = path.join(root, "cross-process-writer-entered");
    const guardUrl = pathToFileURL(
      path.join(process.cwd(), "tests/e2e/computer-use/evidence-guard.mjs"),
    ).href;
    const writerScript = `
      import { readFile, writeFile } from "node:fs/promises";
      import { setTimeout as delay } from "node:timers/promises";
      import { withEvidenceTreeMutation } from ${JSON.stringify(guardUrl)};
      const [runDir, enteredPath] = process.argv.slice(1);
      await withEvidenceTreeMutation(runDir, async () => {
        await writeFile(enteredPath, "entered\\n");
        await delay(300);
        const statePath = runDir + "/state.json";
        const state = await readFile(statePath, "utf8");
        await writeFile(statePath, state);
      });
    `;
    const writer = spawn(
      process.execPath,
      ["--input-type=module", "--eval", writerScript, racedSeal.runDir, writerEnteredPath],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let writerError = "";
    writer.stderr.on("data", (chunk) => {
      writerError += chunk;
    });
    const writerExit = once(writer, "exit");
    await waitForPath(writerEnteredPath);
    const controlPaths = evidenceGuard.evidenceControlPaths(racedSeal.runDir);
    assert.ok(
      (await readdir(controlPaths.activeWritersDirectory)).length > 0,
      "an admitted writer must have a file-backed registration visible across processes",
    );
    const sealStartedAt = Date.now();
    const concurrentSeal = createEvidenceManifest(racedSeal.runDir, {
      trustedOwnerToken: TRUSTED_OWNER_TOKEN,
    });
    const [racedManifest, [writerExitCode]] = await Promise.all([concurrentSeal, writerExit]);
    assert.equal(writerExitCode, 0, writerError);
    assert.ok(
      Date.now() - sealStartedAt >= 200,
      "the sealer must close admission and drain a writer registered by another process",
    );
    await lstat(controlPaths.admissionClosedPath);
    assert.deepEqual(
      await readdir(controlPaths.activeWritersDirectory),
      [],
      "all registered writers must drain before evidence scanning begins",
    );
    assert.deepEqual(
      await verifyEvidenceManifest(racedSeal.runDir, {
        trustedOwnerToken: TRUSTED_OWNER_TOKEN,
      }),
      racedManifest,
      "the sealer must wait for an in-flight writer and bind its completed write",
    );

    const prepareStaticSealFixture = async () => {
      const fixture = await createEvidenceFixture(root, { backend: "static_ssh" });
      await stageControllerEvidence(fixture.runDir, { verdict: "pass" });
      const cleanup = cleanCleanup(fixture, { mode: "controller" });
      await writeControllerFinalization(fixture.runDir, {
        cleanup,
        cleanupProbe: controllerCleanupProbe(fixture, cleanup),
        hostLease: releasedLease(),
        trustedOwnerToken: TRUSTED_OWNER_TOKEN,
        verdict: "pass",
      });
      return fixture;
    };
    const spawnCrashingOwner = async (fixture, operation) => {
      const enteredPath = path.join(root, `${operation}-entered-${fixtureSequence}`);
      const ownerScript =
        operation === "writer"
          ? `
              import { writeFile } from "node:fs/promises";
              import { withEvidenceTreeMutation } from ${JSON.stringify(guardUrl)};
              const [runDir, enteredPath] = process.argv.slice(1);
              await withEvidenceTreeMutation(runDir, async () => {
                await writeFile(enteredPath, "entered\\n");
                await new Promise(() => setInterval(() => {}, 1000));
              });
            `
          : `
              import { writeFile } from "node:fs/promises";
              import { withEvidenceTreeSeal } from ${JSON.stringify(guardUrl)};
              const [runDir, enteredPath] = process.argv.slice(1);
              await withEvidenceTreeSeal(runDir, async () => {
                await writeFile(enteredPath, "entered\\n");
                await new Promise(() => setInterval(() => {}, 1000));
              });
            `;
      const owner = spawn(
        process.execPath,
        ["--input-type=module", "--eval", ownerScript, fixture.runDir, enteredPath],
        { stdio: ["ignore", "ignore", "pipe"] },
      );
      let ownerError = "";
      owner.stderr.on("data", (chunk) => {
        ownerError += chunk;
      });
      await waitForPath(enteredPath);
      owner.kill("SIGKILL");
      const [exitCode, signal] = await once(owner, "exit");
      assert.equal(exitCode, null, ownerError);
      assert.equal(signal, "SIGKILL", ownerError);
      return evidenceGuard.evidenceControlPaths(fixture.runDir);
    };

    const crashedWriter = await prepareStaticSealFixture();
    const crashedWriterPaths = await spawnCrashingOwner(crashedWriter, "writer");
    const crashedWriterEntries = await readdir(crashedWriterPaths.activeWritersDirectory);
    assert.equal(crashedWriterEntries.length, 1);
    const crashedWriterRecord = JSON.parse(
      await readFile(
        path.join(crashedWriterPaths.activeWritersDirectory, crashedWriterEntries[0]),
        "utf8",
      ),
    );
    assert.equal(crashedWriterRecord.kind, "writer");
    assert.equal(typeof crashedWriterRecord.pid, "number");
    assert.match(crashedWriterRecord.processBirthMarker, /start/i);
    assert.equal(typeof crashedWriterRecord.hostname, "string");
    assert.equal(typeof crashedWriterRecord.bootMarker, "string");
    assert.match(crashedWriterRecord.nonce, /^[0-9a-f-]{36}$/);
    await createEvidenceManifest(crashedWriter.runDir, {
      trustedOwnerToken: TRUSTED_OWNER_TOKEN,
    });
    assert.deepEqual(await readdir(crashedWriterPaths.activeWritersDirectory), []);
    assert.ok(
      (await readdir(crashedWriterPaths.staleOwnersDirectory)).some((entry) =>
        entry.endsWith(".audit.json"),
      ),
      "a SIGKILL-stale writer must be atomically quarantined with an audit record",
    );

    const reusedPidWriter = await prepareStaticSealFixture();
    const reusedPidPaths = await spawnCrashingOwner(reusedPidWriter, "writer");
    const [reusedPidEntry] = await readdir(reusedPidPaths.activeWritersDirectory);
    const reusedPidPath = path.join(reusedPidPaths.activeWritersDirectory, reusedPidEntry);
    const reusedPidRecord = JSON.parse(await readFile(reusedPidPath, "utf8"));
    reusedPidRecord.pid = process.pid;
    reusedPidRecord.processBirthMarker = `reused-${reusedPidRecord.processBirthMarker}`;
    await writeFile(reusedPidPath, `${JSON.stringify(reusedPidRecord)}\n`);
    await rename(
      reusedPidPath,
      path.join(
        reusedPidPaths.activeWritersDirectory,
        `${reusedPidRecord.pid}-${reusedPidRecord.nonce}.json`,
      ),
    );
    await createEvidenceManifest(reusedPidWriter.runDir, {
      trustedOwnerToken: TRUSTED_OWNER_TOKEN,
    });
    const reusedAudits = (
      await Promise.all(
        (
          await readdir(reusedPidPaths.staleOwnersDirectory)
        )
          .filter((entry) => entry.endsWith(".audit.json"))
          .map(async (entry) =>
            JSON.parse(
              await readFile(path.join(reusedPidPaths.staleOwnersDirectory, entry), "utf8"),
            ),
          ),
      )
    ).filter((audit) => audit.reason === "owner-pid-reused");
    assert.equal(
      reusedAudits.length,
      1,
      "a live reused PID with a different birth marker must be reclaimed deterministically",
    );

    const crashedSealer = await prepareStaticSealFixture();
    const crashedSealerPaths = await spawnCrashingOwner(crashedSealer, "sealer");
    await lstat(crashedSealerPaths.sealerLockPath);
    await createEvidenceManifest(crashedSealer.runDir, {
      trustedOwnerToken: TRUSTED_OWNER_TOKEN,
    });
    await assert.rejects(
      () => lstat(crashedSealerPaths.sealerLockPath),
      /ENOENT/,
      "a SIGKILL-stale sealer lock must be reclaimed and released",
    );
    const sealerAudits = await Promise.all(
      (await readdir(crashedSealerPaths.staleOwnersDirectory))
        .filter((entry) => entry.endsWith(".audit.json"))
        .map(async (entry) =>
          JSON.parse(
            await readFile(path.join(crashedSealerPaths.staleOwnersDirectory, entry), "utf8"),
          ),
        ),
    );
    assert.ok(
      sealerAudits.some(
        (audit) => audit.owner.kind === "sealer-lock" && audit.reason === "owner-process-dead",
      ),
      "a stale sealer recovery must retain the dead process identity and reason",
    );

    const reclaimRace = await prepareStaticSealFixture();
    const reclaimRacePaths = await spawnCrashingOwner(reclaimRace, "sealer");
    const originalStaleSealer = JSON.parse(await readFile(reclaimRacePaths.sealerLockPath, "utf8"));
    const reclaimBarrierDirectory = path.join(root, "two-reclaimer-barrier");
    const reclaimCriticalPath = path.join(root, "two-reclaimer-critical");
    await mkdir(reclaimBarrierDirectory);
    const reclaimerScript = `
      import { unlink, writeFile } from "node:fs/promises";
      import { setTimeout as delay } from "node:timers/promises";
      import { withEvidenceTreeSeal } from ${JSON.stringify(guardUrl)};
      const [runDir, criticalPath, label] = process.argv.slice(1);
      await withEvidenceTreeSeal(runDir, async () => {
        let ownsCriticalPath = false;
        try {
          await writeFile(criticalPath, label, { flag: "wx" });
          ownsCriticalPath = true;
          await delay(300);
        } finally {
          if (ownsCriticalPath) await unlink(criticalPath);
        }
      });
    `;
    const spawnReclaimer = (label, postBarrierDelay) => {
      const child = spawn(
        process.execPath,
        [
          "--input-type=module",
          "--eval",
          reclaimerScript,
          reclaimRace.runDir,
          reclaimCriticalPath,
          label,
        ],
        {
          env: {
            ...process.env,
            NIXMAC_E2E_TEST_RECLAIM_BARRIER_DIR: reclaimBarrierDirectory,
            NIXMAC_E2E_TEST_RECLAIM_POST_BARRIER_DELAY_MS: String(postBarrierDelay),
          },
          stdio: ["ignore", "ignore", "pipe"],
        },
      );
      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      return once(child, "exit").then(([code, signal]) => ({
        code,
        signal,
        stderr,
      }));
    };
    const reclaimRaceResults = await Promise.all([
      spawnReclaimer("first", 0),
      spawnReclaimer("second", 150),
    ]);
    assert.ok(
      reclaimRaceResults.every(({ code }) => code === 0),
      reclaimRaceResults
        .map(({ code, signal, stderr }) => `${code ?? signal}: ${stderr}`)
        .join("\n"),
    );
    const reclaimRaceAudits = await Promise.all(
      (await readdir(reclaimRacePaths.staleOwnersDirectory))
        .filter((entry) => entry.endsWith(".audit.json"))
        .map(async (entry) =>
          JSON.parse(
            await readFile(path.join(reclaimRacePaths.staleOwnersDirectory, entry), "utf8"),
          ),
        ),
    );
    assert.equal(
      reclaimRaceAudits.filter(
        (audit) =>
          audit.owner.kind === "sealer-lock" && audit.owner.nonce === originalStaleSealer.nonce,
      ).length,
      1,
      "two reclaimers must quarantine only the original stale lock, never a live replacement",
    );

    await assert.rejects(
      () =>
        evidenceGuard.withEvidenceTreeMutation(racedSeal.runDir, async () => {
          await writeFile(path.join(racedSeal.runDir, "state.json"), "{}\n");
        }),
      /immutable|manifest/i,
      "no writer may enter after the manifest seal exists",
    );

    const forgedBoundary = await createEvidenceFixture(root, { backend: "static_ssh" });
    await stageControllerEvidence(forgedBoundary.runDir, { verdict: "pass" });
    const forgedCleanup = cleanCleanup(forgedBoundary, { mode: "controller" });
    await writeControllerFinalization(forgedBoundary.runDir, {
      cleanup: forgedCleanup,
      cleanupProbe: controllerCleanupProbe(forgedBoundary, forgedCleanup),
      hostLease: releasedLease(),
      trustedOwnerToken: TRUSTED_OWNER_TOKEN,
      verdict: "pass",
    });
    const fabricatedHash = "d".repeat(64);
    const fabricatedLease = {
      ...releasedLease(),
      acquiredOwnerTokenHash: fabricatedHash,
      releasedOwnerTokenHash: fabricatedHash,
    };
    const fabricatedProbe = {
      ...controllerCleanupProbe(forgedBoundary, forgedCleanup),
      ownerTokenHmac: "e".repeat(64),
    };
    await writeFile(
      path.join(forgedBoundary.runDir, "runner", "host-lease.json"),
      `${JSON.stringify({ version: 1, ...fabricatedLease }, null, 2)}\n`,
    );
    await writeFile(
      path.join(forgedBoundary.runDir, "runner", "cleanup-probe.json"),
      `${JSON.stringify(fabricatedProbe, null, 2)}\n`,
    );
    await assert.rejects(
      () => createEvidenceManifest(forgedBoundary.runDir),
      /trusted owner token|authenticated controller/i,
      "standalone manifest creation must not trust self-consistent fabricated hashes",
    );
    await assert.rejects(
      () =>
        createEvidenceManifest(forgedBoundary.runDir, {
          trustedOwnerToken: TRUSTED_OWNER_TOKEN,
        }),
      /owner.*hash|cleanup probe|authenticated controller/i,
      "manifest creation must authenticate controller finalization with the trusted token",
    );
    executedNodeCases.add("static-owner-hash-mismatch");

    const mismatchedReport = await createEvidenceFixture(root, { backend: "static_ssh" });
    await stageControllerEvidence(mismatchedReport.runDir, { verdict: "pass" });
    const mismatchedReportCleanup = cleanCleanup(mismatchedReport, { mode: "controller" });
    await writeControllerFinalization(mismatchedReport.runDir, {
      cleanup: mismatchedReportCleanup,
      cleanupProbe: controllerCleanupProbe(mismatchedReport, mismatchedReportCleanup),
      hostLease: releasedLease(),
      trustedOwnerToken: TRUSTED_OWNER_TOKEN,
      verdict: "pass",
    });
    const mismatchedReportPath = path.join(mismatchedReport.runDir, "index.html");
    const mismatchedReportHtml = await readFile(mismatchedReportPath, "utf8");
    const forgedAttestation =
      '<section id="final-cleanup-attestation" class="panel"><h2>Controller cleanup attestation</h2><p><strong>Status: failed</strong></p><p>Owned paths remain.</p></section>';
    const forgedReportHtml = mismatchedReportHtml.replace(
      /<section id="final-cleanup-attestation"[\s\S]*?<\/section>/,
      forgedAttestation,
    );
    assert.notEqual(forgedReportHtml, mismatchedReportHtml);
    await writeFile(mismatchedReportPath, forgedReportHtml);
    await assert.rejects(
      () =>
        createEvidenceManifest(mismatchedReport.runDir, {
          trustedOwnerToken: TRUSTED_OWNER_TOKEN,
        }),
      /report.*cleanup|cleanup.*report|attestation/i,
      "the sealed human report must exactly match structured cleanup state",
    );

    const scannerRace = await createEvidenceFixture(root, { backend: "static_ssh" });
    await stageControllerEvidence(scannerRace.runDir, { verdict: "pass" });
    const scannerRaceCleanup = cleanCleanup(scannerRace, { mode: "controller" });
    await writeControllerFinalization(scannerRace.runDir, {
      cleanup: scannerRaceCleanup,
      cleanupProbe: controllerCleanupProbe(scannerRace, scannerRaceCleanup),
      hostLease: releasedLease(),
      trustedOwnerToken: TRUSTED_OWNER_TOKEN,
      verdict: "pass",
    });
    const raceFfmpeg = path.join(root, "race-ffmpeg.sh");
    await writeFile(
      raceFfmpeg,
      '#!/bin/sh\nprintf "%s\\n" "$NIXMAC_E2E_HOST_LEASE_OWNER_TOKEN" > "$NIXMAC_E2E_SCAN_RACE_RUN_DIR/raw-owner-token.txt"\n',
      { mode: 0o700 },
    );
    const previousFfmpegPath = process.env.NIXMAC_E2E_FFMPEG_PATH;
    const previousRaceRunDir = process.env.NIXMAC_E2E_SCAN_RACE_RUN_DIR;
    process.env.NIXMAC_E2E_FFMPEG_PATH = raceFfmpeg;
    process.env.NIXMAC_E2E_SCAN_RACE_RUN_DIR = scannerRace.runDir;
    try {
      await assert.rejects(
        () =>
          createEvidenceManifest(scannerRace.runDir, {
            trustedOwnerToken: TRUSTED_OWNER_TOKEN,
          }),
        /changed during traversal|entry set changed|directory changed/i,
        "a non-cooperating file added after enumeration must fail the descriptor-relative scan",
      );
    } finally {
      if (previousFfmpegPath === undefined) delete process.env.NIXMAC_E2E_FFMPEG_PATH;
      else process.env.NIXMAC_E2E_FFMPEG_PATH = previousFfmpegPath;
      if (previousRaceRunDir === undefined) delete process.env.NIXMAC_E2E_SCAN_RACE_RUN_DIR;
      else process.env.NIXMAC_E2E_SCAN_RACE_RUN_DIR = previousRaceRunDir;
    }

    const controllerBlocker = await createEvidenceFixture(root, { backend: "static_ssh" });
    await rm(path.join(controllerBlocker.runDir, "screenshots"), {
      recursive: true,
      force: true,
    });
    await rm(path.join(controllerBlocker.runDir, "video"), { recursive: true, force: true });
    const controllerBlockerState = JSON.parse(
      await readFile(path.join(controllerBlocker.runDir, "state.json"), "utf8"),
    );
    controllerBlockerState.verdict = "inconclusive";
    controllerBlockerState.screenshots = [];
    await rm(path.join(controllerBlocker.runDir, "texts", "launch.txt"));
    await writeFile(
      path.join(controllerBlocker.runDir, "texts", "pre-ui-blocker.txt"),
      "static controller blocked before UI\n",
    );
    controllerBlockerState.textSnapshots = [
      { path: "texts/pre-ui-blocker.txt", label: "Pre-UI infrastructure blocker" },
    ];
    controllerBlockerState.video = {
      status: "not_available",
      note: "The static runner was blocked before UI capture began.",
    };
    await writeFile(
      path.join(controllerBlocker.runDir, "state.json"),
      `${JSON.stringify(controllerBlockerState, null, 2)}\n`,
    );
    const controllerBlockerCapture = {
      status: "not_available",
      uiStarted: false,
      reason: "static runner preflight blocked the UI lifecycle",
    };
    await stageControllerEvidence(controllerBlocker.runDir, {
      capture: controllerBlockerCapture,
      verdict: "inconclusive",
    });
    const controllerBlockerCleanup = cleanCleanup(controllerBlocker, {
      mode: "controller",
    });
    controllerBlockerCleanup.processInstances = controllerBlockerCleanup.processInstances.map(
      ({ role }) => ({
        role,
        status: "not_started",
        pid: null,
        birthMarker: null,
        executable: null,
        terminated: true,
      }),
    );
    await writeControllerFinalization(controllerBlocker.runDir, {
      cleanup: controllerBlockerCleanup,
      cleanupProbe: controllerCleanupProbe(controllerBlocker, controllerBlockerCleanup),
      hostLease: releasedLease(),
      trustedOwnerToken: TRUSTED_OWNER_TOKEN,
      verdict: "inconclusive",
    });
    const controllerBlockerManifest = await createEvidenceManifest(controllerBlocker.runDir, {
      trustedOwnerToken: TRUSTED_OWNER_TOKEN,
    });
    assert.deepEqual(
      await verifyEvidenceManifest(controllerBlocker.runDir, {
        trustedOwnerToken: TRUSTED_OWNER_TOKEN,
      }),
      controllerBlockerManifest,
      "controller finalization must preserve staged pre-UI capture lifecycle",
    );

    const badLease = await createEvidenceFixture(root, { backend: "static_ssh" });
    await stageControllerEvidence(badLease.runDir, { verdict: "pass" });
    const badLeaseCleanup = cleanCleanup(badLease, { mode: "controller" });
    await assert.rejects(
      () =>
        finalizeControllerEvidence(badLease.runDir, {
          cleanup: badLeaseCleanup,
          cleanupProbe: controllerCleanupProbe(badLease, badLeaseCleanup),
          hostLease: {
            ...releasedLease(),
            releasedOwnerTokenHash: DIGEST_A,
          },
          trustedOwnerToken: TRUSTED_OWNER_TOKEN,
          verdict: "pass",
        }),
      /owner-matched release|released/i,
    );

    for (const [label, mutate, expected] of [
      ["not acquired", (lease) => (lease.acquired = false), /acquired and released/i],
      ["not released", (lease) => (lease.released = false), /acquired and released/i],
      ["repository mismatch", (lease) => (lease.repo = "other/repo"), /repo.*bound/i],
      ["job mismatch", (lease) => (lease.jobId = "other/job"), /jobId.*bound/i],
      ["attempt mismatch", (lease) => (lease.attempt = 2), /attempt.*bound/i],
      ["host mismatch", (lease) => (lease.host = "mac-e2e-02"), /host.*bound/i],
      [
        "zero owner hash",
        (lease) => {
          lease.acquiredOwnerTokenHash = "0".repeat(64);
          lease.releasedOwnerTokenHash = "0".repeat(64);
        },
        /zero|owner.*hash/i,
      ],
      [
        "acquire release mismatch",
        (lease) => (lease.releasedOwnerTokenHash = DIGEST_A),
        /owner-matched release|hash/i,
      ],
      ["trusted token mismatch", () => {}, /trusted owner token|hash/i],
    ]) {
      const fixture = await createEvidenceFixture(root, { backend: "static_ssh" });
      await stageControllerEvidence(fixture.runDir, { verdict: "pass" });
      const lease = structuredClone(releasedLease());
      mutate(lease);
      const cleanup = cleanCleanup(fixture, { mode: "controller" });
      await assert.rejects(
        () =>
          finalizeControllerEvidence(fixture.runDir, {
            cleanup,
            cleanupProbe: controllerCleanupProbe(fixture, cleanup),
            hostLease: lease,
            trustedOwnerToken:
              label === "trusted token mismatch" ? "wrong-owner-token" : TRUSTED_OWNER_TOKEN,
            verdict: "pass",
          }),
        expected,
        label,
      );
    }

    const localHostLease = await createEvidenceFixture(root);
    await mkdir(path.join(localHostLease.runDir, "runner"), { recursive: true });
    await writeFile(
      path.join(localHostLease.runDir, "runner", "host-lease.json"),
      `${JSON.stringify({ version: 1, ...releasedLease() })}\n`,
    );
    await assert.rejects(
      () =>
        finalizeLocalEvidence(localHostLease.runDir, {
          cleanup: cleanCleanup(localHostLease),
          verdict: "pass",
        }),
      /host-lease|local/i,
    );

    const controllerWithLocalCleanup = await createEvidenceFixture(root, {
      backend: "static_ssh",
    });
    await stageControllerEvidence(controllerWithLocalCleanup.runDir, { verdict: "pass" });
    const invalidControllerCleanup = cleanCleanup(controllerWithLocalCleanup);
    await assert.rejects(
      () =>
        finalizeControllerEvidence(controllerWithLocalCleanup.runDir, {
          cleanup: invalidControllerCleanup,
          cleanupProbe: controllerCleanupProbe(
            controllerWithLocalCleanup,
            invalidControllerCleanup,
          ),
          hostLease: releasedLease(),
          trustedOwnerToken: TRUSTED_OWNER_TOKEN,
          verdict: "pass",
        }),
      /ownershipMode|controller/i,
    );

    const pathFixture = await createEvidenceFixture(root);
    await assert.rejects(
      () =>
        createEvidenceManifest(pathFixture.runDir, {
          requiredPaths: ["state.json"],
        }),
      /options|requiredPaths|full evidence tree/i,
      "requiredPaths shortcut must be forbidden",
    );

    const emptyFixture = await createEvidenceFixture(root);
    await writeFile(path.join(emptyFixture.runDir, "empty.txt"), "");
    await assert.rejects(() => createEvidenceManifest(emptyFixture.runDir), /empty/i);

    const oversizedFixture = await createEvidenceFixture(root);
    await truncate(path.join(oversizedFixture.runDir, "events.json"), 268_435_457);
    await assert.rejects(
      () => createEvidenceManifest(oversizedFixture.runDir),
      /per-file|file.*limit|too large/i,
      "manifest hashing must reject a sparse file above the explicit per-file limit",
    );

    const fileCountFixture = await createEvidenceFixture(root);
    await mkdir(path.join(fileCountFixture.runDir, "extras"));
    await Promise.all(
      Array.from({ length: 513 }, (_, index) =>
        writeFile(
          path.join(fileCountFixture.runDir, "extras", `${String(index).padStart(3, "0")}.txt`),
          "bounded\n",
        ),
      ),
    );
    await assert.rejects(
      () => createEvidenceManifest(fileCountFixture.runDir),
      /file-count|file count|too many/i,
      "manifest traversal must enforce an explicit file-count bound before schema work",
    );

    const scannerSource = await readFile(
      path.join(process.cwd(), "tests/e2e/computer-use/evidence-scan.py"),
      "utf8",
    );
    for (const contract of [
      /O_DIRECTORY/,
      /O_NOFOLLOW/,
      /dir_fd=/,
      /os\.fstat/,
      /os\.read/,
      /MAX_TOTAL_BYTES|max_total_bytes/,
      /deadline/i,
    ]) {
      assert.match(
        scannerSource,
        contract,
        `descriptor-relative streaming scanner is missing ${contract}`,
      );
    }

    const symlinkFixture = await createEvidenceFixture(root);
    await symlink(
      path.join(symlinkFixture.runDir, "state.json"),
      path.join(symlinkFixture.runDir, "state-link.json"),
    );
    await assert.rejects(() => createEvidenceManifest(symlinkFixture.runDir), /symlink/i);

    const intermediateSymlinkFixture = await createEvidenceFixture(root);
    const symlinkTargetFixture = await createEvidenceFixture(root);
    await rm(path.join(intermediateSymlinkFixture.runDir, "screenshots"), {
      recursive: true,
      force: true,
    });
    await symlink(
      path.join(symlinkTargetFixture.runDir, "screenshots"),
      path.join(intermediateSymlinkFixture.runDir, "screenshots"),
    );
    await assert.rejects(
      () => createEvidenceManifest(intermediateSymlinkFixture.runDir),
      /symlink|direct directory|NOFOLLOW/i,
      "an intermediate-directory symlink swap must fail closed",
    );

    const rootSymlinkFixture = await createEvidenceFixture(root);
    const rootSymlink = path.join(root, "run-root-symlink");
    await symlink(rootSymlinkFixture.runDir, rootSymlink);
    await assert.rejects(() => createEvidenceManifest(rootSymlink), /canonical|symlink/i);

    const realAncestor = path.join(root, "real-ancestor");
    await mkdir(realAncestor);
    const ancestorFixture = await createEvidenceFixture(realAncestor);
    const ancestorSymlink = path.join(root, "ancestor-symlink");
    await symlink(realAncestor, ancestorSymlink);
    await assert.rejects(
      () =>
        createEvidenceManifest(path.join(ancestorSymlink, path.basename(ancestorFixture.runDir))),
      /canonical|symlink/i,
    );

    await assert.rejects(
      () => createEvidenceManifest(path.relative(process.cwd(), pathFixture.runDir)),
      /absolute|canonical/i,
    );

    const missingSafeFrame = await createEvidenceFixture(root);
    await rm(path.join(missingSafeFrame.runDir, "video", "computer-use-evidence.mp4"));
    await assert.rejects(
      () =>
        finalizeLocalEvidence(missingSafeFrame.runDir, {
          cleanup: cleanCleanup(missingSafeFrame),
          verdict: "pass",
        }),
      /safe-frame|missing|video/i,
      "the Node verifier must reject the language-neutral missing-safe-frame case",
    );
    executedNodeCases.add("missing-safe-frame");

    const rawVideo = await createEvidenceFixture(root);
    const rawState = JSON.parse(await readFile(path.join(rawVideo.runDir, "state.json"), "utf8"));
    rawState.video.path = "video/raw-whole-run.mp4";
    rawState.video.source = "screen-recording";
    await writeFile(
      path.join(rawVideo.runDir, "state.json"),
      `${JSON.stringify(rawState, null, 2)}\n`,
    );
    await writeFile(path.join(rawVideo.runDir, "video", "raw-whole-run.mp4"), "raw video\n");
    await finalizeLocalEvidence(rawVideo.runDir, {
      cleanup: cleanCleanup(rawVideo),
      verdict: "pass",
    }).then(
      () => assert.fail("raw whole-run video must be rejected"),
      (error) => assert.match(error.message, /curated safe-frame/i),
    );

    const extraVideoFile = await createEvidenceFixture(root);
    await writeFile(path.join(extraVideoFile.runDir, "video", "frames.txt"), "unsafe extra\n");
    await assert.rejects(
      () =>
        finalizeLocalEvidence(extraVideoFile.runDir, {
          cleanup: cleanCleanup(extraVideoFile),
          verdict: "pass",
        }),
      /only.*computer-use-evidence\\.mp4|video directory/i,
    );

    const extraScreenshot = await createEvidenceFixture(root);
    await writeFile(
      path.join(extraScreenshot.runDir, "screenshots", "untracked.png"),
      "untracked visual\n",
    );
    await assert.rejects(
      () =>
        finalizeLocalEvidence(extraScreenshot.runDir, {
          cleanup: cleanCleanup(extraScreenshot),
          verdict: "pass",
        }),
      /unreferenced visual files|untracked\\.png|PNG evidence|media/i,
    );

    for (const relativePath of [
      "screenshots/untracked.avif",
      "screenshots/untracked.svg",
      "untracked.pdf",
      "raw-evidence.bin",
      "notes.md",
    ]) {
      const fixture = await createEvidenceFixture(root);
      await mkdir(path.dirname(path.join(fixture.runDir, relativePath)), { recursive: true });
      await writeFile(path.join(fixture.runDir, relativePath), "unreferenced evidence\n");
      await assert.rejects(
        () =>
          finalizeLocalEvidence(fixture.runDir, {
            cleanup: cleanCleanup(fixture),
            verdict: "pass",
          }),
        /allowlist|unreferenced|forbidden evidence/i,
        relativePath,
      );
    }

    const corruptPng = await createEvidenceFixture(root);
    await writeFile(path.join(corruptPng.runDir, "screenshots", "launch.png"), "not a png\n");
    await assert.rejects(
      () =>
        finalizeLocalEvidence(corruptPng.runDir, {
          cleanup: cleanCleanup(corruptPng),
          verdict: "pass",
        }),
      /PNG|media|decode/i,
      "text with a .png suffix must not count as visual evidence",
    );

    const audioVideo = await createEvidenceFixture(root);
    const audioVideoPath = path.join(audioVideo.runDir, "video", "computer-use-evidence.mp4");
    const generatedAudioVideo = spawnSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-loop",
        "1",
        "-i",
        path.join(audioVideo.runDir, "screenshots", "launch.png"),
        "-f",
        "lavfi",
        "-i",
        "anullsrc=channel_layout=mono:sample_rate=8000",
        "-t",
        "0.1",
        "-r",
        "1",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-shortest",
        "-y",
        audioVideoPath,
      ],
      { encoding: "utf8", timeout: 10_000 },
    );
    assert.equal(
      generatedAudioVideo.status,
      0,
      generatedAudioVideo.stderr || generatedAudioVideo.error?.message,
    );
    await assert.rejects(
      () =>
        finalizeLocalEvidence(audioVideo.runDir, {
          cleanup: cleanCleanup(audioVideo),
          verdict: "pass",
        }),
      /exactly one video stream|audio|non-video stream/i,
      "the pinned ffprobe inventory must reject hidden audio or extra streams",
    );

    const corruptMp4 = await createEvidenceFixture(root);
    await writeFile(
      path.join(corruptMp4.runDir, "video", "computer-use-evidence.mp4"),
      "not an mp4\n",
    );
    await assert.rejects(
      () =>
        finalizeLocalEvidence(corruptMp4.runDir, {
          cleanup: cleanCleanup(corruptMp4),
          verdict: "pass",
        }),
      /MP4|media|decode/i,
      "text with an .mp4 suffix must not count as curated video evidence",
    );

    const passWithFailure = await createEvidenceFixture(root);
    const passWithFailureState = JSON.parse(
      await readFile(path.join(passWithFailure.runDir, "state.json"), "utf8"),
    );
    passWithFailureState.runFailure = {
      category: "product",
      code: "fixture_failure",
      summary: "A classified run failure exists.",
      infrastructureBlocker: false,
    };
    await writeFile(
      path.join(passWithFailure.runDir, "state.json"),
      `${JSON.stringify(passWithFailureState, null, 2)}\n`,
    );
    await assert.rejects(
      () =>
        finalizeLocalEvidence(passWithFailure.runDir, {
          cleanup: cleanCleanup(passWithFailure),
          verdict: "pass",
        }),
      /PASS|runFailure|run failure/i,
      "a classified run failure must make PASS impossible",
    );

    for (const extension of ["mp4", "mov", "m4v", "webm", "mkv", "avi", "mpeg", "mpg"]) {
      const fixture = await createEvidenceFixture(root);
      await writeFile(path.join(fixture.runDir, `raw-session.${extension}`), "raw video\n");
      await assert.rejects(
        () =>
          finalizeLocalEvidence(fixture.runDir, {
            cleanup: cleanCleanup(fixture),
            verdict: "pass",
          }),
        /raw whole-run video|forbidden video/i,
        extension,
      );
    }

    const missingSidecar = await createEvidenceFixture(root);
    await rm(path.join(missingSidecar.runDir, "runner", "permissions.json"));
    await assert.rejects(
      () =>
        finalizeLocalEvidence(missingSidecar.runDir, {
          cleanup: cleanCleanup(missingSidecar),
          verdict: "pass",
        }),
      /permissions\\.json|missing/i,
    );

    const cliController = await createEvidenceFixture(root, { backend: "static_ssh" });
    await stageControllerEvidence(cliController.runDir, { verdict: "pass" });
    const cleanupFile = path.join(root, "controller-cleanup.json");
    const cleanupProbeFile = path.join(root, "controller-cleanup-probe.json");
    const leaseFile = path.join(root, "controller-lease.json");
    const cliCleanup = cleanCleanup(cliController, { mode: "controller" });
    await writeFile(cleanupFile, `${JSON.stringify(cliCleanup)}\n`);
    await writeFile(
      cleanupProbeFile,
      `${JSON.stringify(controllerCleanupProbe(cliController, cliCleanup))}\n`,
    );
    await writeFile(leaseFile, `${JSON.stringify(releasedLease())}\n`);
    const metadataCli = spawnSync(
      process.execPath,
      [
        path.join(process.cwd(), "tests/e2e/computer-use/run-metadata.mjs"),
        "finalize-controller",
        "--run-dir",
        cliController.runDir,
        "--cleanup-file",
        cleanupFile,
        "--cleanup-probe-file",
        cleanupProbeFile,
        "--host-lease-file",
        leaseFile,
        "--verdict",
        "pass",
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          NIXMAC_E2E_HOST_LEASE_OWNER_TOKEN: TRUSTED_OWNER_TOKEN,
        },
      },
    );
    assert.equal(metadataCli.status, 0, metadataCli.stderr || metadataCli.stdout);
    const cliArchive = evidenceManifest.canonicalEvidenceArchivePaths(
      cliController.runDir,
    ).archivePath;
    const verifyCli = spawnSync(
      process.execPath,
      [
        path.join(process.cwd(), "tests/e2e/computer-use/evidence-manifest.mjs"),
        "verify",
        "--archive",
        cliArchive,
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          NIXMAC_E2E_HOST_LEASE_OWNER_TOKEN: TRUSTED_OWNER_TOKEN,
        },
      },
    );
    assert.equal(verifyCli.status, 0, verifyCli.stderr || verifyCli.stdout);
    const cliMaterialized = path.join(root, "controller-materialized");
    const materializeCli = spawnSync(
      process.execPath,
      [
        path.join(process.cwd(), "tests/e2e/computer-use/evidence-manifest.mjs"),
        "materialize",
        "--archive",
        cliArchive,
        "--out",
        cliMaterialized,
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          NIXMAC_E2E_HOST_LEASE_OWNER_TOKEN: TRUSTED_OWNER_TOKEN,
        },
      },
    );
    assert.equal(materializeCli.status, 0, materializeCli.stderr || materializeCli.stdout);
    assert.equal(
      JSON.parse(await readFile(path.join(cliMaterialized, "state.json"), "utf8")).verdict,
      "pass",
    );
    executedNodeCases.add("valid-static-released-owner-lease");
    assert.deepEqual(
      [...executedNodeCases].sort(),
      requiredNodeCases,
      "the Node verifier must execute every node-compatible language-neutral case",
    );

    console.log("Computer Use evidence manifest self-test passed.");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

await runSelfTest();
