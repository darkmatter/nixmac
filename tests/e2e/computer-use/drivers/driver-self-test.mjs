#!/usr/bin/env node
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AppServerClient,
  clickResponseIndicatesFailure,
  contentImage,
  contentText,
  findElement,
  setValueResponseIndicatesFailure,
} from "../transport.mjs";
import { createScenarioDriverHelpers } from "../scenario-driver.mjs";
import {
  normalizeActionResult,
  normalizeVisibleState,
  runtimeDriverMethods,
  validateRuntimeDriver,
} from "./runtime-contract.mjs";
import {
  driverContractVersion,
  validateCuaElementIndexAddress,
  validateDriverDescriptor,
  validateElementAddress,
} from "./contract.mjs";
import { CodexAppServerDriver, codexAppServerDriverDescriptor } from "./codex-app-server.mjs";
import {
  CuaDriver,
  createCuaProcessRunner,
  cuaDriverDescriptor,
  hashCuaBundleTree,
  normalizeCuaActionOutput,
  parseCuaCliOutput,
  parseCuaCodesignIdentity,
  pinnedCuaDriverMetadata,
  selectCuaWindow,
} from "./cua-driver.mjs";

const requiredMethods = ["connect", "prepareTarget", "visibleState", "click", "setValue", "close"];

assert.deepEqual(runtimeDriverMethods, requiredMethods);

const state = normalizeVisibleState({
  text: "# Window\n[element_index 7] button Keep Changes",
  imageBase64: "aGVsbG8=",
  target: { pid: 101, windowId: 202, snapshotId: "turn-1" },
});

assert.equal(state.text.includes("Keep Changes"), true);
assert.equal(state.imageBase64, "aGVsbG8=");
assert.deepEqual(state.target, {
  pid: 101,
  windowId: 202,
  snapshotId: "turn-1",
});
assert.equal(Object.isFrozen(state), true);
assert.equal(Object.isFrozen(state.target), true);
assert.equal(Object.isFrozen(state.metadata), true);
assert.throws(() => normalizeVisibleState({ text: 7 }), /visible state text must be a string/);
assert.throws(
  () => normalizeVisibleState({ imageBase64: 7 }),
  /visible state imageBase64 must be a string/,
);
assert.throws(() => validateRuntimeDriver({}), /connect/);
const driver = {
  connect() {},
  prepareTarget() {},
  visibleState() {},
  click() {},
  setValue() {},
  close() {},
};
assert.equal(validateRuntimeDriver(driver), driver);

