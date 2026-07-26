#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { dispatchLocalCuaCommand, localCuaUsage } from "./cli.mjs";
import { CuaDriver, hashCuaBundleTree } from "./drivers/cua-driver.mjs";
import { verifyEvidenceManifest } from "./evidence-manifest.mjs";
import { redact } from "./redaction.mjs";
import { preflightInputFromEnvironment } from "./run-metadata.mjs";
import {
  classifySuiteFailure,
  createOwnedCuaSocketEndpoint,
  prepareSuiteDriver,
  renderSuiteErrorReport,
  runSmokeWithDriver,
  runSuiteWithDriver,
  validateLocalCuaPreflight,
  verifyLocalCuaPreflight,
  writeAndAssertLocalRunPreflight,
} from "./run-remote-cua.mjs";

export function createLocalCuaDriver(options, { DriverClass = CuaDriver, env = process.env } = {}) {
  const driverOptions = {
    appBundleId: options.app,
    binary: env.NIXMAC_CUA_DRIVER_BINARY || "cua-driver",
    runDir: options.runDir,
  };
  if (options.socketPath || env.NIXMAC_CUA_DRIVER_SOCKET) {
    driverOptions.socketPath = options.socketPath || env.NIXMAC_CUA_DRIVER_SOCKET;
  }
  return new DriverClass(driverOptions);
}

export async function runLocalCuaSuite(
  args,
  { runSuite = runSuiteWithDriver, DriverClass = CuaDriver, env = process.env } = {},
) {
  return runSuite(args, {
    createDriver: (options) =>
      createLocalCuaDriver(options, {
        DriverClass,
        env,
      }),
    env,
    executionTopology: "local-cua-driver",
  });
}

export async function runLocalCuaSmoke(
  args,
  { runSmoke = runSmokeWithDriver, DriverClass = CuaDriver, env = process.env } = {},
) {
  return runSmoke(args, {
    createDriver: (options) =>
      createLocalCuaDriver(options, {
        DriverClass,
        env,
      }),
    env,
    executionTopology: "local-cua-driver",
  });
}

