#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { dispatchLocalCuaCommand, localCuaUsage } from "./cli.mjs";
import { CuaDriver, hashCuaBundleTree } from "./drivers/cua-driver.mjs";
import { redact } from "./redaction.mjs";
import {
  classifySuiteFailure,
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
  if (env.NIXMAC_CUA_DRIVER_SOCKET) {
    driverOptions.socketPath = env.NIXMAC_CUA_DRIVER_SOCKET;
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
  });
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
    NIXMAC_E2E_JOB_ID: "job-123",
    NIXMAC_E2E_REPO: "darkmatter/nixmac",
    NIXMAC_E2E_MERGE_SHA: artifactSha,
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
  };
  const writtenPreflights = [];
  const assertedPreflights = [];
  const connectedMetadataDriver = {
    connected: true,
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
  const transportAppPath = path.join(transportProbeRoot, "staging", "probe-run", "nixmac.app");
  await mkdir(path.join(transportAppPath, "Contents"), { recursive: true });
  await writeFile(
    path.join(transportAppPath, "Contents", "Info.plist"),
    "bounded local transport probe\n",
    "utf8",
  );
  const transportAppDigest = await hashCuaBundleTree(transportAppPath);
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
  class CompetingProcessDriver {
    constructor() {
      this.connected = false;
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
        appPath: transportAppPath,
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
  };
  let competingProcessError;
  try {
    await runSuiteWithDriver(["--run-dir", transportRunDir], {
      createDriver: (options) => {
        if (options.ws !== undefined) websocketBoundary(options.ws);
        return new CompetingProcessDriver();
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
      transportBoundaries,
    });
  } catch (error) {
    competingProcessError = error;
  }
  assert.match(competingProcessError?.message || "", /competing .* pid 4242/);
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

  const combinedRunDir = path.join(transportProbeRoot, "combined-run");
  const combinedAppPath = path.join(transportProbeRoot, "staging", "combined-run", "nixmac.app");
  await mkdir(path.join(combinedAppPath, "Contents"), { recursive: true });
  await writeFile(
    path.join(combinedAppPath, "Contents", "Info.plist"),
    "bounded combined-failure probe\n",
    "utf8",
  );
  const combinedAppDigest = await hashCuaBundleTree(combinedAppPath);
  let combinedRunError;
  try {
    await runSuiteWithDriver(["--run-dir", combinedRunDir], {
      createDriver: () => ({
        connected: true,
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
      },
      executionTopology: "local-cua-driver",
      localPreflightDependencies: {
        canonicalPath: async (value) => value,
        readBundleIdentity: async () => ({
          bundleId: "com.darkmatter.nixmac",
          digestSha256: combinedAppDigest,
        }),
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
  const smokeAppPath = path.join(smokeProbeRoot, "staging", "smoke-run", "nixmac.app");
  const smokeCalls = [];
  class SmokeDriver {
    constructor() {
      this.screen = "launch";
      this.snapshot = 0;
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
  };
  await runSmokeWithDriver(["--run-dir", smokeRunDir], {
    createDriver: () => new SmokeDriver(),
    env: smokeEnv,
    executionTopology: "local-cua-driver",
    localPreflightDependencies: {
      canonicalPath: async (value) => value,
      readBundleIdentity: async () => ({
        bundleId: "com.darkmatter.nixmac",
        digestSha256: "b".repeat(64),
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
    bundleDigestSha256: "b".repeat(64),
    bundleId: "com.darkmatter.nixmac",
    path: smokeAppPath,
  });
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
  const blockerAppPath = path.join(blockerProbeRoot, "staging", "blocked-run", "nixmac.app");
  const blockerEnv = {
    ...smokeEnv,
    NIXMAC_E2E_APP_PATH: blockerAppPath,
  };
  let smokeBlockerError;
  try {
    await runSmokeWithDriver(["--run-dir", blockerRunDir], {
      createDriver: () => ({
        async connect() {
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
          digestSha256: "b".repeat(64),
        }),
      },
      transportBoundaries,
    });
  } catch (error) {
    smokeBlockerError = error;
  }
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