const scenarioRunDir = await mkdtemp(path.join(os.tmpdir(), "nixmac-scenario-driver-"));
try {
  const events = [];
  const narratives = [];
  const delays = [];
  let saveCount = 0;
  const scenario = createScenarioDriverHelpers({
    addEvent: async (_state, type, data) => events.push({ type, data }),
    saveState: async () => {
      saveCount += 1;
    },
    addNarrative: (_state, note) => narratives.push(note),
    redact: (value) => String(value ?? "").replaceAll("sk-secret", "[REDACTED]"),
    containsUnmaskedSecret: (value) => String(value ?? "").includes("sk-secret"),
    pngDimensions: () => ({ width: 2, height: 3 }),
    findElement,
    screenshotSource: "Codex Computer Use get_app_state image",
    sleep: async (delayMs) => delays.push(delayMs),
  });
  const scenarioState = {
    app: "com.darkmatter.nixmac",
    runDir: scenarioRunDir,
    textSnapshots: [],
    screenshots: [],
    secretMaskingViolations: [],
  };
  const target = {
    pid: 101,
    windowId: 202,
    snapshotId: "101:202:turn-1",
  };
  const fake = {
    states: [
      {
        text: "1 text API key sk-secret",
        imageBase64: Buffer.from("sensitive-image").toString("base64"),
        target: null,
      },
      {
        text: "1 button Save\n2 text entry area Prompt",
        imageBase64: Buffer.from("normal-image").toString("base64"),
        target,
      },
      {
        text: "1 button Codex Save",
        imageBase64: "",
        target: null,
      },
      {
        text: "7 button Snapshot A",
        imageBase64: "",
        target: {
          pid: 101,
          windowId: 202,
          snapshotId: "101:202:turn-a",
        },
      },
      {
        text: "7 button Snapshot B",
        imageBase64: "",
        target: {
          pid: 101,
          windowId: 202,
          snapshotId: "101:202:turn-b",
        },
      },
      {
        text: "8 button Malformed target",
        imageBase64: "",
        target: {
          pid: "101",
          windowId: 202,
          snapshotId: "101:202:turn-malformed",
        },
      },
    ],
    clicks: [],
    setValues: [],
    async visibleState() {
      return this.states.shift();
    },
    async click(input) {
      this.clicks.push(input);
      return { ok: true, text: "clicked", isError: false };
    },
    async setValue(input) {
      this.setValues.push(input);
      return { ok: true, text: "set", isError: false };
    },
  };

  const sensitiveText = await scenario.captureState(
    fake,
    scenarioState,
    "settings-api-keys",
    "Captured API keys.",
  );
  assert.equal(sensitiveText.includes("sk-secret"), false);
  assert.equal(scenarioState.textSnapshots.length, 1);
  assert.equal(scenarioState.screenshots.length, 0);
  assert.equal(scenarioState.secretMaskingViolations.length, 1);
  assert.equal(
    events.some((event) => event.type === "computer-use.screenshot-omitted"),
    true,
  );
  assert.equal(
    (
      await readFile(path.join(scenarioRunDir, scenarioState.textSnapshots[0].path), "utf8")
    ).includes("[REDACTED]"),
    true,
  );

  const normalText = await scenario.captureState(
    fake,
    scenarioState,
    "normal-state",
    "Captured normal state.",
  );
  assert.equal(normalText.includes("button Save"), true);
  assert.equal(scenarioState.textSnapshots.length, 2);
  assert.equal(scenarioState.screenshots.length, 1);
  assert.deepEqual(scenarioState.screenshots[0].imageSize, {
    width: 2,
    height: 3,
  });

  assert.equal(
    await scenario.clickByPattern(fake, scenarioState, normalText, "Save", [/button Save/i]),
    true,
  );
  assert.deepEqual(fake.clicks[0], {
    app: "com.darkmatter.nixmac",
    elementIndex: "1",
    elementAddress: {
      kind: "cua-element-index",
      elementIndex: 1,
      ...target,
    },
  });

  assert.equal(
    await scenario.setValueByPattern(
      fake,
      scenarioState,
      normalText,
      "Prompt",
      [/text entry area Prompt/i],
      "new value",
    ),
    true,
  );
  assert.deepEqual(fake.setValues[0], {
    app: "com.darkmatter.nixmac",
    elementIndex: "2",
    elementAddress: {
      kind: "cua-element-index",
      elementIndex: 2,
      ...target,
    },
    value: "new value",
  });
  assert.equal(saveCount, 2);
  assert.deepEqual(narratives, ["Captured API keys.", "Captured normal state."]);

  fake.click = async () => ({ ok: false, text: "stale element", isError: false });
  assert.equal(
    await scenario.clickElementIndex(fake, scenarioState, normalText, "1", "Stale Save"),
    false,
  );
  assert.equal(
    events.some(
      (event) =>
        event.type === "computer-use.click.failed" &&
        event.data.label === "Stale Save" &&
        event.data.response === "stale element",
    ),
    true,
  );

  fake.click = async function click(input) {
    this.clicks.push(input);
    return { ok: true, text: "clicked", isError: false };
  };
  const codexObservation = await scenario.captureState(
    fake,
    scenarioState,
    "codex-state",
    "Captured Codex fallback state.",
  );
  assert.equal(
    await scenario.clickByPattern(fake, scenarioState, codexObservation, "Codex Save", [
      /button Codex Save/i,
    ]),
    true,
  );
  assert.deepEqual(fake.clicks.at(-1).elementAddress, {
    kind: "codex-index",
    index: "1",
  });

  const snapshotAObservation = await scenario.captureState(
    fake,
    scenarioState,
    "snapshot-a",
    "Captured snapshot A.",
  );
  const snapshotBObservation = await scenario.captureState(
    fake,
    scenarioState,
    "snapshot-b",
    "Captured snapshot B.",
  );
  assert.equal(
    await scenario.clickByPattern(fake, scenarioState, snapshotAObservation, "Snapshot A", [
      /button Snapshot A/i,
    ]),
    true,
    "actions should remain bound to the observation used for element lookup",
  );
  assert.equal(
    fake.clicks.at(-1).elementAddress.snapshotId,
    "101:202:turn-a",
    "an older observation must never be rebound to a newer snapshot",
  );
  assert.equal(
    await scenario.clickByPattern(fake, scenarioState, snapshotBObservation, "Snapshot B", [
      /button Snapshot B/i,
    ]),
    true,
  );
  assert.equal(fake.clicks.at(-1).elementAddress.snapshotId, "101:202:turn-b");

  const malformedObservation = await scenario.captureState(
    fake,
    scenarioState,
    "malformed-target",
    "Captured malformed target metadata.",
  );
  const clickCountBeforeMalformedTarget = fake.clicks.length;
  assert.equal(
    await scenario.clickByPattern(fake, scenarioState, malformedObservation, "Malformed target", [
      /button Malformed target/i,
    ]),
    false,
    "malformed target metadata should fail the action through evidence semantics",
  );
  assert.equal(fake.clicks.length, clickCountBeforeMalformedTarget);
  assert.equal(
    events.some(
      (event) =>
        event.type === "computer-use.click.failed" &&
        event.data.label === "Malformed target" &&
        /cannot resolve an element address/i.test(event.data.error),
    ),
    true,
  );

  const clickCountBeforeUnownedObservation = fake.clicks.length;
  assert.equal(
    await scenario.clickElementIndex(
      fake,
      scenarioState,
      String(snapshotBObservation),
      "7",
      "Unowned observation",
    ),
    false,
    "plain or forged text must not retain a captured state's action authority",
  );
  assert.equal(fake.clicks.length, clickCountBeforeUnownedObservation);
  assert.equal(
    events.some(
      (event) =>
        event.type === "computer-use.click.failed" &&
        event.data.label === "Unowned observation" &&
        /require the observation that produced the element lookup/i.test(event.data.error),
    ),
    true,
  );

  fake.click = async () => {
    throw new Error("synthetic driver exception");
  };
  assert.equal(
    await scenario.clickByPattern(fake, scenarioState, snapshotBObservation, "Driver exception", [
      /button Snapshot B/i,
    ]),
    false,
  );
  assert.equal(
    events.some(
      (event) =>
        event.type === "computer-use.click.failed" &&
        event.data.label === "Driver exception" &&
        event.data.error === "synthetic driver exception",
    ),
    true,
  );

  fake.setValue = async function setValue(input) {
    this.setValues.push(input);
    return {
      ok: false,
      text: "synthetic set-value rejection",
      isError: true,
    };
  };
  assert.equal(
    await scenario.setValueElementIndex(
      fake,
      scenarioState,
      snapshotBObservation,
      "7",
      "Set-value rejection",
      "ignored",
    ),
    false,
  );
  assert.equal(
    events.some(
      (event) =>
        event.type === "computer-use.set_value.failed" &&
        event.data.label === "Set-value rejection" &&
        event.data.response === "synthetic set-value rejection" &&
        event.data.isError === true,
    ),
    true,
  );

  fake.setValue = async () => {
    throw new Error("synthetic set-value exception");
  };
  assert.equal(
    await scenario.setValueElementIndex(
      fake,
      scenarioState,
      snapshotBObservation,
      "7",
      "Set-value exception",
      "ignored",
    ),
    false,
  );
  assert.equal(
    events.some(
      (event) =>
        event.type === "computer-use.set_value.failed" &&
        event.data.label === "Set-value exception" &&
        event.data.error === "synthetic set-value exception",
    ),
    true,
  );

  fake.setValue = async function setValue(input) {
    this.setValues.push(input);
    return { ok: true, text: "set", isError: false };
  };
  const setValueCountBeforeUnownedObservation = fake.setValues.length;
  assert.equal(
    await scenario.setValueElementIndex(
      fake,
      scenarioState,
      String(snapshotBObservation),
      "7",
      "Unowned set-value observation",
      "ignored",
    ),
    false,
  );
  assert.equal(fake.setValues.length, setValueCountBeforeUnownedObservation);
  assert.equal(
    events.some(
      (event) =>
        event.type === "computer-use.set_value.failed" &&
        event.data.label === "Unowned set-value observation" &&
        /require the observation that produced the element lookup/i.test(event.data.error),
    ),
    true,
  );

  assert.equal(
    await scenario.clickByPattern(fake, scenarioState, snapshotBObservation, "Missing control", [
      /button Missing/i,
    ]),
    false,
  );
  assert.equal(
    events.some(
      (event) =>
        event.type === "computer-use.click.skipped" && event.data.label === "Missing control",
    ),
    true,
  );

  const retryFake = {
    states: [
      {
        text: "Error: procNotFound",
        imageBase64: "",
        target: null,
      },
      {
        text: "1 text Running",
        imageBase64: "",
        target: null,
      },
    ],
    visibleStateCalls: 0,
    async visibleState() {
      this.visibleStateCalls += 1;
      return this.states.shift();
    },
  };
  const retryObservation = await scenario.captureState(
    retryFake,
    scenarioState,
    "retry-state",
    "Retried process lookup.",
  );
  assert.equal(String(retryObservation), "1 text Running");
  assert.equal(retryFake.visibleStateCalls, 2);
  assert.equal(delays.at(-1), 1500);

  const pollingFake = {
    states: [
      { text: "1 text Loading", imageBase64: "", target: null },
      { text: "1 text Ready", imageBase64: "", target: null },
    ],
    visibleStateCalls: 0,
    async visibleState() {
      this.visibleStateCalls += 1;
      return this.states.shift();
    },
  };
  const waitResult = await scenario.waitFor(
    pollingFake,
    scenarioState,
    "ready",
    (text) => (/Ready/.test(text) ? "ready" : ""),
    { attempts: 2, delayMs: 0 },
  );
  assert.equal(waitResult.ok, true);
  assert.equal(String(waitResult.text), "1 text Ready");
  assert.equal(waitResult.result, "ready");
  assert.equal(pollingFake.visibleStateCalls, 2);

  const exhaustedFake = {
    states: [
      { text: "1 text Still loading", imageBase64: "", target: null },
      { text: "1 text Still loading", imageBase64: "", target: null },
    ],
    async visibleState() {
      return this.states.shift();
    },
  };
  const exhaustedResult = await scenario.waitFor(
    exhaustedFake,
    scenarioState,
    "never-ready",
    () => false,
    { attempts: 2, delayMs: 25 },
  );
  assert.equal(exhaustedResult.ok, false);
  assert.equal(String(exhaustedResult.text), "1 text Still loading");
  assert.deepEqual(delays.slice(-2), [25, 25]);
} finally {
  await rm(scenarioRunDir, { recursive: true, force: true });
}

