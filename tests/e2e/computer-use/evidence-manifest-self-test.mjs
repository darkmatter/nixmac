#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { hashCuaBundleTree } from "./drivers/cua-driver.mjs";
import * as evidenceGuard from "./evidence-guard.mjs";
import { createEvidenceManifest, verifyEvidenceManifest } from "./evidence-manifest.mjs";
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
import { addEvent, saveState } from "./state.mjs";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);
const DIGEST_C = "c".repeat(64);
const VALID_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAACXBIWXMAAAABAAAAAQBPJcTWAAAAFElEQVR4nGNkIBGwjGoY1TB8NQAAYgAAPn161xsAAAAASUVORK5CYII=";
let fixtureSequence = 0;
let validMp4Fixture = null;

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
    runnerName: "mac-e2e-01",
    runnerBackend: "cilicon_tart",
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
  { backend = "cilicon_tart", writePreflight = true } = {},
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
  await writeFile(path.join(runDir, "events.json"), '[{"type":"fixture"}]\n');
  await writeFile(
    path.join(runDir, "state.json"),
    `${JSON.stringify(
      {
        verdict: "pass",
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
    NIXMAC_E2E_RUNNER_NAME: "mac-e2e-01",
    NIXMAC_E2E_RUNNER_BACKEND: "cilicon_tart",
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
        backend: "cilicon_tart",
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
      backend: mutateProbe.runnerBackend || "cilicon_tart",
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
        NIXMAC_E2E_RUNNER_NAME: "mac-e2e-01",
        NIXMAC_E2E_RUNNER_BACKEND: "cilicon_tart",
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
    const localManifest = await finalizeLocalEvidence(local.runDir, {
      cleanup: cleanCleanup(local),
      verdict: "pass",
    });
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
    assert.deepEqual(await verifyEvidenceManifest(local.runDir), localManifest);
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
      const blockerManifest = await finalizeLocalEvidence(blocker.runDir, {
        cleanup: blockerCleanup,
        verdict: "inconclusive",
        capture: {
          status: "not_started",
          uiStarted: false,
          reason: `${blockerCode} blocked execution before the UI lifecycle began`,
        },
      });
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
      "verified evidence must be immutable",
    );

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
    await assert.rejects(
      () => createEvidenceManifest(controller.runDir),
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
    let releaseWriter;
    let signalWriterEntered;
    const writerEntered = new Promise((resolve) => {
      signalWriterEntered = resolve;
    });
    const writerRelease = new Promise((resolve) => {
      releaseWriter = resolve;
    });
    const racedState = {
      ...JSON.parse(await readFile(path.join(racedSeal.runDir, "state.json"), "utf8")),
      runDir: racedSeal.runDir,
    };
    const heldWriter = evidenceGuard.withEvidenceTreeMutation(racedSeal.runDir, async () => {
      signalWriterEntered();
      await writerRelease;
      await writeFile(
        path.join(racedSeal.runDir, "state.json"),
        `${JSON.stringify(racedState, null, 2)}\n`,
      );
    });
    await writerEntered;
    const concurrentSeal = createEvidenceManifest(racedSeal.runDir, {
      trustedOwnerToken: TRUSTED_OWNER_TOKEN,
    });
    releaseWriter();
    await heldWriter;
    const racedManifest = await concurrentSeal;
    assert.deepEqual(
      await verifyEvidenceManifest(racedSeal.runDir, {
        trustedOwnerToken: TRUSTED_OWNER_TOKEN,
      }),
      racedManifest,
      "the sealer must wait for an in-flight writer and bind its completed write",
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
    for (const command of ["create", "verify"]) {
      const result = spawnSync(
        process.execPath,
        [
          path.join(process.cwd(), "tests/e2e/computer-use/evidence-manifest.mjs"),
          command,
          "--run-dir",
          cliController.runDir,
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
      assert.equal(result.status, 0, result.stderr || result.stdout);
    }

    console.log("Computer Use evidence manifest self-test passed.");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

await runSelfTest();
