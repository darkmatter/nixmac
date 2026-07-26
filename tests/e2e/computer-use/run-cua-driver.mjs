#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import process from "node:process";
import { dispatchLocalCuaCommand, localCuaUsage } from "./cli.mjs";
import { CuaDriver } from "./drivers/cua-driver.mjs";
import { redact } from "./redaction.mjs";
import {
  prepareSuiteDriver,
  renderSuiteErrorReport,
  runSuiteWithDriver,
  validateLocalCuaPreflight,
  verifyLocalCuaPreflight,
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
    executionTopology: "local-cua-driver",
  });
}

async function runSelfTest() {
  const source = await readFile(new URL(import.meta.url), "utf8");
  for (const forbiddenSourcePattern of [
    new RegExp(["remote", "-stage\\.mjs"].join("")),
    new RegExp(["Codex", "AppServerDriver"].join("")),
    new RegExp(["new\\s+", "WebSocket"].join("")),
    new RegExp(["node:", "child_process"].join("")),
  ]) {
    assert.doesNotMatch(
      source,
      forbiddenSourcePattern,
      `local entrypoint must not contain transport dependency ${forbiddenSourcePattern}`,
    );
  }
  assert.match(localCuaUsage({ defaultApp: "com.darkmatter.nixmac" }), /local-cua-driver/);
  const dispatches = [];
  const exits = [];
  await dispatchLocalCuaCommand(
    ["run", "--run-dir", "/tmp/local-run"],
    {
      run: async (args) => dispatches.push(["run", args]),
      selfTest: async () => dispatches.push(["selfTest", []]),
    },
    {
      usage: () => dispatches.push(["usage"]),
      exit: (code) => exits.push(code),
    },
  );
  assert.deepEqual(dispatches.pop(), ["run", ["--run-dir", "/tmp/local-run"]]);
  await dispatchLocalCuaCommand(
    ["self-test", "--ignored"],
    {
      run: async (args) => dispatches.push(["run", args]),
      selfTest: async () => dispatches.push(["selfTest", []]),
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
      suiteCalls.push({ args, executionTopology: injected.executionTopology });
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

  for (const forbiddenTransport of [
    ["s", "sh"].join(""),
    ["s", "cp"].join(""),
    ["Web", "Socket"].join(""),
  ]) {
    assert.equal(
      calls.some((entry) => entry.includes(forbiddenTransport)),
      false,
      `local self-test must not invoke ${forbiddenTransport}`,
    );
  }

  console.log("Local CuaDriver E2E runner self-test passed.");
}

async function main() {
  await dispatchLocalCuaCommand(
    process.argv.slice(2),
    {
      run: runLocalCuaSuite,
      selfTest: runSelfTest,
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
        if (command === "run") {
          try {
            await renderSuiteErrorReport(error, args, {
              executionTopology: "local-cua-driver",
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