assert.equal(
  contentText({
    result: {
      content: [
        { type: "image", data: "png" },
        { type: "text", text: "state text" },
      ],
    },
  }),
  "state text",
  "contentText should extract the first text response payload",
);
assert.equal(
  contentText({ result: { content: [] } }),
  "",
  "contentText should return an empty string for missing text payloads",
);
assert.equal(
  contentImage({
    result: {
      content: [
        { type: "text", text: "state text" },
        { type: "image", data: "png" },
      ],
    },
  }),
  "png",
  "contentImage should extract the first image response payload",
);

const transportMessages = [];
class TransportMockWebSocket {
  constructor(url) {
    this.url = url;
    setTimeout(() => this.onopen?.(), 0);
  }

  send(payload) {
    const message = JSON.parse(payload);
    transportMessages.push(message);
    const result = message.method === "thread/start" ? { thread: { id: "thread-transport" } } : {};
    setTimeout(
      () =>
        this.onmessage?.({
          data: JSON.stringify({ id: message.id, result }),
        }),
      0,
    );
  }

  close() {
    this.closed = true;
  }
}

const appServerClient = new AppServerClient("ws://mock", {
  WebSocketImpl: TransportMockWebSocket,
});
await appServerClient.connect();
assert.equal(
  appServerClient.threadId,
  "thread-transport",
  "AppServerClient should store the started thread id",
);
await appServerClient.tool("click", { app: "com.darkmatter.nixmac", element_index: "7" }, 1000);
assert.deepEqual(
  transportMessages.map((message) => message.method),
  ["initialize", "thread/start", "mcpServer/tool/call"],
  "AppServerClient should preserve initialize, thread start, and tool-call request order",
);
assert.deepEqual(
  transportMessages[1].params,
  {
    cwd: "/tmp",
    model: "gpt-5.4-mini",
    approvalPolicy: "never",
    sandbox: "danger-full-access",
    ephemeral: true,
  },
  "AppServerClient should preserve Codex app-server thread policy",
);
assert.deepEqual(
  transportMessages[2].params,
  {
    server: "computer-use",
    threadId: "thread-transport",
    tool: "click",
    arguments: {
      app: "com.darkmatter.nixmac",
      element_index: "7",
    },
  },
  "AppServerClient should preserve Computer Use tool-call shape",
);
appServerClient.close();

class MockToolErrorWebSocket {
  constructor() {
    setTimeout(() => this.onopen?.(), 0);
  }

  send(payload) {
    const message = JSON.parse(payload);
    const result =
      message.method === "thread/start" ? { thread: { id: "thread-transport-error" } } : {};
    const response =
      message.method === "mcpServer/tool/call"
        ? {
            id: message.id,
            error: { message: "synthetic tool failure" },
          }
        : { id: message.id, result };
    setTimeout(() => this.onmessage?.({ data: JSON.stringify(response) }), 0);
  }

  close() {}
}

const toolErrorClient = new AppServerClient("ws://mock-tool-error", {
  WebSocketImpl: MockToolErrorWebSocket,
});
await toolErrorClient.connect();
await assert.rejects(
  () => toolErrorClient.tool("click", { app: "com.darkmatter.nixmac", element_index: "7" }, 1000),
  /synthetic tool failure/,
  "AppServerClient should reject JSON-RPC error responses",
);
toolErrorClient.close();

const timeoutClient = new AppServerClient("ws://mock-timeout");
timeoutClient.ws = { send() {}, close() {} };
await assert.rejects(
  () => timeoutClient.request("never/replies", {}, 1),
  /Timed out waiting for never\/replies/,
  "AppServerClient should reject timed-out requests",
);
timeoutClient.close();

assert.equal(
  clickResponseIndicatesFailure({
    result: {
      isError: true,
      content: [{ type: "text", text: "Tool returned an error." }],
    },
  }),
  true,
  "MCP isError should fail click",
);
assert.equal(
  clickResponseIndicatesFailure({
    result: {
      content: [
        {
          type: "text",
          text: "App state includes button Report Error and Console Error logs.",
        },
      ],
    },
  }),
  false,
  "ordinary app-state Error text should not fail click",
);
assert.equal(
  clickResponseIndicatesFailure({
    result: {
      content: [{ type: "text", text: "Error: stale element index 7" }],
    },
  }),
  true,
  "stale element sentinel should fail click",
);
assert.equal(
  clickResponseIndicatesFailure({
    result: {
      content: [{ type: "text", text: "Element index 7 not clickable" }],
    },
  }),
  true,
  "not-clickable element sentinel should fail click",
);
assert.equal(
  setValueResponseIndicatesFailure({
    result: {
      isError: true,
      content: [{ type: "text", text: "Tool returned an error." }],
    },
  }),
  true,
  "MCP isError should fail set_value",
);
assert.equal(
  setValueResponseIndicatesFailure({
    result: {
      content: [
        {
          type: "text",
          text: "App state includes Value: Add the bat command line tool.",
        },
      ],
    },
  }),
  false,
  "ordinary set_value app-state text should not fail input",
);
assert.equal(
  setValueResponseIndicatesFailure({
    result: {
      content: [
        {
          type: "text",
          text: "Error: set_value element index 18 not found",
        },
      ],
    },
  }),
  true,
  "set_value element sentinel should fail input",
);

const actionResult = normalizeActionResult({ ok: true, text: "clicked" });
assert.deepEqual(actionResult, {
  ok: true,
  text: "clicked",
  isError: false,
});
assert.equal(Object.isFrozen(actionResult), true);
assert.deepEqual(normalizeActionResult({ ok: true, isError: true }), {
  ok: false,
  text: "",
  isError: true,
});
assert.deepEqual(normalizeActionResult(), {
  ok: false,
  text: "",
  isError: false,
});

function assertUnknownAddressKind(kind, options) {
  assert.deepEqual(validateElementAddress({ kind }, options), {
    ok: false,
    issues: [
      {
        code: "unknown_address_kind",
        path: "kind",
        message: `Unknown element address kind: ${kind}`,
      },
    ],
    normalized: null,
  });
}