async function runSelfTest() {
  const hashSelfTestBundleTree =
    process.platform === "darwin"
      ? hashCuaBundleTree
      : async () => "1551c9dc7b53067f36e26c19c1ee2eb3c307b5cde1deaff10fc458030ec8542d";
  assert.match(localCuaUsage({ defaultApp: "com.darkmatter.nixmac" }), /local-cua-driver/);
  assert.match(
    localCuaUsage({ defaultApp: "com.darkmatter.nixmac" }),
    /run-cua-driver\.mjs smoke --run-dir <artifact-run-dir>/,
  );
  for (const documentUrl of [
    new URL("./README.md", import.meta.url),
    new URL("./OPERATIONS.md", import.meta.url),
  ]) {
    const documentation = await readFile(documentUrl, "utf8");
    assert.match(
      documentation,
      /run-cua-driver\.mjs smoke --run-dir/,
      `${path.basename(documentUrl.pathname)} must document the exact smoke invocation`,
    );
    assert.match(
      documentation,
      /launch.*Settings.*report/i,
      `${path.basename(documentUrl.pathname)} must document the bounded smoke contract`,
    );
  }
  const dispatches = [];
  const exits = [];
  await dispatchLocalCuaCommand(
    ["run", "--run-dir", "/tmp/local-run"],
    {
      run: async (args) => dispatches.push(["run", args]),
      selfTest: async () => dispatches.push(["selfTest", []]),
      smoke: async (args) => dispatches.push(["smoke", args]),
    },
    {
      usage: () => dispatches.push(["usage"]),
      exit: (code) => exits.push(code),
    },
  );
  assert.deepEqual(dispatches.pop(), ["run", ["--run-dir", "/tmp/local-run"]]);
  await dispatchLocalCuaCommand(
    ["smoke", "--run-dir", "/tmp/local-smoke"],
    {
      run: async (args) => dispatches.push(["run", args]),
      selfTest: async () => dispatches.push(["selfTest", []]),
      smoke: async (args) => dispatches.push(["smoke", args]),
    },
    {
      usage: () => dispatches.push(["usage"]),
      exit: (code) => exits.push(code),
    },
  );
  assert.deepEqual(dispatches.pop(), ["smoke", ["--run-dir", "/tmp/local-smoke"]]);
  await dispatchLocalCuaCommand(
    ["self-test", "--ignored"],
    {
      run: async (args) => dispatches.push(["run", args]),
      selfTest: async () => dispatches.push(["selfTest", []]),
      smoke: async (args) => dispatches.push(["smoke", args]),
    },
    {
      usage: () => dispatches.push(["usage"]),
      exit: (code) => exits.push(code),
    },
  );
  assert.deepEqual(dispatches.pop(), ["selfTest", []]);

  assert.equal(
    typeof runSuiteWithDriver,
    "function",
    "shared runner must export runSuiteWithDriver for dependency injection",
  );
  class FakeCuaDriver {
    constructor(options) {
      this.options = options;
    }
  }
  const configuredDriver = createLocalCuaDriver(
    {
      app: "com.darkmatter.nixmac",
      runDir: "/tmp/local-run",
    },
    {
      DriverClass: FakeCuaDriver,
      env: {
        NIXMAC_CUA_DRIVER_BINARY: "/opt/pinned/cua-driver",
        NIXMAC_CUA_DRIVER_SOCKET: "/tmp/local-run.sock",
      },
    },
  );
  assert.deepEqual(configuredDriver.options, {
    appBundleId: "com.darkmatter.nixmac",
    binary: "/opt/pinned/cua-driver",
    runDir: "/tmp/local-run",
    socketPath: "/tmp/local-run.sock",
  });
  assert.equal(
    Object.hasOwn(configuredDriver.options, "attachSocket"),
    false,
    "local entrypoint must never attach to a pre-existing daemon socket",
  );
  const defaultSocketDriver = createLocalCuaDriver(
    {
      app: "com.darkmatter.nixmac",
      runDir: "/tmp/local-run",
      socketPath: "/tmp/nx-cua-owned-123/d.sock",
    },
    {
      DriverClass: FakeCuaDriver,
      env: {},
    },
  );
  assert.deepEqual(defaultSocketDriver.options, {
    appBundleId: "com.darkmatter.nixmac",
    binary: "cua-driver",
    runDir: "/tmp/local-run",
    socketPath: "/tmp/nx-cua-owned-123/d.sock",
  });
  const explicitSocketDirectory = path.join(
    await realpath(os.tmpdir()),
    `nx-cua-explicit-${process.pid}-${Date.now()}`,
  );
  const explicitSocketPath = path.join(explicitSocketDirectory, "owned.sock");
  const explicitSocketEndpoint = await createOwnedCuaSocketEndpoint({
    requestedPath: explicitSocketPath,
  });
  assert.deepEqual(explicitSocketEndpoint, {
    directory: explicitSocketDirectory,
    path: explicitSocketPath,
  });
  await assert.rejects(
    () => createOwnedCuaSocketEndpoint({ requestedPath: explicitSocketPath }),
    /must not already exist/,
    "an explicit socket endpoint must remain uniquely owned",
  );
  await rm(explicitSocketDirectory, { force: true, recursive: true });
  const suiteCalls = [];
  await runLocalCuaSuite(["--run-dir", "/tmp/local-run"], {
    runSuite: async (args, injected) => {
      suiteCalls.push({
        args,
        env: injected.env,
        executionTopology: injected.executionTopology,
      });
      const created = injected.createDriver({
        app: "com.darkmatter.nixmac",
        runDir: "/tmp/local-run",
      });
      suiteCalls.push({ driverOptions: created.options });
    },
    DriverClass: FakeCuaDriver,
    env: {},
  });
  assert.deepEqual(suiteCalls, [
    {
      args: ["--run-dir", "/tmp/local-run"],
      env: {},
      executionTopology: "local-cua-driver",
    },
    {
      driverOptions: {
        appBundleId: "com.darkmatter.nixmac",
        binary: "cua-driver",
        runDir: "/tmp/local-run",
      },
    },
  ]);
  const artifactSha = "a".repeat(40);
  const runDir = "/tmp/nixmac-e2e-run-123";
  const appPath = "/tmp/nixmac-e2e-run-123/nixmac.app";
  const disposableConfigPath = "/tmp/nixmac-e2e-run-123/config";
  const preflight = await validateLocalCuaPreflight(
    {
      appBundleId: "com.darkmatter.nixmac",
      runDir,
    },
    {
      env: {
        NIXMAC_E2E_DISPOSABLE_CONFIG: "true",
        NIXMAC_E2E_APP_ARTIFACT_SHA: artifactSha,
        NIXMAC_E2E_APP_PATH: appPath,
        NIXMAC_E2E_STAGING_PARENT: runDir,
        NIXMAC_E2E_DISPOSABLE_CONFIG_PATH: disposableConfigPath,
      },
      canonicalPath: async (value) => value,
      readBundleIdentity: async () => ({
        bundleId: "com.darkmatter.nixmac",
        digestSha256: "b".repeat(64),
      }),
    },
  );
  assert.deepEqual(preflight, {
    appArtifactSha: artifactSha,
    appBundleDigestSha256: "b".repeat(64),
    appBundleId: "com.darkmatter.nixmac",
    appPath,
    disposableConfigPath,
    stagingParent: runDir,
  });
  await assert.rejects(
    () =>
      verifyLocalCuaPreflight(preflight, {
        readBundleIdentity: async () => ({
          bundleId: "com.darkmatter.nixmac",
          digestSha256: "c".repeat(64),
        }),
      }),
    /bundle digest changed after target preparation/,
  );
  assert.deepEqual(
    await verifyLocalCuaPreflight(preflight, {
      readBundleIdentity: async () => ({
        bundleId: "com.darkmatter.nixmac",
        digestSha256: "b".repeat(64),
      }),
    }),
    preflight,
  );
  const metadataEnv = {
    NIXMAC_E2E_JOB_ID: `darkmatter/nixmac:${artifactSha}:computer-use-v1`,
    NIXMAC_E2E_REPO: "darkmatter/nixmac",
    GITHUB_REPOSITORY: "darkmatter/nixmac",
    NIXMAC_E2E_MERGE_SHA: artifactSha,
    NIXMAC_E2E_APP_ARTIFACT_SHA: artifactSha,
    NIXMAC_E2E_SUITE_VERSION: "computer-use-v1",
    NIXMAC_E2E_HARNESS_SHA: "d".repeat(40),
    NIXMAC_E2E_ACTIONS_RUN_ID: "123456",
    NIXMAC_E2E_ACTIONS_JOB_ID: "789012",
    NIXMAC_E2E_ATTEMPT: "1",
    NIXMAC_E2E_RUNNER_NAME: "mac-e2e-01",
    NIXMAC_E2E_RUNNER_BACKEND: "cilicon_tart",
    NIXMAC_E2E_RUNNER_IMAGE_DIGEST: `sha256:${"e".repeat(64)}`,
    NIXMAC_E2E_BUILD_RUN_ID: "456789",
    NIXMAC_E2E_ARTIFACT_ID: "987654",
    NIXMAC_E2E_ARTIFACT_DIGEST: `sha256:${"f".repeat(64)}`,
    NIXMAC_E2E_FINALIZATION_MODE: "local-finalize",
    NIXMAC_E2E_ATTEMPT_STARTED_AT: "2026-07-26T00:00:00.000Z",
  };
  const writtenPreflights = [];
  const assertedPreflights = [];
  const connectedMetadataDriver = {
    connected: true,
    socketPath: "/tmp/nx-cua-run-123/d.sock",
    metadata: {
      cli: { version: "0.12.6" },
      app: { short_version: "0.12.6" },
    },
  };
  await writeAndAssertLocalRunPreflight(
    {
      driver: connectedMetadataDriver,
      localPreflight: preflight,
      runDir,
    },
    {
      env: metadataEnv,
      resolvePreflight: async (input) => preflightInputFromEnvironment(input),
      writePreflight: async (targetRunDir, input) =>
        writtenPreflights.push({ input, runDir: targetRunDir }),
      assertPreflight: async (targetRunDir) => assertedPreflights.push(targetRunDir),
    },
  );
  assert.equal(writtenPreflights[0].input.accessibilityGranted, true);
  assert.equal(writtenPreflights[0].input.screenRecordingGranted, true);
  assert.equal(writtenPreflights[0].input.appBundleDigest, "b".repeat(64));
  assert.deepEqual(assertedPreflights, [runDir]);
  let missingIdentityPrepareCalls = 0;
  const missingIdentityDriver = {
    connected: false,
    socketPath: connectedMetadataDriver.socketPath,
    metadata: connectedMetadataDriver.metadata,
    async connect() {
      this.connected = true;
    },
    async prepareTarget() {
      missingIdentityPrepareCalls += 1;
    },
  };
  const missingJobEnv = { ...metadataEnv };
  delete missingJobEnv.NIXMAC_E2E_JOB_ID;
  await assert.rejects(
    () =>
      prepareSuiteDriver(missingIdentityDriver, {
        executionTopology: "local-cua-driver",
        appBundleId: "com.darkmatter.nixmac",
        localPreflight: preflight,
        beforePrepareTarget: () =>
          writeAndAssertLocalRunPreflight(
            {
              driver: missingIdentityDriver,
              localPreflight: preflight,
              runDir,
            },
            {
              env: missingJobEnv,
              resolvePreflight: async (input) => preflightInputFromEnvironment(input),
              writePreflight: async () => assert.fail("invalid identity must not write sidecars"),
              assertPreflight: async () => assert.fail("invalid identity must not be asserted"),
            },
          ),
      }),
    /jobId/i,
  );
  assert.equal(
    missingIdentityPrepareCalls,
    0,
    "missing workflow identity must fail before prepareTarget",
  );
  await assert.rejects(
    () =>
      validateLocalCuaPreflight(
        {
          appBundleId: "com.darkmatter.nixmac",
          runDir: "relative-run",
        },
        {
          env: {
            NIXMAC_E2E_DISPOSABLE_CONFIG: "true",
            NIXMAC_E2E_APP_ARTIFACT_SHA: artifactSha,
            NIXMAC_E2E_APP_PATH: "/tmp/relative-run/nixmac.app",
          },
          canonicalPath: async (value) => value,
          readBundleIdentity: async () => ({
            bundleId: "com.darkmatter.nixmac",
            digestSha256: "b".repeat(64),
          }),
        },
      ),
    /runDir must be an absolute normalized path/,
  );
  await assert.rejects(
    () =>
      validateLocalCuaPreflight(
        {
          appBundleId: "com.darkmatter.nixmac",
          runDir: "/Applications",
        },
        {
          env: {
            NIXMAC_E2E_DISPOSABLE_CONFIG: "true",
            NIXMAC_E2E_APP_ARTIFACT_SHA: artifactSha,
            NIXMAC_E2E_APP_PATH: "/Applications/nixmac.app",
          },
          canonicalPath: async (value) => value,
          readBundleIdentity: async () => ({
            bundleId: "com.darkmatter.nixmac",
            digestSha256: "b".repeat(64),
          }),
        },
      ),
    /shared Applications path/,
  );
  for (const [label, envOverride, expected] of [
    ["disposable config", { NIXMAC_E2E_DISPOSABLE_CONFIG: "false" }, /DISPOSABLE_CONFIG=true/],
    ["artifact SHA", { NIXMAC_E2E_APP_ARTIFACT_SHA: "short" }, /full lowercase 40-character SHA/],
    [
      "run-specific path",
      { NIXMAC_E2E_APP_PATH: "/tmp/another-run/nixmac.app" },
      /run-specific directory/,
    ],
    [
      "remote transport",
      { NIXMAC_E2E_REMOTE_SSH_DEST: "remote.example.invalid" },
      /forbids remote transport environment/,
    ],
    [
      "WebSocket transport",
      { NIXMAC_COMPUTER_USE_WS: "ws://127.0.0.1:18790" },
      /forbids remote transport environment/,
    ],
  ]) {
    await assert.rejects(
      () =>
        validateLocalCuaPreflight(
          {
            appBundleId: "com.darkmatter.nixmac",
            runDir,
          },
          {
            env: {
              NIXMAC_E2E_DISPOSABLE_CONFIG: "true",
              NIXMAC_E2E_APP_ARTIFACT_SHA: artifactSha,
              NIXMAC_E2E_APP_PATH: appPath,
              NIXMAC_E2E_STAGING_PARENT: runDir,
              NIXMAC_E2E_DISPOSABLE_CONFIG_PATH: disposableConfigPath,
              ...envOverride,
            },
            canonicalPath: async (value) => value,
            readBundleIdentity: async () => ({
              bundleId: "com.darkmatter.nixmac",
              digestSha256: "b".repeat(64),
            }),
          },
        ),
      expected,
      label,
    );
  }
  await assert.rejects(
    () =>
      validateLocalCuaPreflight(
        {
          appBundleId: "com.darkmatter.nixmac",
          runDir,
        },
        {
          env: {
            NIXMAC_E2E_DISPOSABLE_CONFIG: "true",
            NIXMAC_E2E_APP_ARTIFACT_SHA: artifactSha,
            NIXMAC_E2E_APP_PATH: appPath,
            NIXMAC_E2E_STAGING_PARENT: runDir,
            NIXMAC_E2E_DISPOSABLE_CONFIG_PATH: disposableConfigPath,
          },
          canonicalPath: async () => "/private/tmp/nixmac-e2e-run-123/nixmac.app",
          readBundleIdentity: async () => ({
            bundleId: "com.darkmatter.nixmac",
            digestSha256: "b".repeat(64),
          }),
        },
      ),
    /must be canonical/,
  );
  await assert.rejects(
    () =>
      validateLocalCuaPreflight(
        {
          appBundleId: "com.darkmatter.nixmac",
          runDir,
        },
        {
          env: {
            NIXMAC_E2E_DISPOSABLE_CONFIG: "true",
            NIXMAC_E2E_APP_ARTIFACT_SHA: artifactSha,
            NIXMAC_E2E_APP_PATH: appPath,
            NIXMAC_E2E_STAGING_PARENT: runDir,
            NIXMAC_E2E_DISPOSABLE_CONFIG_PATH: disposableConfigPath,
          },
          canonicalPath: async (value) => value,
          readBundleIdentity: async () => ({
            bundleId: "com.example.replacement",
            digestSha256: "b".repeat(64),
          }),
        },
      ),
    /bundle ID mismatch/,
  );

  const calls = [];
  const driver = {
    async connect() {
      calls.push(["connect"]);
    },
    async prepareTarget(input) {
      calls.push(["prepareTarget", input]);
    },
    async visibleState() {
      calls.push(["visibleState"]);
      return { text: "", imageBase64: "", target: null, metadata: {} };
    },
    async click() {},
    async setValue() {},
    async close() {},
  };
  await prepareSuiteDriver(driver, {
    executionTopology: "local-cua-driver",
    appBundleId: "com.darkmatter.nixmac",
    localPreflight: preflight,
  });
  await driver.visibleState();
  assert.deepEqual(calls, [
    ["connect"],
    [
      "prepareTarget",
      {
        appBundleId: "com.darkmatter.nixmac",
        appPath,
      },
    ],
    ["visibleState"],
  ]);
  let stateObserved = false;
  const competingProcessDriver = {
    ...driver,
    async connect() {},
    async prepareTarget() {
      throw new Error("competing com.darkmatter.nixmac process is already running");
    },
    async visibleState() {
      stateObserved = true;
    },
  };
  await assert.rejects(
    () =>
      prepareSuiteDriver(competingProcessDriver, {
        executionTopology: "local-cua-driver",
        appBundleId: "com.darkmatter.nixmac",
        localPreflight: preflight,
      }),
    /competing .* process/,
  );
  assert.equal(
    stateObserved,
    false,
    "pre-existing same-bundle failure must occur before visible-state capture",
  );

  const transportProbeRoot = await mkdtemp(path.join(os.tmpdir(), "nixmac-local-transport-probe-"));
  const transportRunDir = path.join(transportProbeRoot, "probe-run");
  const transportAppInputPath = path.join(transportProbeRoot, "staging", "probe-run", "nixmac.app");
  await mkdir(path.join(transportAppInputPath, "Contents"), { recursive: true });
  const transportAppPath = await realpath(transportAppInputPath);
  const transportConfigPath = path.join(path.dirname(transportAppPath), "config");
  await mkdir(transportConfigPath, { recursive: true });
  await writeFile(
    path.join(transportAppPath, "Contents", "Info.plist"),
    "bounded local transport probe\n",
    "utf8",
  );
  await writeFile(path.join(transportConfigPath, "flake.nix"), "transport config\n", "utf8");
  const transportAppDigest = await hashSelfTestBundleTree(transportAppPath);
  const transportCalls = [];
  const forbiddenTransport = (name) => () => {
    transportCalls.push(name);
    throw new Error(`negative-control forbidden transport invoked: ${name}`);
  };
  const websocketBoundary = forbiddenTransport("websocket");
  const transportBoundaries = {
    inspectReportWithComputerUse: forbiddenTransport("browser-inspection"),
    scpToRemote: forbiddenTransport("scp"),
    ssh: forbiddenTransport("ssh"),
  };
  let competingDriverClosed = 0;
  let allocatedSocketPath = "";
  class CompetingProcessDriver {
    constructor(options, expectedAppPath = transportAppPath) {
      this.connected = false;
      this.expectedAppPath = expectedAppPath;
      assert.equal(
        typeof options.socketPath,
        "string",
        "local run must allocate its owned socket before constructing CuaDriver",
      );
      assert.ok(Buffer.byteLength(options.socketPath, "utf8") <= 103);
      assert.match(path.basename(path.dirname(options.socketPath)), /^nx-cua-/);
      assert.notEqual(path.dirname(options.socketPath), path.dirname(transportAppPath));
      allocatedSocketPath = options.socketPath;
      this.socketPath = options.socketPath;
      this.metadata = {
        app: { short_version: "0.12.6" },
        cli: { version: "0.12.6" },
      };
    }
    async connect() {
      this.connected = true;
    }
    async prepareTarget(input) {
      assert.deepEqual(input, {
        appBundleId: "com.darkmatter.nixmac",
        appPath: this.expectedAppPath,
      });
      throw new Error("competing com.darkmatter.nixmac process is already running with pid 4242");
    }
    async visibleState() {
      throw new Error("visible state must not run after a competing-process blocker");
    }
    async click() {}
    async setValue() {}
    async close() {
      competingDriverClosed += 1;
    }
  }
  const transportEnv = {
    ...metadataEnv,
    NIXMAC_COMPUTER_USE_APP: "com.darkmatter.nixmac",
    NIXMAC_E2E_APP_ARTIFACT_SHA: artifactSha,
    NIXMAC_E2E_APP_PATH: transportAppPath,
    NIXMAC_E2E_DISPOSABLE_CONFIG: "true",
    NIXMAC_E2E_STAGING_PARENT: path.dirname(transportAppPath),
    NIXMAC_E2E_DISPOSABLE_CONFIG_PATH: path.join(path.dirname(transportAppPath), "config"),
  };
  let competingProcessError;
  try {
    await runSuiteWithDriver(["--run-dir", transportRunDir], {
      createDriver: (options) => {
        if (options.ws !== undefined) websocketBoundary(options.ws);
        return new CompetingProcessDriver(options);
      },
      env: transportEnv,
      executionTopology: "local-cua-driver",
      localPreflightDependencies: {
        canonicalPath: async (value) => value,
        readBundleIdentity: async () => ({
          bundleId: "com.darkmatter.nixmac",
          digestSha256: transportAppDigest,
        }),
      },
      runPreflightDependencies: {
        resolvePreflight: async (input) => preflightInputFromEnvironment(input),
      },
      transportBoundaries,
    });
  } catch (error) {
    competingProcessError = error;
  }
  assert.match(competingProcessError?.message || "", /competing .* pid 4242/);
  if (process.platform === "darwin") {
    assert.notEqual(
      transportRunDir,
      await realpath(transportRunDir),
      "the macOS fallback probe must exercise the /var to /private/var alias",
    );
  }
  await renderSuiteErrorReport(competingProcessError, ["--run-dir", transportRunDir], {
    env: transportEnv,
    executionTopology: "local-cua-driver",
  });
  const transportState = JSON.parse(
    await readFile(path.join(transportRunDir, "state.json"), "utf8"),
  );
  assert.equal(transportState.executionTopology, "local-cua-driver");
  assert.deepEqual(transportState.localApp, {
    artifactSha,
    bundleDigestSha256: transportAppDigest,
    bundleId: "com.darkmatter.nixmac",
    path: transportAppPath,
  });
  assert.equal(transportState.scenarios.reportInspection.status, "not_required");
  assert.deepEqual(
    {
      category: transportState.runFailure?.category,
      code: transportState.runFailure?.code,
      infrastructureBlocker: transportState.runFailure?.infrastructureBlocker,
      phase: transportState.runFailure?.phase,
    },
    {
      category: "infrastructure",
      code: "competing_process",
      infrastructureBlocker: true,
      phase: "target_preparation",
    },
  );
  assert.equal(competingDriverClosed, 1);
  await assert.rejects(
    () => lstat(path.dirname(allocatedSocketPath)),
    /ENOENT/,
    "owned socket directory must be absent after cleanup",
  );
  const transportAttempt = JSON.parse(
    await readFile(path.join(transportRunDir, "attempt.json"), "utf8"),
  );
  const transportCleanup = JSON.parse(
    await readFile(path.join(transportRunDir, "runner", "cleanup.json"), "utf8"),
  );
  assert.deepEqual(transportAttempt.capture, {
    status: "not_started",
    uiStarted: false,
    reason: "competing com.darkmatter.nixmac process is already running with pid 4242",
  });
  assert.equal(transportAttempt.lifecycle.current, "ABORTED");
  assert.deepEqual(
    transportAttempt.lifecycle.history.map((transition) => transition.state),
    ["PROVISIONING", "READY", "ABORTED"],
  );
  assert.equal(
    transportAttempt.failureClass,
    "infrastructure",
    "a classified competing-process blocker must not be normalized as a product failure",
  );
  assert.ok(
    Date.parse(transportCleanup.completedAt) <= Date.parse(transportAttempt.endedAt),
    "cleanup must complete before the attempt is finalized",
  );
  assert.deepEqual(
    transportCleanup.processInstances.map(({ role, status }) => ({ role, status })),
    [
      { role: "target", status: "not_started" },
      { role: "daemon", status: "not_started" },
    ],
  );
  assert.deepEqual(
    transportCleanup.ownedPaths.map(({ kind, observedFinalState }) => ({
      kind,
      observedFinalState,
    })),
    [
      { kind: "staging-parent", observedFinalState: "absent" },
      { kind: "app-bundle", observedFinalState: "absent" },
      { kind: "disposable-config", observedFinalState: "absent" },
      { kind: "daemon-socket-directory", observedFinalState: "absent" },
      { kind: "daemon-socket", observedFinalState: "absent" },
    ],
  );
  assert.equal(existsSync(transportAppPath), false);
  assert.equal(existsSync(transportConfigPath), false);
  assert.equal(existsSync(path.dirname(transportAppPath)), false);
  assert.equal(existsSync(path.dirname(allocatedSocketPath)), false);
  const transportManifest = await verifyEvidenceManifest(await realpath(transportRunDir));
  assert.equal(
    transportManifest.files.some(
      (file) => file.path.startsWith("screenshots/") || file.path.startsWith("video/"),
    ),
    false,
    "a pre-UI competing-process blocker must seal without fabricated visual evidence",
  );
  assert.deepEqual(transportCalls, []);
  for (const [name, boundary] of [
    ["websocket", websocketBoundary],
    ["browser-inspection", transportBoundaries.inspectReportWithComputerUse],
    ["scp", transportBoundaries.scpToRemote],
    ["ssh", transportBoundaries.ssh],
  ]) {
    assert.throws(
      boundary,
      new RegExp(`negative-control forbidden transport invoked: ${name}`),
      `${name} transport boundary negative control must fail if invoked`,
    );
  }
  assert.deepEqual(transportCalls, ["websocket", "browser-inspection", "scp", "ssh"]);

  const relativeRunDir = path.join(transportProbeRoot, "relative-run");
  const relativeRunDirArg = path.relative(process.cwd(), relativeRunDir);
  assert.equal(path.isAbsolute(relativeRunDirArg), false);
  const relativeAppInputPath = path.join(
    transportProbeRoot,
    "staging",
    "relative-run",
    "nixmac.app",
  );
  await mkdir(path.join(relativeAppInputPath, "Contents"), { recursive: true });
  const relativeAppPath = await realpath(relativeAppInputPath);
  const relativeConfigPath = path.join(path.dirname(relativeAppPath), "config");
  await mkdir(relativeConfigPath, { recursive: true });
  await writeFile(
    path.join(relativeAppPath, "Contents", "Info.plist"),
    "bounded relative fallback probe\n",
    "utf8",
  );
  await writeFile(path.join(relativeConfigPath, "flake.nix"), "relative config\n", "utf8");
  const relativeAppDigest = await hashSelfTestBundleTree(relativeAppPath);
  const relativeEnv = {
    ...transportEnv,
    NIXMAC_E2E_APP_PATH: relativeAppPath,
    NIXMAC_E2E_STAGING_PARENT: path.dirname(relativeAppPath),
    NIXMAC_E2E_DISPOSABLE_CONFIG_PATH: relativeConfigPath,
  };
  let relativeProcessError;
  try {
    await runSuiteWithDriver(["--run-dir", relativeRunDirArg], {
      createDriver: (options) => new CompetingProcessDriver(options, relativeAppPath),
      env: relativeEnv,
      executionTopology: "local-cua-driver",
      localPreflightDependencies: {
        canonicalPath: async (value) => value,
        readBundleIdentity: async () => ({
          bundleId: "com.darkmatter.nixmac",
          digestSha256: relativeAppDigest,
        }),
      },
      runPreflightDependencies: {
        resolvePreflight: async (input) => preflightInputFromEnvironment(input),
      },
      transportBoundaries,
    });
  } catch (error) {
    relativeProcessError = error;
  }
  assert.match(relativeProcessError?.message || "", /competing .* pid 4242/);
  await renderSuiteErrorReport(relativeProcessError, ["--run-dir", relativeRunDirArg], {
    env: relativeEnv,
    executionTopology: "local-cua-driver",
  });
  const relativeState = JSON.parse(await readFile(path.join(relativeRunDir, "state.json"), "utf8"));
  const relativeAttempt = JSON.parse(
    await readFile(path.join(relativeRunDir, "attempt.json"), "utf8"),
  );
  assert.deepEqual(
    {
      category: relativeState.runFailure?.category,
      code: relativeState.runFailure?.code,
      infrastructureBlocker: relativeState.runFailure?.infrastructureBlocker,
      phase: relativeState.runFailure?.phase,
    },
    {
      category: "infrastructure",
      code: "competing_process",
      infrastructureBlocker: true,
      phase: "target_preparation",
    },
  );
  assert.deepEqual(
    {
      finalized: relativeAttempt.finalized,
      lifecycle: relativeAttempt.lifecycle.current,
      status: relativeAttempt.status,
      verdict: relativeAttempt.verdict,
    },
    {
      finalized: true,
      lifecycle: "ABORTED",
      status: "final",
      verdict: "inconclusive",
    },
    "relative fallback run directories must retain local finalization",
  );
  assert.equal(existsSync(relativeAppPath), false);
  assert.equal(existsSync(relativeConfigPath), false);
  assert.equal(existsSync(path.dirname(relativeAppPath)), false);
  const relativeManifest = await verifyEvidenceManifest(await realpath(relativeRunDir));
  assert.equal(
    relativeManifest.files.some(
      (file) => file.path.startsWith("screenshots/") || file.path.startsWith("video/"),
    ),
    false,
    "a relative pre-UI blocker must seal without fabricated visual evidence",
  );
  assert.deepEqual(transportCalls, ["websocket", "browser-inspection", "scp", "ssh"]);

  for (const blockerCase of [
    {
      name: "local-preflight",
      expectedCode: "local_preflight",
      expectedPermissionStatus: "pending",
      expectedLifecycle: ["PROVISIONING", "ABORTED"],
      env: { NIXMAC_E2E_DISPOSABLE_CONFIG: "false" },
      connectError: null,
    },
    {
      name: "permissions",
      expectedCode: "macos_permissions",
      expectedPermissionStatus: "denied",
      expectedLifecycle: ["PROVISIONING", "ABORTED"],
      env: {},
      connectError: new Error("CuaDriver requires Accessibility and Screen Recording permissions"),
    },
  ]) {
    const blockerRunDir = path.join(transportProbeRoot, `${blockerCase.name}-full-run`);
    const blockerAppPath = path.join(
      transportProbeRoot,
      "staging",
      `${blockerCase.name}-full-run`,
      "nixmac.app",
    );
    await mkdir(path.join(blockerAppPath, "Contents"), { recursive: true });
    await writeFile(
      path.join(blockerAppPath, "Contents", "Info.plist"),
      `${blockerCase.name} full-run blocker\n`,
      "utf8",
    );
    const blockerDigest = await hashSelfTestBundleTree(blockerAppPath);
    let connectCalls = 0;
    class FullRunBlockerDriver {
      constructor(options) {
        this.socketPath = options.socketPath;
        this.metadata = {
          app: { short_version: "0.12.6" },
          cli: { version: "0.12.6" },
        };
      }
      async connect() {
        connectCalls += 1;
        if (blockerCase.connectError) throw blockerCase.connectError;
      }
      async prepareTarget() {
        throw new Error(`${blockerCase.name} blocker must not prepare the target`);
      }
      async visibleState() {
        throw new Error(`${blockerCase.name} blocker must not capture UI state`);
      }
      async click() {}
      async setValue() {}
      async close() {}
    }
    const blockerEnv = {
      ...transportEnv,
      NIXMAC_E2E_APP_PATH: blockerAppPath,
      NIXMAC_E2E_APP_BUNDLE_DIGEST: blockerDigest,
      NIXMAC_E2E_STAGING_PARENT: path.dirname(blockerAppPath),
      NIXMAC_E2E_DISPOSABLE_CONFIG_PATH: path.join(path.dirname(blockerAppPath), "config"),
      ...blockerCase.env,
    };
    let blockerError;
    try {
      await runSuiteWithDriver(["--run-dir", blockerRunDir], {
        createDriver: (options) => new FullRunBlockerDriver(options),
        env: blockerEnv,
        executionTopology: "local-cua-driver",
        localPreflightDependencies: {
          canonicalPath: async (value) => value,
          readBundleIdentity: async () => ({
            bundleId: "com.darkmatter.nixmac",
            digestSha256: blockerDigest,
          }),
        },
        runPreflightDependencies: {
          resolvePreflight: async (input) => preflightInputFromEnvironment(input),
        },
        transportBoundaries,
      });
    } catch (error) {
      blockerError = error;
    }
    assert.ok(blockerError, `${blockerCase.name} full-run blocker must reject`);
    await renderSuiteErrorReport(blockerError, ["--run-dir", blockerRunDir], {
      env: blockerEnv,
      executionTopology: "local-cua-driver",
    });
    const blockerState = JSON.parse(await readFile(path.join(blockerRunDir, "state.json"), "utf8"));
    const blockerPermissions = JSON.parse(
      await readFile(path.join(blockerRunDir, "runner", "permissions.json"), "utf8"),
    );
    const blockerAttempt = JSON.parse(
      await readFile(path.join(blockerRunDir, "attempt.json"), "utf8"),
    );
    assert.equal(blockerState.runFailure.code, blockerCase.expectedCode);
    assert.equal(blockerPermissions.status, blockerCase.expectedPermissionStatus);
    assert.deepEqual(
      blockerAttempt.lifecycle.history.map((transition) => transition.state),
      blockerCase.expectedLifecycle,
    );
    assert.equal(
      connectCalls,
      blockerCase.name === "permissions" ? 1 : 0,
      `${blockerCase.name} connect boundary`,
    );
    const blockerManifest = await verifyEvidenceManifest(await realpath(blockerRunDir));
    assert.equal(
      blockerManifest.files.some(
        (file) => file.path.startsWith("screenshots/") || file.path.startsWith("video/"),
      ),
      false,
      `${blockerCase.name} blocker must seal without fabricated visual evidence`,
    );
  }

  const combinedRunDir = path.join(transportProbeRoot, "combined-run");
  const combinedAppPath = path.join(transportProbeRoot, "staging", "combined-run", "nixmac.app");
  await mkdir(path.join(combinedAppPath, "Contents"), { recursive: true });
  await writeFile(
    path.join(combinedAppPath, "Contents", "Info.plist"),
    "bounded combined-failure probe\n",
    "utf8",
  );
  const combinedAppDigest = await hashSelfTestBundleTree(combinedAppPath);
  let combinedRunError;
  try {
    await runSuiteWithDriver(["--run-dir", combinedRunDir], {
      createDriver: () => ({
        connected: true,
        socketPath: "/private/tmp/nx-cua-combined-probe/d.sock",
        metadata: {
          app: { short_version: "0.12.6" },
          cli: { version: "0.12.6" },
        },
        async connect() {},
        async prepareTarget() {
          throw new Error(
            "competing com.darkmatter.nixmac process is already running with pid 5151",
          );
        },
        async visibleState() {
          throw new Error("combined failure must not capture state");
        },
        async click() {},
        async setValue() {},
        async close() {
          throw new Error("owned target cleanup did not exit");
        },
      }),
      env: {
        ...transportEnv,
        NIXMAC_E2E_APP_PATH: combinedAppPath,
        NIXMAC_E2E_STAGING_PARENT: path.dirname(combinedAppPath),
        NIXMAC_E2E_DISPOSABLE_CONFIG_PATH: path.join(path.dirname(combinedAppPath), "config"),
      },
      executionTopology: "local-cua-driver",
      localPreflightDependencies: {
        canonicalPath: async (value) => value,
        readBundleIdentity: async () => ({
          bundleId: "com.darkmatter.nixmac",
          digestSha256: combinedAppDigest,
        }),
      },
      runPreflightDependencies: {
        resolvePreflight: async (input) => preflightInputFromEnvironment(input),
      },
      transportBoundaries,
    });
  } catch (error) {
    combinedRunError = error;
  }
  assert.equal(combinedRunError instanceof AggregateError, true);
  assert.deepEqual(
    combinedRunError.errors.map((error) => error.message),
    [
      "competing com.darkmatter.nixmac process is already running with pid 5151",
      "owned target cleanup did not exit",
    ],
  );
  assert.deepEqual(transportCalls, ["websocket", "browser-inspection", "scp", "ssh"]);
  await rm(transportProbeRoot, { force: true, recursive: true });

  const classificationCases = [
    {
      error: new Error("NIXMAC_E2E_APP_PATH must be a canonical staged app path"),
      expected: {
        category: "infrastructure",
        code: "local_preflight",
        infrastructureBlocker: true,
        phase: "preflight",
      },
    },
    {
      error: new Error("CuaDriver requires Accessibility and Screen Recording permissions"),
      expected: {
        category: "infrastructure",
        code: "macos_permissions",
        infrastructureBlocker: true,
        phase: "permissions",
      },
    },
    {
      error: new Error("CuaDriver CLI digestSha256 mismatch"),
      expected: {
        category: "infrastructure",
        code: "local_runtime",
        infrastructureBlocker: true,
        phase: "runtime",
      },
    },
    {
      error: new Error("nixmac app window did not render Settings"),
      expected: {
        category: "product",
        code: "app_behavior",
        infrastructureBlocker: false,
        phase: "runtime",
      },
    },
    {
      error: new Error("driver RPC returned malformed structured output"),
      expected: {
        category: "harness",
        code: "runtime_failure",
        infrastructureBlocker: false,
        phase: "runtime",
      },
    },
    {
      error: new Error("owned target pid 4242 did not exit after cleanup"),
      expected: {
        category: "infrastructure",
        code: "owned_resource_cleanup",
        infrastructureBlocker: true,
        phase: "cleanup",
      },
    },
  ];
  for (const { error, expected } of classificationCases) {
    const classified = classifySuiteFailure(error, {
      executionTopology: "local-cua-driver",
    });
    assert.deepEqual(
      {
        category: classified.category,
        code: classified.code,
        infrastructureBlocker: classified.infrastructureBlocker,
        phase: classified.phase,
      },
      expected,
      error.message,
    );
  }
  const combinedFailure = classifySuiteFailure(
    new AggregateError(
      [
        new Error("nixmac app window did not render Settings"),
        new Error("owned target pid 4242 did not exit after cleanup"),
      ],
      "smoke runtime and cleanup failed",
    ),
    {
      executionTopology: "local-cua-driver",
    },
  );
  assert.deepEqual(
    {
      category: combinedFailure.category,
      code: combinedFailure.code,
      infrastructureBlocker: combinedFailure.infrastructureBlocker,
      phase: combinedFailure.phase,
      issues: combinedFailure.issues.map((issue) => ({
        category: issue.category,
        code: issue.code,
        phase: issue.phase,
      })),
    },
    {
      category: "infrastructure",
      code: "multiple_failures",
      infrastructureBlocker: true,
      phase: "multiple",
      issues: [
        {
          category: "product",
          code: "app_behavior",
          phase: "runtime",
        },
        {
          category: "infrastructure",
          code: "owned_resource_cleanup",
          phase: "cleanup",
        },
      ],
    },
  );

  const smokeProbeRoot = await mkdtemp(path.join(os.tmpdir(), "nixmac-local-smoke-probe-"));
  const smokeRunDir = path.join(smokeProbeRoot, "smoke-run");
  const smokeAppInputPath = path.join(smokeProbeRoot, "staging", "smoke-run", "nixmac.app");
  await mkdir(path.join(smokeAppInputPath, "Contents"), { recursive: true });
  const smokeAppPath = await realpath(smokeAppInputPath);
  const smokeStagingPath = path.dirname(smokeAppPath);
  const smokeConfigPath = path.join(smokeStagingPath, "config");
  await mkdir(smokeConfigPath, { recursive: true });
  await writeFile(
    path.join(smokeAppPath, "Contents", "Info.plist"),
    "bounded smoke pass fixture\n",
    "utf8",
  );
  await writeFile(path.join(smokeConfigPath, "flake.nix"), "smoke config\n", "utf8");
  const smokeAppDigest = await hashSelfTestBundleTree(smokeAppPath);
  const smokeCalls = [];
  let smokeSocketPath = "";
  class SmokeDriver {
    constructor(options) {
      this.screen = "launch";
      this.snapshot = 0;
      this.socketPath = options.socketPath;
      smokeSocketPath = options.socketPath;
      assert.ok(Buffer.byteLength(this.socketPath, "utf8") <= 103);
      assert.match(path.basename(path.dirname(this.socketPath)), /^nx-cua-/);
    }
    async connect() {
      smokeCalls.push("connect");
    }
    async prepareTarget(input) {
      smokeCalls.push(["prepareTarget", input]);
    }
    async visibleState() {
      this.snapshot += 1;
      smokeCalls.push(["visibleState", this.screen]);
      return {
        text:
          this.screen === "launch"
            ? "1 text nixmac\n7 button Settings"
            : "27 button Close settings\n28 text Settings\n30 button General\n31 button AI Models\n32 button API Keys\n33 button Preferences\n35 heading General\n37 text Configuration Directory\n44 text Host",
        imageBase64: "",
        target: {
          pid: 4242,
          snapshotId: `smoke-${this.snapshot}`,
          windowId: 7002,
        },
        metadata: {},
      };
    }
    async click(input) {
      smokeCalls.push(["click", input.elementIndex]);
      this.screen = "settings";
      return { ok: true, text: "", isError: false };
    }
    async setValue() {
      throw new Error("smoke must not set values");
    }
    async close() {
      smokeCalls.push("close");
    }
  }
  const smokeEnv = {
    NIXMAC_COMPUTER_USE_APP: "com.darkmatter.nixmac",
    NIXMAC_E2E_APP_ARTIFACT_SHA: artifactSha,
    NIXMAC_E2E_APP_PATH: smokeAppPath,
    NIXMAC_E2E_DISPOSABLE_CONFIG: "true",
    NIXMAC_E2E_STAGING_PARENT: smokeStagingPath,
    NIXMAC_E2E_DISPOSABLE_CONFIG_PATH: smokeConfigPath,
  };
  await runSmokeWithDriver(["--run-dir", smokeRunDir], {
    createDriver: (options) => new SmokeDriver(options),
    env: smokeEnv,
    executionTopology: "local-cua-driver",
    localPreflightDependencies: {
      canonicalPath: async (value) => value,
      readBundleIdentity: async () => ({
        bundleId: "com.darkmatter.nixmac",
        digestSha256: smokeAppDigest,
      }),
    },
    transportBoundaries,
  });
  const smokeState = JSON.parse(await readFile(path.join(smokeRunDir, "state.json"), "utf8"));
  assert.equal(smokeState.executionTopology, "local-cua-driver");
  assert.equal(smokeState.suiteMode, "smoke");
  assert.equal(smokeState.verdict, "pass");
  assert.equal(smokeState.scenarios.launch.status, "pass");
  assert.equal(smokeState.scenarios.settingsGeneral.status, "pass");
  assert.equal(smokeState.scenarios.reportInspection.status, "not_required");
  assert.equal(smokeState.video.status, "not_required");
  assert.equal(smokeState.smoke.outcome, "pass");
  assert.equal(Object.hasOwn(smokeState, "runFailure"), false);
  assert.deepEqual(smokeState.localApp, {
    artifactSha,
    bundleDigestSha256: smokeAppDigest,
    bundleId: "com.darkmatter.nixmac",
    path: smokeAppPath,
  });
  assert.equal(existsSync(smokeAppPath), false);
  assert.equal(existsSync(smokeConfigPath), false);
  assert.equal(existsSync(smokeStagingPath), false);
  assert.equal(existsSync(path.dirname(smokeSocketPath)), false);
  assert.deepEqual(
    {
      attempted: smokeState.cleanup.attempted,
      clean: smokeState.cleanup.clean,
      restored: smokeState.cleanup.restored,
    },
    {
      attempted: true,
      clean: true,
      restored: true,
    },
  );
  assert.deepEqual(
    smokeState.cleanup.ownedPaths.map(({ kind, observedFinalState }) => ({
      kind,
      observedFinalState,
    })),
    [
      { kind: "staging-parent", observedFinalState: "absent" },
      { kind: "app-bundle", observedFinalState: "absent" },
      { kind: "disposable-config", observedFinalState: "absent" },
      { kind: "daemon-socket-directory", observedFinalState: "absent" },
      { kind: "daemon-socket", observedFinalState: "absent" },
    ],
  );
  assert.deepEqual(smokeCalls, [
    "connect",
    [
      "prepareTarget",
      {
        appBundleId: "com.darkmatter.nixmac",
        appPath: smokeAppPath,
      },
    ],
    ["visibleState", "launch"],
    ["click", "7"],
    ["visibleState", "settings"],
    "close",
  ]);
  assert.match(
    await readFile(path.join(smokeRunDir, "index.html"), "utf8"),
    /Computer Use E2E Evidence/,
  );
  assert.deepEqual(transportCalls, ["websocket", "browser-inspection", "scp", "ssh"]);
  await rm(smokeProbeRoot, { force: true, recursive: true });

  const blockerProbeRoot = await mkdtemp(path.join(os.tmpdir(), "nixmac-smoke-blocker-"));
  const blockerRunDir = path.join(blockerProbeRoot, "blocked-run");
  const blockerAppInputPath = path.join(blockerProbeRoot, "staging", "blocked-run", "nixmac.app");
  await mkdir(path.join(blockerAppInputPath, "Contents"), { recursive: true });
  const blockerAppPath = await realpath(blockerAppInputPath);
  const blockerStagingPath = path.dirname(blockerAppPath);
  const blockerConfigPath = path.join(blockerStagingPath, "config");
  await mkdir(blockerConfigPath, { recursive: true });
  await writeFile(
    path.join(blockerAppPath, "Contents", "Info.plist"),
    "bounded smoke blocker fixture\n",
    "utf8",
  );
  await writeFile(path.join(blockerConfigPath, "flake.nix"), "blocker config\n", "utf8");
  const blockerAppDigest = await hashSelfTestBundleTree(blockerAppPath);
  const blockerEnv = {
    ...smokeEnv,
    NIXMAC_E2E_APP_PATH: blockerAppPath,
    NIXMAC_E2E_STAGING_PARENT: blockerStagingPath,
    NIXMAC_E2E_DISPOSABLE_CONFIG_PATH: blockerConfigPath,
  };
  let blockerSocketPath = "";
  let smokeBlockerError;
  try {
    await runSmokeWithDriver(["--run-dir", blockerRunDir], {
      createDriver: (options) => ({
        socketPath: options.socketPath,
        async connect() {
          blockerSocketPath = options.socketPath;
          throw new Error("CuaDriver requires Accessibility and Screen Recording permissions");
        },
        async prepareTarget() {},
        async visibleState() {
          throw new Error("blocked smoke must not capture state");
        },
        async click() {},
        async setValue() {},
        async close() {},
      }),
      env: blockerEnv,
      executionTopology: "local-cua-driver",
      localPreflightDependencies: {
        canonicalPath: async (value) => value,
        readBundleIdentity: async () => ({
          bundleId: "com.darkmatter.nixmac",
          digestSha256: blockerAppDigest,
        }),
      },
      transportBoundaries,
    });
  } catch (error) {
    smokeBlockerError = error;
  }
  assert.equal(existsSync(blockerAppPath), false);
  assert.equal(existsSync(blockerConfigPath), false);
  assert.equal(existsSync(blockerStagingPath), false);
  assert.equal(existsSync(path.dirname(blockerSocketPath)), false);
  await renderSuiteErrorReport(smokeBlockerError, ["--run-dir", blockerRunDir], {
    env: blockerEnv,
    executionTopology: "local-cua-driver",
    suiteMode: "smoke",
  });
  const blockerState = JSON.parse(await readFile(path.join(blockerRunDir, "state.json"), "utf8"));
  assert.equal(blockerState.executionTopology, "local-cua-driver");
  assert.equal(blockerState.suiteMode, "smoke");
  assert.equal(blockerState.smoke.outcome, "infrastructure_blocker");
  assert.equal(blockerState.scenarios.reportInspection.status, "not_required");
  assert.equal(blockerState.video.status, "not_required");
  assert.deepEqual(
    {
      attempted: blockerState.cleanup.attempted,
      clean: blockerState.cleanup.clean,
      restored: blockerState.cleanup.restored,
    },
    {
      attempted: true,
      clean: true,
      restored: true,
    },
  );
  assert.deepEqual(
    blockerState.cleanup.ownedPaths.map(({ kind, observedFinalState }) => ({
      kind,
      observedFinalState,
    })),
    [
      { kind: "staging-parent", observedFinalState: "absent" },
      { kind: "app-bundle", observedFinalState: "absent" },
      { kind: "disposable-config", observedFinalState: "absent" },
      { kind: "daemon-socket-directory", observedFinalState: "absent" },
      { kind: "daemon-socket", observedFinalState: "absent" },
    ],
  );
  assert.deepEqual(
    {
      category: blockerState.runFailure.category,
      code: blockerState.runFailure.code,
      infrastructureBlocker: blockerState.runFailure.infrastructureBlocker,
      phase: blockerState.runFailure.phase,
    },
    {
      category: "infrastructure",
      code: "macos_permissions",
      infrastructureBlocker: true,
      phase: "permissions",
    },
  );
  assert.match(
    await readFile(path.join(blockerRunDir, "index.html"), "utf8"),
    /Computer Use E2E Evidence/,
  );
  assert.deepEqual(transportCalls, ["websocket", "browser-inspection", "scp", "ssh"]);
  await rm(blockerProbeRoot, { force: true, recursive: true });

  console.log("Local CuaDriver E2E runner self-test passed.");
}

async function main() {
  await dispatchLocalCuaCommand(
    process.argv.slice(2),
    {
      run: runLocalCuaSuite,
      selfTest: runSelfTest,
      smoke: runLocalCuaSmoke,
    },
    {
      usage: () => console.log(localCuaUsage({ defaultApp: "com.darkmatter.nixmac" })),
      exit: (code) => {
        process.exitCode = code;
      },
      onError: async (error, { command, args }) => {
        console.error(
          redact(error instanceof Error ? error.stack || error.message : String(error)),
        );
        if (command === "run" || command === "smoke") {
          try {
            await renderSuiteErrorReport(error, args, {
              executionTopology: "local-cua-driver",
              suiteMode: command === "smoke" ? "smoke" : "full",
            });
          } catch (reportError) {
            console.error(
              redact(
                reportError instanceof Error
                  ? reportError.stack || reportError.message
                  : String(reportError),
              ),
            );
          }
        }
      },
    },
  );
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) await main();
