#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createEvidenceManifest, verifyEvidenceManifest } from "./evidence-manifest.mjs";
import {
  assertRunPreflight,
  finalizeControllerEvidence,
  finalizeLocalEvidence,
  preflightInputFromEnvironment,
  stageControllerEvidence,
  writeControllerFinalization,
  writeRunPreflight,
} from "./run-metadata.mjs";
import { assertCuratedSafeFrameVideoMetadata, safeFrameVideoPath } from "./report.mjs";
import { prepareSuiteDriver } from "./run-remote-cua.mjs";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);
const DIGEST_C = "c".repeat(64);
let fixtureSequence = 0;

function validPreflight(appBundlePath) {
  return {
    jobId: "job-123",
    repo: "darkmatter/nixmac",
    mergeSha: SHA_A,
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
    appBundlePath,
    appBundleDigest: DIGEST_C,
    cuaDriverCliVersion: "0.12.6",
    cuaDriverAppVersion: "0.12.6",
    captureMode: "safe-frame",
    finalizationMode: "local-finalize",
    accessibilityGranted: true,
    screenRecordingGranted: true,
  };
}

async function createEvidenceFixture(root, { backend = "cilicon_tart" } = {}) {
  fixtureSequence += 1;
  const runDir = path.join(root, `run-${fixtureSequence}-${backend}`);
  const appBundlePath = path.join(root, `nixmac-${fixtureSequence}-${backend}.app`);
  await mkdir(path.join(appBundlePath, "Contents"), { recursive: true });
  await writeFile(path.join(appBundlePath, "Contents", "Info.plist"), "fixture app\n");
  await mkdir(path.join(runDir, "screenshots"), { recursive: true });
  await mkdir(path.join(runDir, "texts"), { recursive: true });
  await mkdir(path.join(runDir, "video"), { recursive: true });
  await writeFile(path.join(runDir, "screenshots", "launch.png"), "safe png fixture\n");
  await writeFile(path.join(runDir, "texts", "launch.txt"), "safe text fixture\n");
  await writeFile(path.join(runDir, "video", "computer-use-evidence.mp4"), "safe reel\n");
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
    runnerBackend: backend,
    finalizationMode: backend === "static_ssh" ? "controller-finalize" : "local-finalize",
  };
  await writeRunPreflight(runDir, input);
  return { appBundlePath, input, runDir };
}

function cleanCleanup() {
  return {
    attempted: true,
    restored: true,
    clean: true,
    ownedPaths: ["/private/tmp/nixmac-e2e-job-123"],
    remainingProcesses: [],
    failureReason: "",
  };
}

function releasedLease() {
  return {
    ownerTokenHash: DIGEST_A,
    acquired: true,
    released: true,
    acquiredAt: "2026-07-26T00:00:00.000Z",
    releasedAt: "2026-07-26T00:05:00.000Z",
    lastHeartbeatAt: "2026-07-26T00:04:30.000Z",
    waitReason: "",
    quarantineReason: "",
  };
}

async function runSelfTest() {
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
  const root = await mkdtemp(path.join(os.tmpdir(), "nixmac-evidence-manifest-"));
  try {
    const valid = await createEvidenceFixture(root);
    const asserted = await assertRunPreflight(valid.runDir, {
      computeAppBundleDigest: async () => DIGEST_C,
    });
    assert.equal(asserted.app.appBundleDigest, DIGEST_C);

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
        NIXMAC_E2E_JOB_ID: "job-123",
        NIXMAC_E2E_REPO: "darkmatter/nixmac",
        NIXMAC_E2E_MERGE_SHA: SHA_A,
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

    const local = await createEvidenceFixture(root);
    const localManifest = await finalizeLocalEvidence(local.runDir, {
      cleanup: cleanCleanup(),
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
    await assert.rejects(
      () =>
        finalizeLocalEvidence(local.runDir, {
          cleanup: {
            ...cleanCleanup(),
            ownedPaths: ["/private/tmp/must-not-mutate-sealed-evidence"],
          },
          verdict: "pass",
        }),
      /immutable|already exists/i,
    );
    assert.deepEqual(
      await verifyEvidenceManifest(local.runDir),
      localManifest,
      "a repeated finalization attempt must not mutate an already sealed tree",
    );

    await writeFile(path.join(local.runDir, "texts", "launch.txt"), "mutated evidence\n");
    await assert.rejects(
      () => verifyEvidenceManifest(local.runDir),
      /digest mismatch/i,
      "verified evidence must be immutable",
    );

    const controller = await createEvidenceFixture(root, { backend: "static_ssh" });
    await stageControllerEvidence(controller.runDir, { verdict: "pass" });
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
    await writeControllerFinalization(controller.runDir, {
      cleanup: cleanCleanup(),
      hostLease: releasedLease(),
      verdict: "pass",
    });
    await assert.rejects(
      () => readFile(path.join(controller.runDir, "manifest.json"), "utf8"),
      /ENOENT/,
      "controller sidecar finalization must remain separate from manifest creation",
    );
    const controllerManifest = await createEvidenceManifest(controller.runDir);
    await verifyEvidenceManifest(controller.runDir);
    assert.equal(controllerManifest.runner.backend, "static_ssh");
    assert.deepEqual(await verifyEvidenceManifest(controller.runDir), controllerManifest);

    const badLease = await createEvidenceFixture(root, { backend: "static_ssh" });
    await stageControllerEvidence(badLease.runDir, { verdict: "pass" });
    await assert.rejects(
      () =>
        finalizeControllerEvidence(badLease.runDir, {
          cleanup: cleanCleanup(),
          hostLease: { ...releasedLease(), released: false },
          verdict: "pass",
        }),
      /owner-matched release|released/i,
    );

    const pathFixture = await createEvidenceFixture(root);
    for (const [label, paths, expected] of [
      ["absolute", ["/tmp/escape"], /relative/i],
      ["parent", ["../escape"], /parent|relative/i],
      ["duplicate", ["state.json", "state.json"], /duplicate/i],
      ["missing", ["state.json", "missing.json"], /missing/i],
    ]) {
      await assert.rejects(
        () =>
          createEvidenceManifest(pathFixture.runDir, {
            requiredPaths: paths,
          }),
        expected,
        label,
      );
    }

    const emptyFixture = await createEvidenceFixture(root);
    await writeFile(path.join(emptyFixture.runDir, "empty.txt"), "");
    await assert.rejects(
      () =>
        createEvidenceManifest(emptyFixture.runDir, {
          requiredPaths: ["empty.txt"],
        }),
      /empty/i,
    );

    const symlinkFixture = await createEvidenceFixture(root);
    await symlink(
      path.join(symlinkFixture.runDir, "state.json"),
      path.join(symlinkFixture.runDir, "state-link.json"),
    );
    await assert.rejects(
      () =>
        createEvidenceManifest(symlinkFixture.runDir, {
          requiredPaths: ["state-link.json"],
        }),
      /symlink/i,
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
      cleanup: cleanCleanup(),
      verdict: "pass",
    }).then(
      () => assert.fail("raw whole-run video must be rejected"),
      (error) => assert.match(error.message, /curated safe-frame/i),
    );

    const missingSidecar = await createEvidenceFixture(root);
    await rm(path.join(missingSidecar.runDir, "runner", "permissions.json"));
    await assert.rejects(
      () =>
        finalizeLocalEvidence(missingSidecar.runDir, {
          cleanup: cleanCleanup(),
          verdict: "pass",
        }),
      /permissions\\.json|missing/i,
    );

    console.log("Computer Use evidence manifest self-test passed.");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

await runSelfTest();