assertUnknownAddressKind("constructor");
assertUnknownAddressKind("toString");
assertUnknownAddressKind("custom", {
  additionalAddressValidators: { custom: true },
});

const explicitConstructorValidator = (address) => ({
  ok: true,
  issues: [],
  normalized: { ...address, registered: true },
});
assert.deepEqual(
  validateElementAddress(
    { kind: "constructor" },
    {
      additionalAddressValidators: {
        constructor: explicitConstructorValidator,
      },
    },
  ),
  {
    ok: true,
    issues: [],
    normalized: { kind: "constructor", registered: true },
  },
);

const baseDriverDescriptor = {
  id: "contract-self-test",
  displayName: "Contract self-test",
  contractVersion: driverContractVersion,
  capabilities: {
    connect: true,
    visibleState: true,
    findElement: true,
    click: true,
    setValue: true,
    screenshotFromState: true,
    textFromState: true,
    close: true,
  },
  addressKinds: ["codex-index"],
};
const descriptorWithCustomKind = {
  ...baseDriverDescriptor,
  addressKinds: ["custom"],
};

const nonFunctionDescriptorResult = validateDriverDescriptor(descriptorWithCustomKind, {
  additionalAddressValidators: { custom: true },
});
assert.equal(nonFunctionDescriptorResult.ok, false);
assert.equal(
  nonFunctionDescriptorResult.issues.some((entry) => entry.code === "unknown_address_kind"),
  true,
);

assert.deepEqual(
  validateDriverDescriptor(baseDriverDescriptor, {
    additionalAddressValidators: null,
  }),
  { ok: true, issues: [] },
);

assert.deepEqual(
  validateDriverDescriptor(descriptorWithCustomKind, {
    additionalAddressValidators: {
      custom: () => ({ ok: true, issues: [], normalized: null }),
    },
  }),
  { ok: true, issues: [] },
);

const inheritedAddressValidators = Object.create({
  custom: () => ({ ok: true, issues: [], normalized: null }),
});
const inheritedDescriptorResult = validateDriverDescriptor(descriptorWithCustomKind, {
  additionalAddressValidators: inheritedAddressValidators,
});
assert.equal(inheritedDescriptorResult.ok, false);
assert.equal(
  inheritedDescriptorResult.issues.some((entry) => entry.code === "unknown_address_kind"),
  true,
);

const cuaAddressValidators = {
  "cua-element-index": validateCuaElementIndexAddress,
};
const validCuaAddress = {
  kind: "cua-element-index",
  elementIndex: 7,
  pid: 101,
  windowId: 202,
  snapshotId: "turn-1",
};

assert.deepEqual(
  validateElementAddress(validCuaAddress, {
    additionalAddressValidators: cuaAddressValidators,
  }),
  {
    ok: true,
    issues: [],
    normalized: validCuaAddress,
  },
);

for (const [field, value] of [
  ["elementIndex", "7"],
  ["pid", 101.5],
  ["windowId", null],
  ["snapshotId", "   "],
]) {
  const result = validateElementAddress(
    { ...validCuaAddress, [field]: value },
    { additionalAddressValidators: cuaAddressValidators },
  );
  assert.equal(result.ok, false, `cua-element-index should reject invalid ${field}`);
  assert.equal(
    result.issues.some((entry) => entry.path === field),
    true,
    `cua-element-index should identify invalid ${field}`,
  );
}

assert.equal(
  validateElementAddress(validCuaAddress).ok,
  false,
  "cua-element-index must require explicit adapter registration",
);

const codexMessages = [];
class MockWebSocket {
  constructor(url) {
    this.url = url;
    setTimeout(() => this.onopen?.(), 0);
  }

  send(payload) {
    const message = JSON.parse(payload);
    codexMessages.push(message);

    let result = {};
    if (message.method === "initialize") {
      result = {
        protocolVersion: "2025-03-26",
        serverInfo: { name: "codex-app-server", version: "0.1.0" },
        capabilities: {},
      };
    } else if (message.method === "thread/start") {
      result = { thread: { id: "thread-codex-driver", status: "idle" } };
    } else if (message.method === "mcpServer/tool/call") {
      const { tool, arguments: args } = message.params;
      if (tool === "get_app_state") {
        result = {
          content: [
            { type: "text", text: "mock AX" },
            { type: "image", mimeType: "image/png", data: "mock-image" },
          ],
          structuredContent: null,
          isError: false,
        };
      } else if (tool === "click" && args.element_index === 91) {
        result = {
          content: [{ type: "text", text: "Error: stale element index 91" }],
          structuredContent: null,
          isError: false,
        };
      } else if (tool === "click" && args.element_index === 92) {
        result = {
          content: [{ type: "text", text: "Synthetic click tool error" }],
          structuredContent: null,
          isError: true,
        };
      } else if (tool === "click") {
        result = {
          content: [
            {
              type: "text",
              text: `Clicked element ${args.element_index}`,
            },
          ],
          structuredContent: null,
          isError: false,
        };
      } else if (tool === "set_value" && args.element_index === 93) {
        result = {
          content: [
            {
              type: "text",
              text: "Error: set_value element index 93 not found",
            },
          ],
          structuredContent: null,
          isError: false,
        };
      } else if (tool === "set_value" && args.element_index === 94) {
        result = {
          content: [{ type: "text", text: "Synthetic set_value tool error" }],
          structuredContent: null,
          isError: true,
        };
      } else if (tool === "set_value") {
        result = {
          content: [
            {
              type: "text",
              text: `Set element ${args.element_index} value`,
            },
          ],
          structuredContent: null,
          isError: false,
        };
      }
    }

    setTimeout(
      () =>
        this.onmessage?.({
          data: JSON.stringify({ jsonrpc: "2.0", id: message.id, result }),
        }),
      0,
    );
  }

  close() {
    this.closed = true;
  }
}

const codexDriver = new CodexAppServerDriver("ws://mock", {
  WebSocketImpl: MockWebSocket,
});
assert.equal(validateRuntimeDriver(codexDriver), codexDriver);
await assert.rejects(
  () => codexDriver.prepareTarget(),
  /non-empty appBundleId/,
  "Codex driver should reject a missing app bundle ID",
);
await assert.rejects(
  () => codexDriver.prepareTarget({ appBundleId: "   " }),
  /non-empty appBundleId/,
  "Codex driver should reject a blank app bundle ID",
);
await codexDriver.connect();
await codexDriver.prepareTarget({ appBundleId: "com.darkmatter.nixmac" });
let getAppStateTimeout;
const codexClientTool = codexDriver.client.tool.bind(codexDriver.client);
codexDriver.client.tool = (tool, args, timeout) => {
  if (tool === "get_app_state") getAppStateTimeout = timeout;
  return codexClientTool(tool, args, timeout);
};
const codexState = await codexDriver.visibleState({ app: "com.darkmatter.nixmac" });
assert.equal(codexState.text, "mock AX");
assert.equal(codexState.imageBase64, "mock-image");
assert.equal(
  getAppStateTimeout,
  90_000,
  "Codex driver should preserve the existing 90-second state-capture timeout",
);
const codexClickedWithStringIndex = await codexDriver.click({
  app: "com.darkmatter.nixmac",
  elementIndex: "7",
});
assert.equal(codexClickedWithStringIndex.ok, true);
const codexClickedWithIntegerIndex = await codexDriver.click({
  app: "com.darkmatter.nixmac",
  elementIndex: 8,
});
assert.equal(codexClickedWithIntegerIndex.ok, true);
const codexSetEmptyValue = await codexDriver.setValue({
  app: "com.darkmatter.nixmac",
  elementIndex: "9",
  value: "",
});
assert.deepEqual(codexSetEmptyValue, {
  ok: true,
  text: "Set element 9 value",
  isError: false,
});
const codexSetNonEmptyValue = await codexDriver.setValue({
  app: "com.darkmatter.nixmac",
  elementIndex: 10,
  value: "updated value",
});
assert.deepEqual(codexSetNonEmptyValue, {
  ok: true,
  text: "Set element 10 value",
  isError: false,
});
assert.deepEqual(
  codexMessages.map((message) => message.method),
  [
    "initialize",
    "thread/start",
    "mcpServer/tool/call",
    "mcpServer/tool/call",
    "mcpServer/tool/call",
    "mcpServer/tool/call",
    "mcpServer/tool/call",
  ],
  "Codex driver should preserve initialize, thread start, and tool-call request order",
);
assert.deepEqual(
  codexMessages[1].params,
  {
    cwd: "/tmp",
    model: "gpt-5.4-mini",
    approvalPolicy: "never",
    sandbox: "danger-full-access",
    ephemeral: true,
  },
  "Codex driver should preserve the existing app-server thread policy",
);
assert.deepEqual(
  codexMessages.slice(2).map((message) => message.params),
  [
    {
      server: "computer-use",
      threadId: "thread-codex-driver",
      tool: "get_app_state",
      arguments: { app: "com.darkmatter.nixmac" },
    },
    {
      server: "computer-use",
      threadId: "thread-codex-driver",
      tool: "click",
      arguments: { app: "com.darkmatter.nixmac", element_index: "7" },
    },
    {
      server: "computer-use",
      threadId: "thread-codex-driver",
      tool: "click",
      arguments: { app: "com.darkmatter.nixmac", element_index: 8 },
    },
    {
      server: "computer-use",
      threadId: "thread-codex-driver",
      tool: "set_value",
      arguments: {
        app: "com.darkmatter.nixmac",
        element_index: "9",
        value: "",
      },
    },
    {
      server: "computer-use",
      threadId: "thread-codex-driver",
      tool: "set_value",
      arguments: {
        app: "com.darkmatter.nixmac",
        element_index: 10,
        value: "updated value",
      },
    },
  ],
  "Codex driver should preserve tool names, thread ID, and argument shapes",
);

for (const [method, validArguments] of [
  ["visibleState", {}],
  ["click", { elementIndex: "11" }],
  ["setValue", { elementIndex: "11", value: "valid" }],
]) {
  for (const [label, appArguments] of [
    ["missing", {}],
    ["blank", { app: "   " }],
    ["invalid", { app: 42 }],
  ]) {
    const messageCountBeforeInvalidApp = codexMessages.length;
    await assert.rejects(
      () => codexDriver[method]({ ...validArguments, ...appArguments }),
      {
        name: "TypeError",
        message: "Codex app-server requires app to be a non-empty string",
      },
      `Codex driver ${method} should reject a ${label} app`,
    );
    assert.equal(
      codexMessages.length,
      messageCountBeforeInvalidApp,
      `Codex driver ${method} should not send a tool call for a ${label} app`,
    );
  }
}

for (const [method, validArguments] of [
  ["click", {}],
  ["setValue", { value: "valid" }],
]) {
  for (const [label, indexArguments] of [
    ["missing", {}],
    ["blank", { elementIndex: "" }],
    ["non-digit", { elementIndex: "seven" }],
    ["fractional", { elementIndex: 1.5 }],
    ["negative", { elementIndex: -1 }],
    ["null", { elementIndex: null }],
    ["digit-like object", { elementIndex: { toString: () => "7" } }],
    ["boxed string", { elementIndex: Object("7") }],
    ["bigint", { elementIndex: 7n }],
  ]) {
    const messageCountBeforeInvalidIndex = codexMessages.length;
    await assert.rejects(
      () =>
        codexDriver[method]({
          app: "com.darkmatter.nixmac",
          ...validArguments,
          ...indexArguments,
        }),
      {
        name: "TypeError",
        message: `Codex app-server ${method} requires a valid Codex elementIndex`,
      },
      `Codex driver ${method} should reject a ${label} element index`,
    );
    assert.equal(
      codexMessages.length,
      messageCountBeforeInvalidIndex,
      `Codex driver ${method} should not send a tool call for a ${label} element index`,
    );
  }
}

for (const [label, request] of [
  ["missing", { app: "com.darkmatter.nixmac", elementIndex: 10 }],
  ["null", { app: "com.darkmatter.nixmac", elementIndex: 10, value: null }],
  ["non-string", { app: "com.darkmatter.nixmac", elementIndex: 10, value: 42 }],
]) {
  const messageCountBeforeInvalidValue = codexMessages.length;
  await assert.rejects(
    () => codexDriver.setValue(request),
    {
      name: "TypeError",
      message: "Codex app-server setValue requires a string value",
    },
    `Codex driver should reject a ${label} setValue value`,
  );
  assert.equal(
    codexMessages.length,
    messageCountBeforeInvalidValue,
    `Codex driver should not send a tool call for a ${label} setValue value`,
  );
}

for (const [method, request, expectedText, expectedIsError] of [
  [
    "click",
    { app: "com.darkmatter.nixmac", elementIndex: 91 },
    "Error: stale element index 91",
    false,
  ],
  ["click", { app: "com.darkmatter.nixmac", elementIndex: 92 }, "Synthetic click tool error", true],
  [
    "setValue",
    { app: "com.darkmatter.nixmac", elementIndex: 93, value: "ignored" },
    "Error: set_value element index 93 not found",
    false,
  ],
  [
    "setValue",
    { app: "com.darkmatter.nixmac", elementIndex: 94, value: "ignored" },
    "Synthetic set_value tool error",
    true,
  ],
]) {
  assert.deepEqual(await codexDriver[method](request), {
    ok: false,
    text: expectedText,
    isError: expectedIsError,
  });
}

assert.equal(codexAppServerDriverDescriptor.id, "codex-app-server-computer-use");
codexDriver.close();
assert.equal(codexDriver.client.ws.closed, true);

const cuaFixtureDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/cua-driver",
);
const [
  cuaListAppsFixture,
  cuaListWindowsFixture,
  cuaWindowStateFixture,
  cuaActionSuccessFixture,
  cuaActionErrorFixture,
  cuaMetadataFixture,
] = await Promise.all(
  [
    "list-apps.json",
    "list-windows.json",
    "window-state.json",
    "action-success.json",
    "action-error.json",
    "metadata.json",
  ].map(async (fileName) => JSON.parse(await readFile(path.join(cuaFixtureDir, fileName), "utf8"))),
);

assert.deepEqual(pinnedCuaDriverMetadata, cuaMetadataFixture);
assert.equal(pinnedCuaDriverMetadata.cli.version_output, "cua-driver 0.12.6");
assert.equal(
  pinnedCuaDriverMetadata.app.content_tree_sha256,
  "9b702de4f1591a59428f01e76eceab5a11552d19c26329eef75f0669ddc44da0",
);
assert.equal(pinnedCuaDriverMetadata.daemon.launch_mode, "app-owned-standalone");
assert.deepEqual(
  parseCuaCodesignIdentity(`Executable=/Applications/CuaDriver.app/Contents/MacOS/cua-driver
CandidateCDHashFull sha256=b6f9dd1b42520d5eefcffcc6de1a1125ace382ac8ccfbfd64225690b8891f7f6
Authority=Developer ID Application: Cua AI, Inc. (YCK386LBJ7)
Authority=Developer ID Certification Authority
TeamIdentifier=YCK386LBJ7
`),
  {
    codeSigningDigestSha256: "b6f9dd1b42520d5eefcffcc6de1a1125ace382ac8ccfbfd64225690b8891f7f6",
    developerId: "Cua AI, Inc. (YCK386LBJ7)",
    teamIdentifier: "YCK386LBJ7",
  },
);

const cuaDigestFixtureDir = await mkdtemp(path.join(os.tmpdir(), "nixmac-cua-bundle-digest-"));
try {
  await mkdir(path.join(cuaDigestFixtureDir, "Contents", "MacOS"), {
    recursive: true,
  });
  await writeFile(path.join(cuaDigestFixtureDir, "Contents", "Info.plist"), "info");
  await writeFile(path.join(cuaDigestFixtureDir, "Contents", "MacOS", "cua-driver"), "binary");
  assert.equal(
    await hashCuaBundleTree(cuaDigestFixtureDir),
    "1551c9dc7b53067f36e26c19c1ee2eb3c307b5cde1deaff10fc458030ec8542d",
  );
} finally {
  await rm(cuaDigestFixtureDir, { recursive: true, force: true });
}

const processSpawnCalls = [];
const processRunner = createCuaProcessRunner({
  spawnImpl(command, args, options) {
    processSpawnCalls.push({ command, args, options });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stdout.setEncoding = () => {};
    child.stderr = new EventEmitter();
    child.stderr.setEncoding = () => {};
    child.kill = () => true;
    queueMicrotask(() => {
      child.stdout.emit("data", "cua-driver 0.12.6\n");
      child.emit("close", 0, null);
    });
    return child;
  },
});
assert.deepEqual(await processRunner.run("cua-driver", ["--version"]), {
  stdout: "cua-driver 0.12.6\n",
  stderr: "",
});
assert.equal(processSpawnCalls.length, 1);
assert.equal(processSpawnCalls[0].command, "cua-driver");
assert.deepEqual(processSpawnCalls[0].args, ["--version"]);
assert.equal(processSpawnCalls[0].options.shell, false);
assert.equal(processSpawnCalls[0].options.stdio[0], "ignore");

assert.deepEqual(
  parseCuaCliOutput(JSON.stringify(cuaListAppsFixture)).structured,
  cuaListAppsFixture,
  "pinned 0.12.6 direct structured stdout should parse without an MCP envelope",
);
assert.deepEqual(
  normalizeCuaActionOutput(parseCuaCliOutput(JSON.stringify(cuaActionSuccessFixture))),
  {
    ok: true,
    text: "Posted click to fixture pid 4242.",
    isError: false,
  },
);
assert.deepEqual(
  normalizeCuaActionOutput(parseCuaCliOutput(JSON.stringify(cuaActionErrorFixture))),
  {
    ok: false,
    text: "Element index 7 is stale. Capture a new window state.",
    isError: true,
  },
);
assert.deepEqual(
  normalizeCuaActionOutput(
    parseCuaCliOutput(
      JSON.stringify({
        content: [{ type: "text", text: "set_value was rejected" }],
        structuredContent: { ok: false },
        isError: false,
      }),
    ),
  ),
  {
    ok: false,
    text: "set_value was rejected",
    isError: false,
  },
  "ok:false must fail set_value even when the MCP envelope does not set isError",
);
assert.deepEqual(
  normalizeCuaActionOutput(parseCuaCliOutput(JSON.stringify({ ok: false, isError: false }))),
  {
    ok: false,
    text: "",
    isError: false,
  },
  "direct structured ok:false must remain a failure",
);
assert.deepEqual(
  normalizeCuaActionOutput(parseCuaCliOutput(JSON.stringify({ ok: true, isError: true }))),
  {
    ok: false,
    text: "",
    isError: true,
  },
  "direct structured isError:true must remain a failure",
);
assert.throws(() => parseCuaCliOutput("{malformed"), /malformed CuaDriver output/);
assert.throws(() => parseCuaCliOutput("x".repeat(65), { maxBytes: 64 }), /exceeds 64 bytes/);

const explicitWindow = selectCuaWindow(cuaListWindowsFixture.windows, 4242, {
  version: "0.12.6",
});
assert.equal(explicitWindow.window.window_id, 7002);
assert.equal(explicitWindow.currentSpaceEvidence, "explicit");

const nullFallbackWindow = selectCuaWindow(
  [
    {
      ...cuaListWindowsFixture.windows[0],
      window_id: 7011,
      z_index: 60,
    },
    {
      ...cuaListWindowsFixture.windows[0],
      window_id: 7010,
      z_index: 60,
    },
    {
      ...cuaListWindowsFixture.windows[2],
      window_id: 7009,
      z_index: 100,
    },
  ],
  4242,
  { version: "0.12.6" },
);
assert.equal(
  nullFallbackWindow.window.window_id,
  7010,
  "null current-Space fallback should break equal z-index ties by stable window id",
);
assert.equal(nullFallbackWindow.currentSpaceEvidence, "is_on_screen_fallback");
assert.throws(
  () =>
    selectCuaWindow(
      [
        {
          ...cuaListWindowsFixture.windows[0],
          is_on_screen: false,
          on_current_space: null,
        },
        cuaListWindowsFixture.windows[2],
      ],
      4242,
      { version: "0.12.6" },
    ),
  /no eligible on-screen current-Space layer-0 window/,
);
assert.throws(
  () =>
    selectCuaWindow(
      [
        {
          ...cuaListWindowsFixture.windows[0],
          on_current_space: null,
        },
      ],
      4242,
      { version: "0.12.7" },
    ),
  /no eligible on-screen current-Space layer-0 window/,
  "the null fallback must remain pinned to 0.12.6",
);

const cuaTargetBundleId = "com.darkmatter.nixmac.e2e";
const cuaTargetPath = "/Applications/Nixmac E2E.app";
const cuaTargetDigest = "a".repeat(64);
const cuaScreenshotBytes = Buffer.from("89504e470d0a1a0a", "hex");

function createCuaHarness({
  attachSocket = "",
  actionOutputs = {},
  competingRecord = null,
  driverIdentityOverrides = {},
  screenshotBytes = cuaScreenshotBytes,
} = {}) {
  const commands = [];
  const identityReads = [];
  let launched = false;
  const runner = {
    async run(command, args) {
      commands.push({ command, args: [...args] });
      if (command === "/opt/nixmac-e2e/bin/cua-driver" && args[0] === "--version") {
        return { stdout: "cua-driver 0.12.6\n", stderr: "" };
      }
      if (command === "/usr/bin/open") {
        return { stdout: "", stderr: "" };
      }
      if (command !== "/opt/nixmac-e2e/bin/cua-driver") {
        throw new Error(`Unexpected test command: ${command}`);
      }
      if (args[0] === "status") {
        return { stdout: "running pid=31337\n", stderr: "" };
      }
      if (args[0] === "stop") {
        return { stdout: "stopped\n", stderr: "" };
      }
      if (args[0] !== "call") {
        throw new Error(`Unexpected CuaDriver argv: ${args.join(" ")}`);
      }
      const tool = args[1];
      if (tool === "check_permissions") {
        return {
          stdout: JSON.stringify({
            accessibility: true,
            screen_recording: true,
            screen_recording_capturable: null,
            direct_capture_status: "not_checked",
            source: {
              attribution: "driver-daemon",
              bundle_id: "com.trycua.driver",
              executable: "/Applications/CuaDriver.app/Contents/MacOS/cua-driver",
              responsible_ppid: 1,
            },
          }),
          stderr: "",
        };
      }
      if (tool === "list_apps") {
        const fixture = structuredClone(cuaListAppsFixture);
        if (!launched && competingRecord) fixture.apps.push(competingRecord);
        if (launched) {
          fixture.apps[0].pid = 4242;
          fixture.apps[0].running = true;
        }
        return { stdout: JSON.stringify(fixture), stderr: "" };
      }
      if (tool === "launch_app") {
        launched = true;
        return {
          stdout: JSON.stringify({
            pid: 4242,
            bundle_id: cuaTargetBundleId,
            name: "Nixmac E2E",
            windows: [],
          }),
          stderr: "",
        };
      }
      if (tool === "list_windows") {
        return { stdout: JSON.stringify(cuaListWindowsFixture), stderr: "" };
      }
      if (tool === "get_window_state") {
        return { stdout: JSON.stringify(cuaWindowStateFixture), stderr: "" };
      }
      if (tool === "click" || tool === "set_value") {
        return {
          stdout: JSON.stringify(actionOutputs[tool] ?? cuaActionSuccessFixture),
          stderr: "",
        };
      }
      throw new Error(`Unexpected CuaDriver tool: ${tool}`);
    },
  };
  const dependencies = {
    async readBundleIdentity(appPath) {
      identityReads.push(appPath);
      if (appPath === "/Applications/CuaDriver.app") {
        return {
          bundleId: pinnedCuaDriverMetadata.app.bundle_id,
          shortVersion: pinnedCuaDriverMetadata.app.short_version,
          buildVersion: pinnedCuaDriverMetadata.app.build_version,
          digestSha256: pinnedCuaDriverMetadata.app.content_tree_sha256,
          codeSigningDigestSha256: pinnedCuaDriverMetadata.app.code_signing_digest_sha256,
          developerId: pinnedCuaDriverMetadata.app.developer_id,
          teamIdentifier: pinnedCuaDriverMetadata.app.team_identifier,
          ...driverIdentityOverrides,
        };
      }
      assert.equal(appPath, cuaTargetPath);
      return {
        bundleId: cuaTargetBundleId,
        shortVersion: "0.32.1",
        buildVersion: "0.32.1",
        digestSha256: cuaTargetDigest,
      };
    },
    async canonicalPath(appPath) {
      return appPath;
    },
    async queryPidExecutable(pid) {
      assert.equal(pid, 4242);
      return `${cuaTargetPath}/Contents/MacOS/nixmac`;
    },
    async readFile() {
      return screenshotBytes;
    },
    async removeFile() {},
    async sleep() {},
  };
  const driver = new CuaDriver({
    attachSocket,
    cliPath: "/opt/nixmac-e2e/bin/cua-driver",
    dependencies,
    driverAppPath: "/Applications/CuaDriver.app",
    processRunner: runner,
    runId: attachSocket ? "attach-fixture" : "owned-fixture",
    socketDirectory: "/tmp",
  });
  return { commands, driver, identityReads };
}

const socketDriverA = createCuaHarness().driver;
const socketDriverB = new CuaDriver({
  cliPath: "/opt/nixmac-e2e/bin/cua-driver",
  dependencies: {},
  processRunner: { async run() {} },
  runId: "second-fixture",
  socketDirectory: "/tmp",
});
assert.notEqual(socketDriverA.socketPath, socketDriverB.socketPath);
assert.match(socketDriverA.socketPath, /owned-fixture/);
assert.match(socketDriverB.socketPath, /second-fixture/);

const ownedHarness = createCuaHarness();
await ownedHarness.driver.connect();
assert.deepEqual(ownedHarness.commands[0], {
  command: "/opt/nixmac-e2e/bin/cua-driver",
  args: ["--version"],
});
assert.deepEqual(
  ownedHarness.commands.find((entry) => entry.command === "/usr/bin/open"),
  {
    command: "/usr/bin/open",
    args: [
      "-n",
      "-g",
      "-a",
      "CuaDriver",
      "--args",
      "serve",
      "--socket",
      ownedHarness.driver.socketPath,
    ],
  },
);
assert.equal(
  ownedHarness.commands.some(
    (entry) => entry.command === "/opt/nixmac-e2e/bin/cua-driver" && entry.args[0] === "serve",
  ),
  false,
  "the adapter must never directly spawn raw cua-driver serve",
);
assert.deepEqual(
  ownedHarness.commands.find(
    (entry) =>
      entry.command === "/opt/nixmac-e2e/bin/cua-driver" &&
      entry.args[0] === "call" &&
      entry.args[1] === "check_permissions",
  ).args,
  [
    "call",
    "check_permissions",
    JSON.stringify({ prompt: false }),
    "--socket",
    ownedHarness.driver.socketPath,
  ],
);
assert.deepEqual(ownedHarness.identityReads, ["/Applications/CuaDriver.app"]);

const wrongSignerHarness = createCuaHarness({
  driverIdentityOverrides: { teamIdentifier: "WRONGTEAM" },
});
await assert.rejects(() => wrongSignerHarness.driver.connect(), /teamIdentifier mismatch/);
assert.equal(
  wrongSignerHarness.commands.some((entry) => entry.command === "/usr/bin/open"),
  false,
  "the daemon must not launch when the installed app signing identity is wrong",
);

const preparedTarget = await ownedHarness.driver.prepareTarget({
  appBundleId: cuaTargetBundleId,
  appPath: cuaTargetPath,
});
assert.equal(preparedTarget.pid, 4242);
assert.equal(preparedTarget.windowId, 7002);
assert.equal(preparedTarget.currentSpaceEvidence, "explicit");
assert.deepEqual(
  ownedHarness.commands.find(
    (entry) =>
      entry.command === "/opt/nixmac-e2e/bin/cua-driver" &&
      entry.args[0] === "call" &&
      entry.args[1] === "launch_app",
  ).args,
  [
    "call",
    "launch_app",
    JSON.stringify({ bundle_id: cuaTargetBundleId }),
    "--socket",
    ownedHarness.driver.socketPath,
  ],
);
assert.deepEqual(
  ownedHarness.identityReads,
  ["/Applications/CuaDriver.app", cuaTargetPath, cuaTargetPath],
  "prepareTarget should hash the staged bundle before launch and again after binding its pid",
);

const cuaStateA = await ownedHarness.driver.visibleState({
  app: cuaTargetBundleId,
});
const cuaStateB = await ownedHarness.driver.visibleState({
  app: cuaTargetBundleId,
});
assert.equal(cuaStateA.text.includes("7 button Save changes"), true);
assert.equal(cuaStateA.text.includes("8 text field Configuration value"), true);
assert.equal(cuaStateA.text.includes("value=fixture value"), true);
assert.equal(cuaStateA.imageBase64, cuaScreenshotBytes.toString("base64"));
assert.equal(cuaStateA.target.pid, 4242);
assert.equal(cuaStateA.target.windowId, 7002);
assert.notEqual(cuaStateA.target.snapshotId, cuaStateB.target.snapshotId);
assert.equal(cuaStateA.target.snapshotId, "4242:7002:1");
assert.equal(cuaStateB.target.snapshotId, "4242:7002:2");
assert.equal(cuaStateB.metadata.currentSpaceEvidence, "explicit");
const getWindowStateCalls = ownedHarness.commands.filter(
  (entry) =>
    entry.command === "/opt/nixmac-e2e/bin/cua-driver" &&
    entry.args[0] === "call" &&
    entry.args[1] === "get_window_state",
);
assert.equal(getWindowStateCalls.length, 2);
for (const [index, entry] of getWindowStateCalls.entries()) {
  assert.deepEqual(entry.args, [
    "call",
    "get_window_state",
    JSON.stringify({ pid: 4242, window_id: 7002 }),
    "--screenshot-out-file",
    `/tmp/nixmac-cua-owned-fixture-state-${index + 1}.png`,
    "--socket",
    ownedHarness.driver.socketPath,
  ]);
  assert.equal(entry.args.includes("--raw"), false);
  assert.equal(entry.args.includes("--compact"), false);
  assert.equal(entry.args.includes("--no-daemon"), false);
}

const staleCommandCount = ownedHarness.commands.length;
await assert.rejects(
  () =>
    ownedHarness.driver.click({
      app: cuaTargetBundleId,
      elementIndex: "7",
      elementAddress: {
        kind: "cua-element-index",
        elementIndex: 7,
        ...cuaStateA.target,
      },
    }),
  /stale CuaDriver element address/,
);
assert.equal(
  ownedHarness.commands.length,
  staleCommandCount,
  "stale addresses must be rejected before invoking CuaDriver",
);

assert.deepEqual(
  await ownedHarness.driver.click({
    app: cuaTargetBundleId,
    elementIndex: "7",
    elementAddress: {
      kind: "cua-element-index",
      elementIndex: 7,
      ...cuaStateB.target,
    },
  }),
  {
    ok: true,
    text: "Posted click to fixture pid 4242.",
    isError: false,
  },
);
assert.deepEqual(
  JSON.parse(
    ownedHarness.commands.find(
      (entry) =>
        entry.command === "/opt/nixmac-e2e/bin/cua-driver" &&
        entry.args[0] === "call" &&
        entry.args[1] === "click",
    ).args[2],
  ),
  {
    pid: 4242,
    window_id: 7002,
    element_index: 7,
    element_token: "s0042:7",
  },
);

assert.deepEqual(
  await ownedHarness.driver.setValue({
    app: cuaTargetBundleId,
    elementIndex: "8",
    elementAddress: {
      kind: "cua-element-index",
      elementIndex: 8,
      ...cuaStateB.target,
    },
    value: "updated fixture value",
  }),
  {
    ok: true,
    text: "Posted click to fixture pid 4242.",
    isError: false,
  },
);
assert.deepEqual(
  JSON.parse(
    ownedHarness.commands.find(
      (entry) =>
        entry.command === "/opt/nixmac-e2e/bin/cua-driver" &&
        entry.args[0] === "call" &&
        entry.args[1] === "set_value",
    ).args[2],
  ),
  {
    pid: 4242,
    window_id: 7002,
    element_index: 8,
    element_token: "s0042:8",
    value: "updated fixture value",
  },
);

await ownedHarness.driver.close();
assert.deepEqual(ownedHarness.commands.at(-1), {
  command: "/opt/nixmac-e2e/bin/cua-driver",
  args: ["stop", "--socket", ownedHarness.driver.socketPath],
});

const attachedHarness = createCuaHarness({
  attachSocket: "/tmp/nixmac-cua-existing.sock",
});
await attachedHarness.driver.connect();
await attachedHarness.driver.close();
assert.equal(
  attachedHarness.commands.some((entry) => entry.command === "/usr/bin/open"),
  false,
);
assert.equal(
  attachedHarness.commands.some((entry) => entry.args[0] === "stop"),
  false,
  "attach mode must never stop a daemon it did not start",
);

const competingHarness = createCuaHarness({
  competingRecord: {
    active: false,
    bundle_id: cuaTargetBundleId,
    kind: "desktop",
    last_used: null,
    launch_path: null,
    name: "Nixmac E2E Competing Fixture",
    pid: 5151,
    running: true,
    windows: [],
  },
});
await competingHarness.driver.connect();
await assert.rejects(
  () =>
    competingHarness.driver.prepareTarget({
      appBundleId: cuaTargetBundleId,
      appPath: cuaTargetPath,
    }),
  /competing .* process is already running/,
);
await competingHarness.driver.close();

const invalidPngHarness = createCuaHarness({
  screenshotBytes: Buffer.from("not-a-png"),
});
await invalidPngHarness.driver.connect();
await invalidPngHarness.driver.prepareTarget({
  appBundleId: cuaTargetBundleId,
  appPath: cuaTargetPath,
});
await assert.rejects(
  () => invalidPngHarness.driver.visibleState({ app: cuaTargetBundleId }),
  /valid PNG/,
);
await invalidPngHarness.driver.close();

assert.equal(cuaDriverDescriptor.id, "cua-driver");
assert.equal(
  validateDriverDescriptor(cuaDriverDescriptor, {
    additionalAddressValidators: {
      "cua-element-index": validateCuaElementIndexAddress,
    },
  }).ok,
  true,
);

console.log("Computer Use runtime driver contract self-test passed.");
