#!/usr/bin/env node
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
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
  validatePngScreenshot,
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
  cuaClickSuccessFixture,
  cuaActionSuccessFixture,
  cuaActionErrorFixture,
  cuaMetadataFixture,
] = await Promise.all(
  [
    "list-apps.json",
    "list-windows.json",
    "window-state.json",
    "click-success.json",
    "action-success.json",
    "action-error.json",
    "metadata.json",
  ].map(async (fileName) => JSON.parse(await readFile(path.join(cuaFixtureDir, fileName), "utf8"))),
);
const cuaSetValueSuccessFixture = (
  await readFile(path.join(cuaFixtureDir, "set-value-success.txt"), "utf8")
).trimEnd();

assert.deepEqual(pinnedCuaDriverMetadata, cuaMetadataFixture);
assert.equal(pinnedCuaDriverMetadata.cli.version_output, "cua-driver 0.12.6");
assert.equal(
  pinnedCuaDriverMetadata.cli.sha256,
  "3ee06efc14bb4ec501a4a8d8963514150684332f0281cc224c51b3dba3ef76ea",
);
assert.equal(
  pinnedCuaDriverMetadata.cli.code_signing_digest_sha256,
  "b0c0ca9c84e2400ae757710bef868a13ac709a07cb6e598b9f71a3a3c613a6b8",
);
assert.equal(pinnedCuaDriverMetadata.cli.developer_id, "Cua AI, Inc. (YCK386LBJ7)");
assert.equal(pinnedCuaDriverMetadata.cli.team_identifier, "YCK386LBJ7");
assert.equal(
  pinnedCuaDriverMetadata.app.content_tree_sha256,
  "9b702de4f1591a59428f01e76eceab5a11552d19c26329eef75f0669ddc44da0",
);
assert.equal(pinnedCuaDriverMetadata.daemon.launch_mode, "app-owned-standalone");
assert.equal(pinnedCuaDriverMetadata.fixtures.new_live_capture_performed, false);
assert.match(pinnedCuaDriverMetadata.fixtures.provenance["click-success.json"], /source-derived/);
assert.match(
  pinnedCuaDriverMetadata.fixtures.provenance["action-success.json"],
  /sanitized historical captured MCP envelope/,
);
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

const cuaDigestBoundsFixtureDir = await mkdtemp(
  path.join(os.tmpdir(), "nixmac-cua-bundle-bounds-"),
);
try {
  await writeFile(path.join(cuaDigestBoundsFixtureDir, "a"), "1234");
  await writeFile(path.join(cuaDigestBoundsFixtureDir, "b"), "5678");
  await assert.rejects(
    hashCuaBundleTree(cuaDigestBoundsFixtureDir, { maxFiles: 1 }),
    /file count exceeds 1/,
  );
  await assert.rejects(
    hashCuaBundleTree(cuaDigestBoundsFixtureDir, { maxTotalBytes: 7 }),
    /total bytes exceed 7/,
  );

  const sparsePath = path.join(cuaDigestBoundsFixtureDir, "sparse");
  const sparseFile = await open(sparsePath, "w");
  try {
    await sparseFile.truncate(1_048_577);
  } finally {
    await sparseFile.close();
  }
  const sparseStartedAt = Date.now();
  await assert.rejects(
    hashCuaBundleTree(cuaDigestBoundsFixtureDir, {
      maxFileBytes: 1_048_576,
      maxTotalBytes: 4_194_304,
    }),
    /file bytes exceed 1048576/,
  );
  assert.ok(Date.now() - sparseStartedAt < 1_000, "sparse-file bounds must fail before reading");

  await rm(sparsePath);
  await writeFile(path.join(cuaDigestBoundsFixtureDir, "large"), Buffer.alloc(2 * 1_048_576, 0x61));
  const firstLargeDigest = await hashCuaBundleTree(cuaDigestBoundsFixtureDir, {
    maxFileBytes: 3 * 1_048_576,
    maxTotalBytes: 3 * 1_048_576,
  });
  const secondLargeDigest = await hashCuaBundleTree(cuaDigestBoundsFixtureDir, {
    maxFileBytes: 3 * 1_048_576,
    maxTotalBytes: 3 * 1_048_576,
  });
  assert.equal(firstLargeDigest, secondLargeDigest, "streamed bundle hashing must be deterministic");

  const symlinkPath = path.join(cuaDigestBoundsFixtureDir, "linked");
  await symlink("a", symlinkPath);
  await assert.rejects(
    hashCuaBundleTree(cuaDigestBoundsFixtureDir),
    /rejects non-regular entry/,
  );
} finally {
  await rm(cuaDigestBoundsFixtureDir, { recursive: true, force: true });
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
assert.equal(processSpawnCalls[0].options.detached, true);

let nextFakeCuaPid = 51_000;
function fakeCuaChild() {
  const child = new EventEmitter();
  child.pid = nextFakeCuaPid++;
  child.stdout = new EventEmitter();
  child.stdout.setEncoding = () => {};
  child.stdout.destroy = () => {};
  child.stderr = new EventEmitter();
  child.stderr.setEncoding = () => {};
  child.stderr.destroy = () => {};
  return child;
}

const stdoutOverflowSignals = [];
let stdoutOverflowChild;
const stdoutOverflowRunner = createCuaProcessRunner({
  maxOutputBytes: 8,
  signalProcessGroup(pid, signal) {
    stdoutOverflowSignals.push({ pid, signal });
    queueMicrotask(() => stdoutOverflowChild.emit("close", null, signal));
  },
  spawnImpl() {
    stdoutOverflowChild = fakeCuaChild();
    queueMicrotask(() => stdoutOverflowChild.stdout.emit("data", "123456789"));
    return stdoutOverflowChild;
  },
});
await assert.rejects(
  stdoutOverflowRunner.run("cua-driver", ["call", "list_apps", "{}"]),
  /stdout exceeds 8 bytes/,
);
assert.deepEqual(stdoutOverflowSignals, [
  { pid: stdoutOverflowChild.pid, signal: "SIGTERM" },
  { pid: stdoutOverflowChild.pid, signal: "SIGKILL" },
]);

const stderrOverflowSignals = [];
let stderrOverflowChild;
const stderrOverflowRunner = createCuaProcessRunner({
  maxOutputBytes: 8,
  signalProcessGroup(pid, signal) {
    stderrOverflowSignals.push({ pid, signal });
    queueMicrotask(() => stderrOverflowChild.emit("close", null, signal));
  },
  spawnImpl() {
    stderrOverflowChild = fakeCuaChild();
    queueMicrotask(() => stderrOverflowChild.stderr.emit("data", "123456789"));
    return stderrOverflowChild;
  },
});
await assert.rejects(
  stderrOverflowRunner.run("cua-driver", ["call", "list_apps", "{}"]),
  /stderr exceeds 8 bytes/,
);
assert.deepEqual(stderrOverflowSignals, [
  { pid: stderrOverflowChild.pid, signal: "SIGTERM" },
  { pid: stderrOverflowChild.pid, signal: "SIGKILL" },
]);

const nonzeroRunner = createCuaProcessRunner({
  spawnImpl() {
    const child = fakeCuaChild();
    queueMicrotask(() => {
      child.stderr.emit("data", "daemon rejected fixture request\n");
      child.emit("close", 23, null);
    });
    return child;
  },
});
await assert.rejects(nonzeroRunner.run("cua-driver", ["call", "click", "{}"]), (error) => {
  assert.equal(error.code, 23);
  assert.equal(error.stderr, "daemon rejected fixture request\n");
  return /exited with 23/.test(error.message);
});

const scheduledRunnerTimers = [];
const cancelledRunnerTimers = [];
const timeoutSignals = [];
let timeoutChild;
const timeoutRunner = createCuaProcessRunner({
  timeoutMs: 90,
  killGraceMs: 25,
  signalProcessGroup(pid, signal) {
    timeoutSignals.push({ pid, signal });
  },
  scheduleTimeout(callback, delayMs) {
    const handle = {
      callback,
      delayMs,
      unref() {},
    };
    scheduledRunnerTimers.push(handle);
    return handle;
  },
  cancelTimeout(handle) {
    cancelledRunnerTimers.push(handle);
  },
  spawnImpl() {
    timeoutChild = fakeCuaChild();
    return timeoutChild;
  },
});
const timedOutRun = timeoutRunner.run("cua-driver", ["call", "list_apps", "{}"]);
assert.equal(scheduledRunnerTimers[0].delayMs, 90);
scheduledRunnerTimers[0].callback();
assert.deepEqual(timeoutSignals, [{ pid: timeoutChild.pid, signal: "SIGTERM" }]);
assert.equal(scheduledRunnerTimers[1].delayMs, 25);
scheduledRunnerTimers[1].callback();
await assert.rejects(timedOutRun, (error) => {
  assert.equal(error.signal, "SIGKILL");
  return /timed out after 90ms/.test(error.message);
});
assert.deepEqual(timeoutSignals, [
  { pid: timeoutChild.pid, signal: "SIGTERM" },
  { pid: timeoutChild.pid, signal: "SIGKILL" },
]);
assert.equal(cancelledRunnerTimers.includes(scheduledRunnerTimers[0]), true);
assert.equal(cancelledRunnerTimers.includes(scheduledRunnerTimers[1]), true);
timeoutChild.emit("close", null, "SIGKILL");

const descendantPipeRunner = createCuaProcessRunner({
  timeoutMs: 75,
  killGraceMs: 100,
});
const descendantPipeStartedAt = Date.now();
await assert.rejects(
  descendantPipeRunner.run(process.execPath, [
    "-e",
    `
      const { spawn } = require("node:child_process");
      process.on("SIGTERM", () => {});
      spawn(process.execPath, [
        "-e",
        "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)",
      ], { stdio: ["ignore", 1, 2] });
      setInterval(() => {}, 1000);
    `,
  ]),
  /timed out after 75ms/,
);
assert.ok(
  Date.now() - descendantPipeStartedAt < 1_500,
  "a TERM-resistant descendant holding inherited pipes must not defeat the runner deadline",
);

assert.deepEqual(
  parseCuaCliOutput(JSON.stringify(cuaListAppsFixture)).structured,
  cuaListAppsFixture,
  "pinned 0.12.6 direct structured stdout should parse without an MCP envelope",
);
assert.deepEqual(
  normalizeCuaActionOutput(parseCuaCliOutput(JSON.stringify(cuaClickSuccessFixture)), {
    tool: "click",
    input: { element_index: 7 },
  }),
  {
    ok: true,
    text: "",
    isError: false,
  },
  "click requires the pinned direct structured success schema",
);
assert.throws(
  () =>
    normalizeCuaActionOutput(
      parseCuaCliOutput(JSON.stringify({ ...cuaClickSuccessFixture, ok: true })),
      {
        tool: "click",
        input: { element_index: 7 },
      },
    ),
  /click.*structured success evidence/,
  "direct click output must not be widened to the historical envelope schema",
);
assert.deepEqual(
  normalizeCuaActionOutput(parseCuaCliOutput(cuaSetValueSuccessFixture), {
    tool: "set_value",
    input: { element_index: 8 },
  }),
  {
    ok: true,
    text: cuaSetValueSuccessFixture,
    isError: false,
  },
  "pinned macOS set_value accepts a source-derived plaintext success tied to its element index",
);
for (const sourceDerivedSetValueSuccess of [
  "✅ Set AXValue on [8] AXSlider via AXIncrement/AXDecrement stepping.",
  "✅ Selected 'Dark' in AXPopUpButton [8] \"Theme\" via AX child AXPress.",
  "✅ Set select [8] 'Theme' to 'dark' via Safari JavaScript (DOM value: \"dark\").",
  "✅ Set AXValue on [8] AXTextField.\n\n🔀 Action caused a different app to become frontmost.",
]) {
  assert.deepEqual(
    normalizeCuaActionOutput(parseCuaCliOutput(sourceDerivedSetValueSuccess), {
      tool: "set_value",
      input: { element_index: 8 },
    }),
    {
      ok: true,
      text: sourceDerivedSetValueSuccess,
      isError: false,
    },
    "every pinned macOS set_value source success family should remain allowlisted",
  );
}
assert.deepEqual(
  normalizeCuaActionOutput(parseCuaCliOutput(JSON.stringify(cuaActionSuccessFixture)), {
    tool: "click",
    input: { element_index: 7 },
  }),
  {
    ok: true,
    text: "Posted click to fixture pid 4242.",
    isError: false,
  },
  "the exact bounded historical MCP envelope remains compatible",
);
assert.throws(
  () =>
    normalizeCuaActionOutput(
      parseCuaCliOutput(
        JSON.stringify({
          ...cuaActionSuccessFixture,
          structuredContent: cuaClickSuccessFixture,
        }),
      ),
      {
        tool: "click",
        input: { element_index: 7 },
      },
    ),
  /click.*structured success evidence/,
  "historical envelopes must retain their own exact structured schema",
);
assert.throws(
  () =>
    normalizeCuaActionOutput(parseCuaCliOutput(JSON.stringify(cuaActionErrorFixture)), {
      tool: "click",
      input: { element_index: 7 },
    }),
  /isError:true/,
);
assert.throws(
  () =>
    normalizeCuaActionOutput(
      parseCuaCliOutput(
        JSON.stringify({
          content: [{ type: "text", text: "Historical compatibility click fixture succeeded." }],
          structuredContent: cuaClickSuccessFixture,
          isError: false,
          extension: "not allowed",
        }),
      ),
      { tool: "click", input: { element_index: 7 } },
    ),
  /unknown MCP envelope key/,
);
assert.throws(
  () =>
    normalizeCuaActionOutput(
      parseCuaCliOutput(
        JSON.stringify({
          content: [
            {
              type: "text",
              text: "Historical compatibility click fixture succeeded.",
              extension: "not allowed",
            },
          ],
          structuredContent: cuaClickSuccessFixture,
          isError: false,
        }),
      ),
      { tool: "click", input: { element_index: 7 } },
    ),
  /invalid MCP content/,
);
assert.throws(
  () =>
    normalizeCuaActionOutput(parseCuaCliOutput("{}"), {
      tool: "click",
      input: { element_index: 7 },
    }),
  /click.*structured success evidence/,
);
assert.throws(
  () =>
    normalizeCuaActionOutput(
      parseCuaCliOutput(
        JSON.stringify({
          effect: "suspected_noop",
          path: "ax",
          verified: false,
        }),
      ),
      { tool: "click", input: { element_index: 7 } },
    ),
  /suspected_noop.*semantic soft failure/,
);
assert.throws(
  () =>
    normalizeCuaActionOutput(parseCuaCliOutput("Clicked element [7]."), {
      tool: "click",
      input: { element_index: 7 },
    }),
  /click.*structured success evidence/,
);
assert.throws(
  () =>
    normalizeCuaActionOutput(parseCuaCliOutput(cuaSetValueSuccessFixture), {
      tool: "set_value",
      input: { element_index: 9 },
    }),
  /set_value.*success evidence/,
);
assert.throws(
  () =>
    normalizeCuaActionOutput(parseCuaCliOutput("set_value succeeded"), {
      tool: "set_value",
      input: { element_index: 8 },
    }),
  /set_value.*success evidence/,
);
assert.throws(
  () =>
    normalizeCuaActionOutput(parseCuaCliOutput(JSON.stringify(cuaClickSuccessFixture)), {
      tool: "set_value",
      input: { element_index: 8 },
    }),
  /set_value.*success evidence/,
);
assert.throws(
  () =>
    normalizeCuaActionOutput(
      parseCuaCliOutput(
        JSON.stringify({
          ...cuaClickSuccessFixture,
          unexpected_top_level: true,
        }),
      ),
      {
        tool: "click",
        input: { element_index: 7 },
      },
    ),
  /click lacks pinned structured success evidence/,
  "click must reject additive unknown structured response keys",
);
assert.throws(
  () =>
    normalizeCuaActionOutput(
      parseCuaCliOutput(
        JSON.stringify({
          content: [{ type: "text", text: "set_value was rejected" }],
          structuredContent: { ok: false },
          isError: false,
        }),
      ),
      { tool: "set_value", input: { element_index: 8 } },
    ),
  /set_value.*success evidence/,
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
const cuaScreenshotBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==",
  "base64",
);
const cuaRuntimeFixtureDir = await mkdtemp(path.join(os.tmpdir(), "nixmac-cua-runtime-"));
const pngTestCrcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc & 1) === 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});
function pngTestCrc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = pngTestCrcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function pngTestChunk(type, data = Buffer.alloc(0)) {
  const typeBytes = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBytes.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(pngTestCrc32(Buffer.concat([typeBytes, data])), 8 + data.length);
  return chunk;
}
const decompressionBombPng = Buffer.from(cuaScreenshotBytes);
decompressionBombPng.writeUInt32BE(8192, 16);
decompressionBombPng.writeUInt32BE(4096, 20);
decompressionBombPng.writeUInt32BE(pngTestCrc32(decompressionBombPng.subarray(12, 29)), 29);
assert.throws(
  () => validatePngScreenshot(decompressionBombPng),
  /decoded PNG size exceeds/,
  "decoded screenshot bytes must be bounded before IDAT inflation",
);
const unknownCriticalChunkPng = Buffer.concat([
  cuaScreenshotBytes.subarray(0, 33),
  pngTestChunk("ABCD"),
  cuaScreenshotBytes.subarray(33),
]);
assert.throws(() => validatePngScreenshot(unknownCriticalChunkPng), /unknown critical PNG chunk/);
const paletteChunkPng = Buffer.concat([
  cuaScreenshotBytes.subarray(0, 33),
  pngTestChunk("PLTE", Buffer.from([0, 0, 0])),
  cuaScreenshotBytes.subarray(33),
]);
assert.throws(
  () => validatePngScreenshot(paletteChunkPng),
  /PLTE is not allowed/,
  "the qualified RGB/RGBA screenshot contract must reject unqualified palette metadata",
);
const validIdatLength = cuaScreenshotBytes.readUInt32BE(33);
const idatWithTrailingBytesPng = Buffer.concat([
  cuaScreenshotBytes.subarray(0, 33),
  pngTestChunk(
    "IDAT",
    Buffer.concat([
      cuaScreenshotBytes.subarray(41, 41 + validIdatLength),
      Buffer.from([0xde, 0xad]),
    ]),
  ),
  cuaScreenshotBytes.subarray(45 + validIdatLength),
]);
assert.throws(
  () => validatePngScreenshot(idatWithTrailingBytesPng),
  /trailing bytes after zlib stream/,
  "IDAT bytes after a valid zlib end marker must be rejected",
);
for (const [type, data] of [
  ["tEXt", Buffer.from("Author\0same-uid-forgery", "latin1")],
  ["zTXt", Buffer.from("Comment\0\0same-uid-forgery", "latin1")],
  ["iTXt", Buffer.from("Comment\0\0\0\0\0same-uid-forgery", "latin1")],
  ["iCCP", Buffer.from("Profile\0\0same-uid-forgery", "latin1")],
]) {
  const metadataPng = Buffer.concat([
    cuaScreenshotBytes.subarray(0, 33),
    pngTestChunk(type, data),
    cuaScreenshotBytes.subarray(33),
  ]);
  assert.throws(
    () => validatePngScreenshot(metadataPng),
    /pixel-only screenshot evidence/,
    `${type} metadata must not enter screenshot evidence`,
  );
}

function createCuaHarness({
  attachSocket = "",
  actionOutputs = {},
  cliIdentityOverrides = {},
  competingRecord = null,
  daemonBirthUsec = 101,
  daemonCanonicalFailuresAfterLaunch = 0,
  daemonExecutable = "/Applications/CuaDriver.app/Contents/MacOS/cua-driver",
  daemonExitChecksAfterStop = 0,
  daemonIdentityFailuresAfterLaunch = 0,
  daemonKillFailures = 0,
  daemonListenerExecutable = daemonExecutable,
  daemonListenerLingerChecksAfterStop = 0,
  daemonListenerPid = 31337,
  daemonReplacementBeforeTermination = false,
  daemonStopFailures = 0,
  driverIdentityOverrides = {},
  duringStatus = null,
  duringTool = {},
  extraNewDaemonInstance = null,
  lsofOutput = "",
  openCreatesDaemon = true,
  openFailuresAfterLaunch = 0,
  permissionSourceExecutable = "/Applications/CuaDriver.app/Contents/MacOS/cua-driver",
  replacementListenerAfterStop = false,
  replacementSocketAfterStop = false,
  screenshotBytes = cuaScreenshotBytes,
  socketAppearsOnOpen = true,
  socketPathLingersAfterStop = false,
  statusFailures = 0,
  launchAppRpcFailures = 0,
  targetBirthUsec = 202,
  targetCanonicalFailuresAfterLaunch = 0,
  targetExitChecksAfterKill = 0,
  targetIdentityFailuresAfterLaunch = 0,
  targetIdentityOverrides = {},
  targetKillFailures = 0,
  targetQueryFailuresAfterLaunch = 0,
  targetReplacementAfterQueryFailure = false,
  targetReplacementBeforeTermination = false,
  toolStructuredMutators = {},
  windowReadyAfter = 0,
  toolOutputs = {},
  driverOptions = {},
} = {}) {
  const commands = [];
  const commandOptions = [];
  const events = [];
  const applicationInspections = [];
  const applicationTerminations = [];
  const identityReads = [];
  const listedProcessExecutables = [];
  const pidQueries = [];
  const processInstanceQueries = [];
  const sleeps = [];
  const control = {
    daemonBirthSec: 1_785_000_000,
    daemonBirthUsec,
    daemonCanonicalFailuresAfterLaunch,
    daemonExecutable,
    daemonExitChecksRemaining: daemonExitChecksAfterStop,
    daemonIdentityFailuresAfterLaunch,
    daemonKillFailures,
    daemonListenerBirthSec: 1_785_000_000,
    daemonListenerBirthUsec: daemonBirthUsec,
    daemonListenerExecutable,
    daemonListenerLingerChecksRemaining: daemonListenerLingerChecksAfterStop,
    daemonListenerPid,
    daemonListenerPresent: false,
    daemonPid: 31337,
    daemonReplacementBeforeTermination,
    daemonRunning: false,
    daemonStopFailures,
    daemonStopped: false,
    openFailuresAfterLaunch,
    openCreatesDaemon,
    postKillExecutable: "",
    replacementListenerAfterStop,
    replacementSocketAfterStop,
    socketDev: 42,
    socketIno: 9001,
    socketAppearsOnOpen,
    socketPathLingersAfterStop,
    socketPresent: false,
    statusFailures,
    launchAppRpcFailures,
    targetBirthSec: 1_785_000_100,
    targetBirthUsec,
    targetCanonicalCount: 0,
    targetCanonicalFailuresAfterLaunch,
    targetExecutable: `${cuaTargetPath}/Contents/MacOS/nixmac`,
    targetExitChecksRemaining: targetExitChecksAfterKill,
    targetIdentityFailuresAfterLaunch,
    targetKillFailures,
    targetQueryCount: 0,
    targetQueryFailuresAfterLaunch,
    targetReplacementAfterQueryFailure,
    targetReplacementBeforeTermination,
    targetRunning: false,
  };
  let listWindowsCalls = 0;
  const runner = {
    async run(command, args, options = {}) {
      commands.push({ command, args: [...args] });
      commandOptions.push({ command, args: [...args], options: { ...options } });
      events.push(`run:${path.basename(command)}:${args[0] ?? ""}`);
      if (command === "/opt/nixmac-e2e/bin/cua-driver" && args[0] === "--version") {
        return { stdout: "cua-driver 0.12.6\n", stderr: "" };
      }
      if (command === "/usr/bin/open") {
        control.daemonRunning = control.openCreatesDaemon;
        control.daemonListenerPresent =
          control.openCreatesDaemon && control.socketAppearsOnOpen;
        control.socketPresent = control.openCreatesDaemon && control.socketAppearsOnOpen;
        control.daemonStopped = false;
        if (control.openFailuresAfterLaunch > 0) {
          control.openFailuresAfterLaunch -= 1;
          throw new Error("synthetic open failure after launch acceptance");
        }
        return { stdout: "", stderr: "" };
      }
      if (command === "/usr/sbin/lsof") {
        if (lsofOutput) return { stdout: lsofOutput, stderr: "" };
        if (control.daemonStopped && control.daemonListenerLingerChecksRemaining > 0) {
          control.daemonListenerLingerChecksRemaining -= 1;
          return {
            stdout: `p${control.daemonPid}\nccua-driver\nf9u\nn${args.at(-1)}\n`,
            stderr: "",
          };
        }
        if (!control.daemonListenerPresent) return { stdout: "", stderr: "" };
        return {
          stdout: `p${control.daemonListenerPid}\nccua-driver\nf9u\nn${args.at(-1)}\n`,
          stderr: "",
        };
      }
      if (command !== "/opt/nixmac-e2e/bin/cua-driver") {
        throw new Error(`Unexpected test command: ${command}`);
      }
      if (args[0] === "status") {
        if (control.statusFailures > 0) {
          control.statusFailures -= 1;
          throw new Error("synthetic daemon readiness failure");
        }
        duringStatus?.(control);
        return { stdout: "running pid=31337\n", stderr: "" };
      }
      if (args[0] === "stop") {
        if (control.daemonStopFailures > 0) {
          control.daemonStopFailures -= 1;
          throw new Error("synthetic daemon stop failure");
        }
        control.daemonStopped = true;
        control.daemonRunning = false;
        if (control.replacementListenerAfterStop) {
          control.daemonListenerPid = 31338;
          control.daemonListenerBirthUsec += 1;
          control.daemonListenerPresent = true;
          control.socketIno += 1;
          control.socketPresent = true;
        } else {
          control.daemonListenerPresent = false;
          if (control.replacementSocketAfterStop) {
            control.socketIno += 1;
            control.socketPresent = true;
          } else {
            control.socketPresent = control.socketPathLingersAfterStop;
          }
        }
        return { stdout: "stopped\n", stderr: "" };
      }
      if (args[0] !== "call") {
        throw new Error(`Unexpected CuaDriver argv: ${args.join(" ")}`);
      }
      const tool = args[1];
      if (Object.hasOwn(toolOutputs, tool)) {
        const output = toolOutputs[tool];
        duringTool[tool]?.(control);
        return {
          stdout: typeof output === "string" ? output : JSON.stringify(output),
          stderr: "",
        };
      }
      if (tool === "check_permissions") {
        const output = {
          accessibility: true,
          screen_recording: true,
          screen_recording_capturable: null,
          direct_capture_status: "not_checked",
          source: {
            attribution: "driver-daemon",
            bundle_id: "com.trycua.driver",
            disclaim_env: true,
            executable: permissionSourceExecutable,
            note: "fixture daemon attribution",
            pid: 31337,
            responsible_ppid: 1,
          },
        };
        toolStructuredMutators[tool]?.(output);
        return {
          stdout: JSON.stringify(output),
          stderr: "",
        };
      }
      if (tool === "list_apps") {
        const fixture = structuredClone(cuaListAppsFixture);
        if (!control.targetRunning && competingRecord) fixture.apps.push(competingRecord);
        if (control.targetRunning) {
          fixture.apps[0].pid = 4242;
          fixture.apps[0].running = true;
        }
        toolStructuredMutators[tool]?.(fixture);
        return { stdout: JSON.stringify(fixture), stderr: "" };
      }
      if (tool === "launch_app") {
        control.targetRunning = true;
        if (control.launchAppRpcFailures > 0) {
          control.launchAppRpcFailures -= 1;
          throw new Error("synthetic launch_app transport failure after process creation");
        }
        const output = {
          pid: 4242,
          bundle_id: cuaTargetBundleId,
          name: "Nixmac E2E",
          windows: [],
        };
        toolStructuredMutators[tool]?.(output);
        return { stdout: JSON.stringify(output), stderr: "" };
      }
      if (tool === "list_windows") {
        listWindowsCalls += 1;
        if (listWindowsCalls <= windowReadyAfter) {
          return { stdout: JSON.stringify({ windows: [] }), stderr: "" };
        }
        const output = structuredClone(cuaListWindowsFixture);
        toolStructuredMutators[tool]?.(output);
        return { stdout: JSON.stringify(output), stderr: "" };
      }
      if (tool === "get_window_state") {
        duringTool[tool]?.(control);
        const output = {
          ...structuredClone(cuaWindowStateFixture),
          screenshot_png_b64: screenshotBytes.toString("base64"),
        };
        toolStructuredMutators[tool]?.(output);
        return {
          stdout: JSON.stringify(output),
          stderr: "",
        };
      }
      if (tool === "click" || tool === "set_value") {
        const output =
          actionOutputs[tool] ??
          (tool === "click" ? cuaClickSuccessFixture : cuaSetValueSuccessFixture);
        duringTool[tool]?.(control);
        return {
          stdout: typeof output === "string" ? output : JSON.stringify(output),
          stderr: "",
        };
      }
      throw new Error(`Unexpected CuaDriver tool: ${tool}`);
    },
  };
  const dependencies = {
    async inspectApplicationInstance(instance) {
      applicationInspections.push({ ...instance });
      const isDaemon = instance.pid === control.daemonPid;
      return {
        executable: isDaemon ? control.daemonExecutable : control.targetExecutable,
        launchDateMicros: isDaemon
          ? control.daemonBirthSec * 1_000_000 + control.daemonBirthUsec
          : control.targetBirthSec * 1_000_000 + control.targetBirthUsec,
        pid: instance.pid,
      };
    },
    async terminateApplicationInstance(instance, { force }) {
      applicationTerminations.push({ force, instance: { ...instance } });
      const isDaemon = instance.pid === control.daemonPid;
      if (isDaemon) {
        if (control.daemonReplacementBeforeTermination) {
          control.daemonReplacementBeforeTermination = false;
          control.daemonBirthUsec += 1;
        }
        if (control.daemonKillFailures > 0) {
          control.daemonKillFailures -= 1;
          throw new Error("synthetic daemon application termination failure");
        }
        const expectedLaunchDateMicros =
          control.daemonBirthSec * 1_000_000 + control.daemonBirthUsec;
        if (
          instance.applicationExecutable !== control.daemonExecutable ||
          instance.applicationLaunchDateMicros !== expectedLaunchDateMicros
        ) {
          throw new Error("CuaDriver application instance changed before termination");
        }
        control.daemonRunning = false;
        control.daemonListenerPresent = false;
        control.socketPresent = false;
        return;
      }
      assert.equal(instance.pid, 4242);
      if (control.targetReplacementBeforeTermination) {
        control.targetReplacementBeforeTermination = false;
        control.targetBirthUsec += 1;
      }
      if (control.targetKillFailures > 0) {
        control.targetKillFailures -= 1;
        throw new Error("synthetic target application termination failure");
      }
      const expectedLaunchDateMicros =
        control.targetBirthSec * 1_000_000 + control.targetBirthUsec;
      if (
        instance.applicationExecutable !== control.targetExecutable ||
        instance.applicationLaunchDateMicros !== expectedLaunchDateMicros
      ) {
        throw new Error("CuaDriver application instance changed before termination");
      }
      assert.equal(force, true);
      control.targetRunning = false;
    },
    async lstat(filePath) {
      try {
        return await lstat(filePath);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      if (filePath === "/tmp/nixmac-cua-owned-fixture.sock" && control.socketPresent) {
        return {
          dev: control.socketDev,
          ino: control.socketIno,
          isDirectory: () => false,
          isFile: () => false,
          isSocket: () => true,
          isSymbolicLink: () => false,
          mode: 0o140600,
          size: 0,
        };
      }
      const error = new Error(`fixture path does not exist: ${filePath}`);
      error.code = "ENOENT";
      throw error;
    },
    async resolveExecutablePath(executablePath) {
      return executablePath;
    },
    async readExecutableIdentity(executablePath) {
      assert.equal(executablePath, "/opt/nixmac-e2e/bin/cua-driver");
      return {
        digestSha256: pinnedCuaDriverMetadata.cli.sha256,
        codeSigningDigestSha256: pinnedCuaDriverMetadata.cli.code_signing_digest_sha256,
        developerId: pinnedCuaDriverMetadata.cli.developer_id,
        teamIdentifier: pinnedCuaDriverMetadata.cli.team_identifier,
        ...cliIdentityOverrides,
      };
    },
    async readBundleIdentity(appPath) {
      identityReads.push(appPath);
      if (appPath === "/Applications/CuaDriver.app") {
        if (control.daemonRunning && control.daemonIdentityFailuresAfterLaunch > 0) {
          control.daemonIdentityFailuresAfterLaunch -= 1;
          throw new Error("synthetic post-launch daemon signature failure");
        }
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
      if (control.targetRunning && control.targetIdentityFailuresAfterLaunch > 0) {
        control.targetIdentityFailuresAfterLaunch -= 1;
        throw new Error("synthetic post-launch target signature failure");
      }
      return {
        bundleId: cuaTargetBundleId,
        shortVersion: "0.32.1",
        buildVersion: "0.32.1",
        digestSha256: cuaTargetDigest,
        ...targetIdentityOverrides,
      };
    },
    async canonicalPath(appPath) {
      if (
        appPath === control.daemonExecutable &&
        control.daemonRunning &&
        control.daemonCanonicalFailuresAfterLaunch > 0
      ) {
        control.daemonCanonicalFailuresAfterLaunch -= 1;
        throw new Error("synthetic post-launch daemon canonicalization failure");
      }
      if (
        appPath === control.targetExecutable &&
        control.targetRunning
      ) {
        control.targetCanonicalCount += 1;
        if (
          control.targetCanonicalCount > 3 &&
          control.targetCanonicalFailuresAfterLaunch > 0
        ) {
          control.targetCanonicalFailuresAfterLaunch -= 1;
          throw new Error("synthetic post-launch target canonicalization failure");
        }
      }
      return appPath;
    },
    async resolveBundleExecutablePath(appPath) {
      assert.equal(appPath, cuaTargetPath);
      return control.targetExecutable;
    },
    async listProcessInstances(executablePath) {
      events.push("dependency:listProcessInstances");
      listedProcessExecutables.push(executablePath);
      if (executablePath === control.targetExecutable) {
        if (!control.targetRunning) return [];
        return [
          {
            birthMarker: `${control.targetBirthSec}.${String(control.targetBirthUsec).padStart(
              6,
              "0",
            )}`,
            executable: control.targetExecutable,
            pid: 4242,
            startSec: control.targetBirthSec,
            startUsec: control.targetBirthUsec,
          },
        ];
      }
      if (!control.daemonRunning || executablePath !== control.daemonExecutable) return [];
      const instances = [
        {
          birthMarker: `${control.daemonBirthSec}.${String(control.daemonBirthUsec).padStart(6, "0")}`,
          executable: control.daemonExecutable,
          pid: control.daemonPid,
          startSec: control.daemonBirthSec,
          startUsec: control.daemonBirthUsec,
        },
      ];
      if (extraNewDaemonInstance) instances.push(extraNewDaemonInstance);
      return instances;
    },
    async queryProcessInstance(pid) {
      processInstanceQueries.push(pid);
      events.push(`dependency:queryProcessInstance:${pid}`);
      if (pid === control.daemonPid) {
        if (control.daemonRunning) {
          return {
            birthMarker: `${control.daemonBirthSec}.${String(control.daemonBirthUsec).padStart(6, "0")}`,
            executable: control.daemonExecutable,
            pid,
            startSec: control.daemonBirthSec,
            startUsec: control.daemonBirthUsec,
          };
        }
        if (control.daemonExitChecksRemaining > 0) {
          control.daemonExitChecksRemaining -= 1;
          return {
            birthMarker: `${control.daemonBirthSec}.${String(control.daemonBirthUsec).padStart(6, "0")}`,
            executable: control.daemonExecutable,
            pid,
            startSec: control.daemonBirthSec,
            startUsec: control.daemonBirthUsec,
          };
        }
        const error = new Error("fixture daemon pid no longer exists");
        error.code = "ESRCH";
        throw error;
      }
      if (pid === control.daemonListenerPid && control.daemonListenerPresent) {
        return {
          birthMarker: `${control.daemonListenerBirthSec}.${String(
            control.daemonListenerBirthUsec,
          ).padStart(6, "0")}`,
          executable: control.daemonListenerExecutable,
          pid,
          startSec: control.daemonListenerBirthSec,
          startUsec: control.daemonListenerBirthUsec,
        };
      }
      if (pid === 4242) {
        if (control.targetRunning) {
          control.targetQueryCount += 1;
          if (control.targetQueryCount > 2 && control.targetQueryFailuresAfterLaunch > 0) {
            control.targetQueryFailuresAfterLaunch -= 1;
            if (control.targetReplacementAfterQueryFailure) {
              control.targetBirthUsec += 1;
            }
            throw new Error("synthetic post-launch target process query failure");
          }
          return {
            birthMarker: `${control.targetBirthSec}.${String(control.targetBirthUsec).padStart(
              6,
              "0",
            )}`,
            executable: control.targetExecutable,
            pid,
            startSec: control.targetBirthSec,
            startUsec: control.targetBirthUsec,
          };
        }
        if (control.targetExitChecksRemaining > 0) {
          control.targetExitChecksRemaining -= 1;
          return {
            birthMarker: `${control.targetBirthSec}.${String(control.targetBirthUsec).padStart(
              6,
              "0",
            )}`,
            executable: control.targetExecutable,
            pid,
            startSec: control.targetBirthSec,
            startUsec: control.targetBirthUsec,
          };
        }
        if (control.postKillExecutable) {
          return {
            birthMarker: `${control.targetBirthSec}.${String(control.targetBirthUsec + 1).padStart(
              6,
              "0",
            )}`,
            executable: control.postKillExecutable,
            pid,
            startSec: control.targetBirthSec,
            startUsec: control.targetBirthUsec + 1,
          };
        }
        const error = new Error("fixture pid no longer exists");
        error.code = "ESRCH";
        throw error;
      }
      throw new Error(`Unexpected fixture process pid: ${pid}`);
    },
    async queryPidExecutable(pid) {
      pidQueries.push(pid);
      if (pid === control.daemonPid) {
        if (control.daemonRunning) return control.daemonExecutable;
        if (control.daemonExitChecksRemaining > 0) {
          control.daemonExitChecksRemaining -= 1;
          return control.daemonExecutable;
        }
        const error = new Error("fixture daemon pid no longer exists");
        error.code = "ESRCH";
        throw error;
      }
      if (pid === control.daemonListenerPid && control.daemonListenerPresent) {
        return control.daemonListenerExecutable;
      }
      if (pid === 4242) {
        if (control.targetRunning) return control.targetExecutable;
        if (control.targetExitChecksRemaining > 0) {
          control.targetExitChecksRemaining -= 1;
          return control.targetExecutable;
        }
        if (control.postKillExecutable) return control.postKillExecutable;
        const error = new Error("fixture pid no longer exists");
        error.code = "ESRCH";
        throw error;
      }
      throw new Error(`Unexpected fixture pid: ${pid}`);
    },
    async sleep(delayMs) {
      sleeps.push(delayMs);
    },
  };
  const driver = new CuaDriver({
    attachSocket,
    cliPath: "/opt/nixmac-e2e/bin/cua-driver",
    dependencies,
    driverAppPath: "/Applications/CuaDriver.app",
    processRunner: runner,
    runDir: cuaRuntimeFixtureDir,
    runId: attachSocket ? "attach-fixture" : "owned-fixture",
    socketDirectory: "/tmp",
    ...driverOptions,
  });
  return {
    applicationInspections,
    applicationTerminations,
    commandOptions,
    commands,
    control,
    driver,
    events,
    identityReads,
    listedProcessExecutables,
    pidQueries,
    processInstanceQueries,
    sleeps,
  };
}

const task5SampleOptions = {
  app: cuaTargetBundleId,
  runDir: cuaRuntimeFixtureDir,
};
const task5SampleDriver = new CuaDriver({
  binary: "/opt/nixmac-e2e/bin/cua-driver",
  socketPath: path.join(cuaRuntimeFixtureDir, "task5-owned.sock"),
  appBundleId: task5SampleOptions.app,
  runDir: task5SampleOptions.runDir,
  dependencies: {},
  processRunner: { async run() {} },
});
assert.equal(task5SampleDriver.cliPath, "/opt/nixmac-e2e/bin/cua-driver");
assert.equal(task5SampleDriver.socketPath, path.join(cuaRuntimeFixtureDir, "task5-owned.sock"));
assert.equal(task5SampleDriver.attachMode, false);
assert.equal(task5SampleDriver.configuredAppBundleId, cuaTargetBundleId);
assert.equal(task5SampleDriver.runDir, cuaRuntimeFixtureDir);
const task5GeneratedSocketDriver = new CuaDriver({
  binary: "/opt/nixmac-e2e/bin/cua-driver",
  socketPath: undefined,
  appBundleId: task5SampleOptions.app,
  runDir: task5SampleOptions.runDir,
  dependencies: {},
  processRunner: { async run() {} },
  runId: "task5-generated",
});
assert.equal(
  task5GeneratedSocketDriver.socketPath,
  path.join(os.tmpdir(), "nixmac-cua-task5-generated.sock"),
);
assert.equal(task5GeneratedSocketDriver.attachMode, false);
const longTask5RunDir = path.join(cuaRuntimeFixtureDir, "attempt-artifacts", "a".repeat(180));
const longRunDirDriver = new CuaDriver({
  binary: "/opt/nixmac-e2e/bin/cua-driver",
  appBundleId: task5SampleOptions.app,
  runDir: longTask5RunDir,
  dependencies: {},
  processRunner: { async run() {} },
  runId: "short-socket",
});
assert.equal(longRunDirDriver.runDir, longTask5RunDir);
assert.equal(longRunDirDriver.socketPath, path.join(os.tmpdir(), "nixmac-cua-short-socket.sock"));
assert.equal(
  longRunDirDriver.socketPath.length < 104,
  true,
  "long artifact run directories must not lengthen the default macOS Unix socket path",
);
assert.throws(
  () =>
    new CuaDriver({
      binary: "/opt/nixmac-e2e/bin/cua-driver",
      attachSocket: path.join(cuaRuntimeFixtureDir, "task5-attached.sock"),
      appBundleId: task5SampleOptions.app,
      runDir: task5SampleOptions.runDir,
      dependencies: {},
      processRunner: { async run() {} },
    }),
  /attach mode is disabled/,
  "unauthenticated upstream 0.12.6 sockets must never be adopted",
);
assert.throws(
  () => new CuaDriver({ unexpectedTask5Option: true }),
  /unknown CuaDriver option.*unexpectedTask5Option/,
);
assert.throws(
  () => new CuaDriver({ binary: "cua-driver", cliPath: "cua-driver" }),
  /binary conflicts with cliPath/,
);
assert.throws(
  () =>
    new CuaDriver({
      attachSocket: "/tmp/cua-attached.sock",
      socketPath: "/tmp/cua-owned.sock",
    }),
  /attachSocket conflicts with owned socketPath/,
);
assert.throws(
  () =>
    new CuaDriver({
      binary: "/opt/nixmac-e2e/bin/cua-driver",
      socketPath: `/tmp/${"é".repeat(50)}.sock`,
    }),
  /Unix socket path exceeds 103 UTF-8 bytes/,
  "macOS sun_path limits apply to UTF-8 bytes rather than JavaScript characters",
);
const separateScratchAndSocketDriver = new CuaDriver({
  runDir: "/tmp/attempt-artifacts",
  socketDirectory: "/tmp/cua-sockets",
  runId: "separate",
});
assert.equal(separateScratchAndSocketDriver.runDir, "/tmp/attempt-artifacts");
assert.equal(
  separateScratchAndSocketDriver.socketPath,
  "/tmp/cua-sockets/nixmac-cua-separate.sock",
);

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

const preexistingOwnedSocketHarness = createCuaHarness();
await writeFile(preexistingOwnedSocketHarness.driver.socketPath, "occupied", { mode: 0o600 });
await assert.rejects(
  () => preexistingOwnedSocketHarness.driver.connect(),
  /owned socket path already exists/,
  "owned mode must never adopt a preexisting socket",
);
assert.equal(
  preexistingOwnedSocketHarness.commands.some((entry) => entry.command === "/usr/bin/open"),
  false,
  "owned socket collision must fail before daemon launch",
);
await rm(preexistingOwnedSocketHarness.driver.socketPath, { force: true });

const ownedHarness = createCuaHarness();
await ownedHarness.driver.connect();
const daemonSnapshotEventIndex = ownedHarness.events.indexOf("dependency:listProcessInstances");
const daemonOpenEventIndex = ownedHarness.events.indexOf("run:open:-n");
const daemonInstanceEventIndex = ownedHarness.events.indexOf(
  "dependency:queryProcessInstance:31337",
);
const daemonStatusEventIndex = ownedHarness.events.indexOf("run:cua-driver:status");
assert.equal(
  daemonSnapshotEventIndex >= 0 &&
    daemonSnapshotEventIndex < daemonOpenEventIndex &&
    daemonOpenEventIndex < daemonInstanceEventIndex &&
    daemonInstanceEventIndex < daemonStatusEventIndex,
  true,
  "connect must capture exactly one new app-owned process instance before readiness probing",
);
assert.equal(ownedHarness.driver.daemonPeer.birthMarker, "1785000000.000101");
assert.deepEqual(ownedHarness.driver.daemonPeer.socketIdentity, {
  dev: 42,
  ino: 9001,
});
assert.deepEqual(
  ownedHarness.commands.find((entry) => entry.command === "/usr/sbin/lsof"),
  {
    command: "/usr/sbin/lsof",
    args: ["-nP", "-Fpcn", "-a", "-U", ownedHarness.driver.socketPath],
  },
  "connect must derive the exact Unix-socket owner from macOS",
);
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
      "/Applications/CuaDriver.app",
      "--args",
      "serve",
      "--socket",
      ownedHarness.driver.socketPath,
    ],
  },
);
const fakeVersionMatchingCliHarness = createCuaHarness({
  cliIdentityOverrides: { digestSha256: "0".repeat(64) },
});
await assert.rejects(
  () => fakeVersionMatchingCliHarness.driver.connect(),
  /CuaDriver CLI digestSha256 mismatch/,
  "a fake CLI that prints the pinned version must fail before it can execute",
);
assert.equal(
  fakeVersionMatchingCliHarness.commands.some(
    (entry) => entry.command === "/opt/nixmac-e2e/bin/cua-driver" && entry.args[0] === "--version",
  ),
  false,
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
assert.equal(
  ownedHarness.identityReads.filter((entry) => entry === "/Applications/CuaDriver.app").length,
  2,
  "connect must perform preflight and exact-process bind attestation without rehashing per RPC",
);

const fakeSelfAttestationHarness = createCuaHarness({
  daemonListenerExecutable: "/Applications/OtherDriver.app/Contents/MacOS/cua-driver",
  daemonListenerPid: 31338,
});
await assert.rejects(
  () => fakeSelfAttestationHarness.driver.connect(),
  /socket listener does not match the launched daemon instance/,
  "check_permissions self-attestation must not substitute for OS-derived peer identity",
);

const daemonReuseBeforeSocketBindingHarness = createCuaHarness({
  duringStatus(control) {
    control.daemonBirthUsec += 1;
  },
});
await assert.rejects(
  () => daemonReuseBeforeSocketBindingHarness.driver.connect(),
  (error) => {
    assert.equal(error instanceof AggregateError, true);
    assert.match(error.errors[0].message, /socket listener does not match the launched daemon/);
    assert.match(error.errors[1].message, /provisional daemon socket is contaminated/);
    return true;
  },
  "later lsof binding must match the provisional PID, birth time, and executable",
);
assert.equal(
  daemonReuseBeforeSocketBindingHarness.commands.some((entry) => entry.command === "/bin/kill"),
  false,
  "a reused provisional daemon PID must never be signaled",
);

const ambiguousSocketOwnerHarness = createCuaHarness({
  lsofOutput:
    "p31337\nccua-driver\nf9u\nn/tmp/nixmac-cua-owned-fixture.sock\n" +
    "p31338\nccua-driver\nf8u\nn/tmp/nixmac-cua-owned-fixture.sock\n",
});
await assert.rejects(
  () => ambiguousSocketOwnerHarness.driver.connect(),
  /exactly one CuaDriver listener PID/,
  "ambiguous Unix-socket ownership must fail closed",
);

const multipleNewDaemonHarness = createCuaHarness({
  extraNewDaemonInstance: {
    birthMarker: "1785000000.000102",
    executable: "/Applications/CuaDriver.app/Contents/MacOS/cua-driver",
    pid: 31339,
    startSec: 1_785_000_000,
    startUsec: 102,
  },
});
await assert.rejects(
  () => multipleNewDaemonHarness.driver.connect(),
  /multiple new daemon process instances/,
  "launch must fail closed rather than choosing among multiple new daemon process instances",
);
assert.equal(
  multipleNewDaemonHarness.commands.some(
    (entry) => entry.command === "/opt/nixmac-e2e/bin/cua-driver" && entry.args[0] === "status",
  ),
  false,
  "status must not run before exactly one daemon process instance is captured",
);
assert.equal(
  multipleNewDaemonHarness.commands.some((entry) => entry.command === "/bin/kill"),
  false,
  "ambiguous new daemon instances must be retained instead of guessing a cleanup PID",
);

const permissionFailureHarness = createCuaHarness({
  toolOutputs: {
    check_permissions: {
      accessibility: false,
      screen_recording: true,
      screen_recording_capturable: null,
      direct_capture_status: "not_checked",
      source: {
        attribution: "driver-daemon",
        bundle_id: "com.trycua.driver",
        disclaim_env: true,
        executable: "/Applications/CuaDriver.app/Contents/MacOS/cua-driver",
        note: "fixture daemon attribution",
        pid: 31337,
        responsible_ppid: 1,
      },
    },
  },
});
await assert.rejects(
  () => permissionFailureHarness.driver.connect(),
  /requires Accessibility and Screen Recording permissions/,
);
const permissionFailureLsofIndex = permissionFailureHarness.commands.findIndex(
  (entry) => entry.command === "/usr/sbin/lsof",
);
const permissionFailureCheckIndex = permissionFailureHarness.commands.findIndex(
  (entry) =>
    entry.command === "/opt/nixmac-e2e/bin/cua-driver" &&
    entry.args[0] === "call" &&
    entry.args[1] === "check_permissions",
);
assert.equal(
  permissionFailureLsofIndex >= 0 && permissionFailureLsofIndex < permissionFailureCheckIndex,
  true,
  "connect must bind the OS-derived daemon peer before trusting permission self-reporting",
);
assert.equal(
  permissionFailureHarness.commands.filter(
    (entry) => entry.command === "/opt/nixmac-e2e/bin/cua-driver" && entry.args[0] === "stop",
  ).length,
  1,
  "permission failure should clean the already-bound owned daemon",
);

const replacementListenerHarness = createCuaHarness();
await replacementListenerHarness.driver.connect();
replacementListenerHarness.control.daemonListenerPid = 31338;
replacementListenerHarness.control.daemonListenerExecutable =
  "/Applications/CuaDriver.app/Contents/MacOS/cua-driver";
await assert.rejects(
  () => replacementListenerHarness.driver.close(),
  /socket listener changed before stop/,
  "close must not stop a replacement listener",
);
assert.equal(
  replacementListenerHarness.commands.some(
    (entry) => entry.command === "/opt/nixmac-e2e/bin/cua-driver" && entry.args[0] === "stop",
  ),
  false,
);
assert.equal(replacementListenerHarness.driver.startedDaemon, true);
replacementListenerHarness.control.daemonListenerPresent = false;
replacementListenerHarness.control.daemonRunning = false;
replacementListenerHarness.control.socketPresent = false;
await replacementListenerHarness.driver.close();
assert.equal(replacementListenerHarness.driver.startedDaemon, false);

const missingLiveListenerHarness = createCuaHarness();
await missingLiveListenerHarness.driver.connect();
missingLiveListenerHarness.control.daemonListenerPresent = false;
await assert.rejects(
  () => missingLiveListenerHarness.driver.close(),
  /bound daemon pid is still alive without its socket listener/,
);
assert.equal(
  missingLiveListenerHarness.commands.some(
    (entry) => entry.command === "/opt/nixmac-e2e/bin/cua-driver" && entry.args[0] === "stop",
  ),
  false,
);
missingLiveListenerHarness.control.daemonRunning = false;
missingLiveListenerHarness.control.socketPresent = false;
await missingLiveListenerHarness.driver.close();

const lingeringDaemonHarness = createCuaHarness({
  daemonExitChecksAfterStop: 20,
  daemonListenerLingerChecksAfterStop: 20,
});
await lingeringDaemonHarness.driver.connect();
await assert.rejects(
  () => lingeringDaemonHarness.driver.close(),
  /bound daemon or socket did not terminate after 20 checks/,
);
assert.equal(lingeringDaemonHarness.driver.startedDaemon, true);
assert.equal(
  lingeringDaemonHarness.commands.filter(
    (entry) => entry.command === "/opt/nixmac-e2e/bin/cua-driver" && entry.args[0] === "stop",
  ).length,
  1,
);
await lingeringDaemonHarness.driver.close();
assert.equal(lingeringDaemonHarness.driver.startedDaemon, false);
assert.equal(
  lingeringDaemonHarness.commands.filter(
    (entry) => entry.command === "/opt/nixmac-e2e/bin/cua-driver" && entry.args[0] === "stop",
  ).length,
  1,
  "retry should recognize an already-absent bound daemon without another stop",
);

const confirmedDaemonExitHarness = createCuaHarness({
  daemonExitChecksAfterStop: 2,
});
await confirmedDaemonExitHarness.driver.connect();
await confirmedDaemonExitHarness.driver.close();
assert.equal(
  confirmedDaemonExitHarness.pidQueries.filter((pid) => pid === 31337).length,
  0,
  "daemon lifecycle must not fall back to path-only PID queries",
);
assert.equal(
  confirmedDaemonExitHarness.processInstanceQueries.filter((pid) => pid === 31337).length,
  10,
  "application binding and zero-exit stop must use exact process-instance checks",
);
assert.equal(confirmedDaemonExitHarness.driver.startedDaemon, false);

const alreadyCleanedDaemonHarness = createCuaHarness();
await alreadyCleanedDaemonHarness.driver.connect();
alreadyCleanedDaemonHarness.control.daemonListenerPresent = false;
alreadyCleanedDaemonHarness.control.daemonRunning = false;
alreadyCleanedDaemonHarness.control.socketPresent = false;
await alreadyCleanedDaemonHarness.driver.close();
assert.equal(
  alreadyCleanedDaemonHarness.commands.some(
    (entry) => entry.command === "/opt/nixmac-e2e/bin/cua-driver" && entry.args[0] === "stop",
  ),
  false,
  "an absent socket plus absent bound pid is already-cleaned evidence",
);

const lingeringOwnedSocketHarness = createCuaHarness({
  socketPathLingersAfterStop: true,
});
await lingeringOwnedSocketHarness.driver.connect();
await assert.rejects(
  () => lingeringOwnedSocketHarness.driver.close(),
  /stale owned socket requires controller quarantine/,
  "the adapter must retain a listener-free stale socket for controller quarantine",
);
assert.equal(lingeringOwnedSocketHarness.driver.startedDaemon, true);
lingeringOwnedSocketHarness.control.socketPresent = false;
await lingeringOwnedSocketHarness.driver.close();
assert.equal(lingeringOwnedSocketHarness.driver.startedDaemon, false);

const socketReplacementAtCleanupBoundaryHarness = createCuaHarness({
  replacementSocketAfterStop: true,
});
await socketReplacementAtCleanupBoundaryHarness.driver.connect();
await assert.rejects(
  () => socketReplacementAtCleanupBoundaryHarness.driver.close(),
  /replacement socket contamination after stop/,
  "same-UID replacement between proof and cleanup must remain untouched",
);
assert.equal(socketReplacementAtCleanupBoundaryHarness.driver.startedDaemon, true);
assert.equal(socketReplacementAtCleanupBoundaryHarness.control.socketPresent, true);
assert.equal(socketReplacementAtCleanupBoundaryHarness.control.socketIno, 9002);
socketReplacementAtCleanupBoundaryHarness.control.socketPresent = false;
await socketReplacementAtCleanupBoundaryHarness.driver.close();

const replacementAfterStopHarness = createCuaHarness({
  replacementListenerAfterStop: true,
});
await replacementAfterStopHarness.driver.connect();
await assert.rejects(
  () => replacementAfterStopHarness.driver.close(),
  /replacement listener contamination after stop/,
  "post-stop replacement listeners must remain retryable contamination",
);
assert.equal(replacementAfterStopHarness.driver.startedDaemon, true);
replacementAfterStopHarness.control.daemonListenerPresent = false;
replacementAfterStopHarness.control.socketPresent = false;
await replacementAfterStopHarness.driver.close();

const readinessFailureCleanupHarness = createCuaHarness({
  socketAppearsOnOpen: false,
  statusFailures: 2,
  driverOptions: { statusAttempts: 2 },
});
await assert.rejects(
  () => readinessFailureCleanupHarness.driver.connect(),
  /daemon did not become ready/,
);
assert.equal(
  readinessFailureCleanupHarness.applicationTerminations.length,
  1,
  "readiness failure must terminate the exact provisional daemon instance",
);
assert.equal(readinessFailureCleanupHarness.applicationTerminations[0].force, false);

const openFailureAfterLaunchHarness = createCuaHarness({
  openFailuresAfterLaunch: 1,
  socketAppearsOnOpen: false,
  driverOptions: { statusAttempts: 1 },
});
await assert.rejects(
  () => openFailureAfterLaunchHarness.driver.connect(),
  /synthetic open failure after launch acceptance/,
  "an open error must still reconcile the before/after daemon snapshots",
);
assert.equal(openFailureAfterLaunchHarness.control.daemonRunning, false);
assert.equal(openFailureAfterLaunchHarness.applicationTerminations.length, 1);
assert.equal(openFailureAfterLaunchHarness.applicationTerminations[0].force, false);
assert.equal(
  openFailureAfterLaunchHarness.commands.some((entry) => entry.command === "/bin/kill"),
  false,
  "reconciled open errors must not fall back to PID-only signaling",
);

const openFailureWithoutCandidateHarness = createCuaHarness({
  openCreatesDaemon: false,
  openFailuresAfterLaunch: 1,
  driverOptions: { statusAttempts: 1 },
});
await assert.rejects(
  () => openFailureWithoutCandidateHarness.driver.connect(),
  (error) => {
    assert.equal(error instanceof AggregateError, true);
    assert.equal(error.errors[0] instanceof AggregateError, true);
    assert.match(error.errors[0].message, /launch ownership is uncertain/);
    assert.match(error.errors[0].errors[0].message, /open failure after launch acceptance/);
    assert.match(error.errors[0].errors[1].message, /exactly one new daemon process instance/);
    assert.match(error.errors[1].message, /without a bound OS-derived peer/);
    return true;
  },
  "zero post-open candidates must preserve launch uncertainty and cleanup uncertainty",
);

const openFailureWithAmbiguousCandidatesHarness = createCuaHarness({
  openFailuresAfterLaunch: 1,
  extraNewDaemonInstance: {
    birthMarker: "1785000000.000102",
    executable: "/Applications/CuaDriver.app/Contents/MacOS/cua-driver",
    pid: 31339,
    startSec: 1_785_000_000,
    startUsec: 102,
  },
  driverOptions: { statusAttempts: 1 },
});
await assert.rejects(
  () => openFailureWithAmbiguousCandidatesHarness.driver.connect(),
  (error) => {
    assert.equal(error instanceof AggregateError, true);
    assert.equal(error.errors[0] instanceof AggregateError, true);
    assert.match(error.errors[0].message, /launch ownership is uncertain/);
    assert.match(error.errors[0].errors[1].message, /multiple new daemon process instances/);
    assert.match(error.errors[1].message, /without a bound OS-derived peer/);
    return true;
  },
  "ambiguous post-open candidates must be retained for controller quarantine",
);
assert.equal(openFailureWithAmbiguousCandidatesHarness.applicationTerminations.length, 0);

const daemonSwapBeforeTerminationHarness = createCuaHarness({
  daemonReplacementBeforeTermination: true,
  socketAppearsOnOpen: false,
  statusFailures: 1,
  driverOptions: { statusAttempts: 1 },
});
await assert.rejects(
  () => daemonSwapBeforeTerminationHarness.driver.connect(),
  /application instance changed before termination/,
  "atomic application-instance termination must reject a daemon PID swap after libproc proof",
);
assert.equal(daemonSwapBeforeTerminationHarness.control.daemonRunning, true);
assert.equal(daemonSwapBeforeTerminationHarness.applicationTerminations.length, 1);
daemonSwapBeforeTerminationHarness.control.daemonRunning = false;
await daemonSwapBeforeTerminationHarness.driver.close();

const daemonVerificationFailureHarness = createCuaHarness({
  daemonIdentityFailuresAfterLaunch: 1,
  driverOptions: { statusAttempts: 1 },
});
await assert.rejects(
  () => daemonVerificationFailureHarness.driver.connect(),
  /synthetic post-launch daemon signature failure/,
  "the unique daemon candidate must become provisionally owned before signature verification",
);
assert.equal(
  daemonVerificationFailureHarness.applicationTerminations.length,
  1,
  "post-launch daemon verification failure must clean the exact captured instance",
);

const daemonCanonicalizationFailureHarness = createCuaHarness({
  daemonCanonicalFailuresAfterLaunch: 2,
  driverOptions: { statusAttempts: 1 },
});
await assert.rejects(
  () => daemonCanonicalizationFailureHarness.driver.connect(),
  /synthetic post-launch daemon canonicalization failure/,
);
assert.equal(
  daemonCanonicalizationFailureHarness.applicationTerminations.length,
  0,
  "cleanup must decline signaling when canonicalization prevented application-instance binding",
);

const daemonVerificationAndCleanupFailureHarness = createCuaHarness({
  daemonIdentityFailuresAfterLaunch: 1,
  daemonKillFailures: 1,
  driverOptions: { statusAttempts: 1 },
});
await assert.rejects(
  () => daemonVerificationAndCleanupFailureHarness.driver.connect(),
  (error) => {
    assert.equal(error instanceof AggregateError, true);
    assert.match(error.message, /startup failed and exact daemon cleanup failed/);
    assert.match(error.errors[0].message, /post-launch daemon signature failure/);
    assert.match(error.errors[1].message, /synthetic daemon application termination failure/);
    return true;
  },
  "daemon verification and exact cleanup failures must both remain visible",
);

const readinessAndCleanupFailureHarness = createCuaHarness({
  daemonKillFailures: 1,
  socketAppearsOnOpen: false,
  statusFailures: 2,
  driverOptions: { statusAttempts: 2 },
});
await assert.rejects(
  () => readinessAndCleanupFailureHarness.driver.connect(),
  (error) => {
    assert.equal(error instanceof AggregateError, true);
    assert.match(error.message, /startup failed and exact daemon cleanup failed/);
    assert.match(error.errors[0].message, /daemon did not become ready/);
    assert.match(error.errors[1].message, /synthetic daemon application termination failure/);
    return true;
  },
);

const configuredBundleHarness = createCuaHarness({
  driverOptions: { appBundleId: cuaTargetBundleId },
});
await configuredBundleHarness.driver.connect();
await configuredBundleHarness.driver.prepareTarget({ appPath: cuaTargetPath });
await configuredBundleHarness.driver.close();

const conflictingBundleHarness = createCuaHarness({
  driverOptions: { appBundleId: cuaTargetBundleId },
});
await conflictingBundleHarness.driver.connect();
await assert.rejects(
  () =>
    conflictingBundleHarness.driver.prepareTarget({
      appBundleId: "com.darkmatter.other",
      appPath: cuaTargetPath,
    }),
  /appBundleId conflicts with configured/,
);
await conflictingBundleHarness.driver.close();

const wrongSignerHarness = createCuaHarness({
  driverIdentityOverrides: { teamIdentifier: "WRONGTEAM" },
});
await assert.rejects(() => wrongSignerHarness.driver.connect(), /teamIdentifier mismatch/);
assert.equal(
  wrongSignerHarness.commands.some((entry) => entry.command === "/usr/bin/open"),
  false,
  "the daemon must not launch when the installed app signing identity is wrong",
);

const delayedWindowHarness = createCuaHarness({ windowReadyAfter: 2 });
await delayedWindowHarness.driver.connect();
const delayedWindowTarget = await delayedWindowHarness.driver.prepareTarget({
  appBundleId: cuaTargetBundleId,
  appPath: cuaTargetPath,
});
assert.equal(delayedWindowTarget.windowId, 7002);
assert.equal(
  delayedWindowHarness.commands.filter(
    (entry) =>
      entry.command === "/opt/nixmac-e2e/bin/cua-driver" &&
      entry.args[0] === "call" &&
      entry.args[1] === "list_windows",
  ).length,
  3,
  "prepareTarget should poll until the launched app exposes an eligible window",
);
assert.deepEqual(delayedWindowHarness.sleeps, [250, 250]);
await delayedWindowHarness.driver.close();

const confirmedExitHarness = createCuaHarness({ targetExitChecksAfterKill: 2 });
await confirmedExitHarness.driver.connect();
await confirmedExitHarness.driver.prepareTarget({
  appBundleId: cuaTargetBundleId,
  appPath: cuaTargetPath,
});
await confirmedExitHarness.driver.close();
assert.equal(
  confirmedExitHarness.pidQueries.filter((pid) => pid === 4242).length,
  0,
  "target lifecycle must not fall back to path-only PID queries",
);
assert.equal(
  confirmedExitHarness.processInstanceQueries.filter((pid) => pid === 4242).length,
  8,
  "application binding, validation, readiness, and exit polling must use high-resolution process-instance proof",
);
assert.equal(
  confirmedExitHarness.listedProcessExecutables.filter(
    (executable) => executable === `${cuaTargetPath}/Contents/MacOS/nixmac`,
  ).length,
  2,
  "target launch must be bracketed by exact-executable process snapshots",
);
assert.deepEqual(
  confirmedExitHarness.sleeps,
  [250, 250],
  "target exit polling should use the bounded readiness interval",
);

const postLaunchFailureHarness = createCuaHarness({
  toolOutputs: { list_windows: { windows: [] } },
});
await postLaunchFailureHarness.driver.connect();
await assert.rejects(
  () =>
    postLaunchFailureHarness.driver.prepareTarget({
      appBundleId: cuaTargetBundleId,
      appPath: cuaTargetPath,
    }),
  /target did not become ready/,
);
assert.equal(
  postLaunchFailureHarness.applicationTerminations.length,
  1,
  "a target owned from launch response must be cleaned after later prepare failure",
);
assert.equal(postLaunchFailureHarness.control.targetRunning, false);
await postLaunchFailureHarness.driver.close();

for (const [name, options, expectedError] of [
  [
    "process query",
    { targetQueryFailuresAfterLaunch: 1 },
    /synthetic post-launch target process query failure/,
  ],
  [
    "canonicalization",
    { targetCanonicalFailuresAfterLaunch: 1 },
    /synthetic post-launch target canonicalization failure/,
  ],
  [
    "signature",
    { targetIdentityFailuresAfterLaunch: 1 },
    /synthetic post-launch target signature failure/,
  ],
]) {
  const orphanBoundaryHarness = createCuaHarness(options);
  await orphanBoundaryHarness.driver.connect();
  await assert.rejects(
    () =>
      orphanBoundaryHarness.driver.prepareTarget({
        appBundleId: cuaTargetBundleId,
        appPath: cuaTargetPath,
      }),
    expectedError,
    `${name} failure after launch must remain inside the owned-target cleanup boundary`,
  );
  assert.equal(
    orphanBoundaryHarness.applicationTerminations.length,
    1,
    `${name} failure must clean the uniquely launched target instance`,
  );
  assert.equal(orphanBoundaryHarness.control.targetRunning, false);
  await orphanBoundaryHarness.driver.close();
}

const targetReplacementDuringValidationHarness = createCuaHarness({
  targetQueryFailuresAfterLaunch: 1,
  targetReplacementAfterQueryFailure: true,
});
await targetReplacementDuringValidationHarness.driver.connect();
await assert.rejects(
  () =>
    targetReplacementDuringValidationHarness.driver.prepareTarget({
      appBundleId: cuaTargetBundleId,
      appPath: cuaTargetPath,
    }),
  /synthetic post-launch target process query failure/,
);
assert.equal(
  targetReplacementDuringValidationHarness.applicationTerminations.length,
  0,
  "cleanup must never kill a replacement that reused the provisionally owned target PID",
);
targetReplacementDuringValidationHarness.control.targetRunning = false;
await targetReplacementDuringValidationHarness.driver.close();

const launchRpcOrphanBoundaryHarness = createCuaHarness({
  launchAppRpcFailures: 1,
});
await launchRpcOrphanBoundaryHarness.driver.connect();
await assert.rejects(
  () =>
    launchRpcOrphanBoundaryHarness.driver.prepareTarget({
      appBundleId: cuaTargetBundleId,
      appPath: cuaTargetPath,
    }),
  /synthetic launch_app transport failure after process creation/,
  "a launch RPC error must still poll for and own a uniquely created target",
);
assert.equal(
  launchRpcOrphanBoundaryHarness.applicationTerminations.length,
  1,
);
assert.equal(launchRpcOrphanBoundaryHarness.control.targetRunning, false);
await launchRpcOrphanBoundaryHarness.driver.close();

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
assert.equal(
  ownedHarness.identityReads.filter((entry) => entry === cuaTargetPath).length,
  2,
  "prepareTarget should hash before launch and at exact-process bind, then cache the attestation",
);
assert.equal(
  ownedHarness.processInstanceQueries.includes(4242),
  true,
  "prepareTarget must capture an OS-derived high-resolution process instance immediately after launch",
);
assert.equal(ownedHarness.driver.ownedTarget.birthMarker, "1785000100.000202");

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
assert.equal(
  ownedHarness.identityReads.filter((entry) => entry === "/Applications/CuaDriver.app").length,
  2,
  "successful UI polling must use the exact-process attestation cache",
);
assert.equal(
  ownedHarness.identityReads.filter((entry) => entry === cuaTargetPath).length,
  2,
  "successful UI polling must not rehash the target bundle",
);
const getWindowStateCalls = ownedHarness.commands.filter(
  (entry) =>
    entry.command === "/opt/nixmac-e2e/bin/cua-driver" &&
    entry.args[0] === "call" &&
    entry.args[1] === "get_window_state",
);
assert.equal(getWindowStateCalls.length, 2);
for (const entry of getWindowStateCalls) {
  assert.deepEqual(entry.args, [
    "call",
    "get_window_state",
    JSON.stringify({ pid: 4242, window_id: 7002 }),
    "--socket",
    ownedHarness.driver.socketPath,
  ]);
  assert.equal(entry.args.includes("--raw"), false);
  assert.equal(entry.args.includes("--compact"), false);
  assert.equal(entry.args.includes("--no-daemon"), false);
  assert.equal(entry.args.includes("--screenshot-out-file"), false);
}
const inlineScreenshotOutputLimit = 4 * Math.ceil((25 * 1_048_576) / 3) + 1_048_576;
for (const entry of ownedHarness.commandOptions.filter(
  (candidate) =>
    candidate.command === "/opt/nixmac-e2e/bin/cua-driver" &&
    candidate.args[0] === "call" &&
    candidate.args[1] === "get_window_state",
)) {
  assert.equal(
    entry.options.maxOutputBytes,
    inlineScreenshotOutputLimit,
    "inline screenshot stdout must have an encoded image cap plus bounded JSON overhead",
  );
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
    text: "",
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
    text: cuaSetValueSuccessFixture,
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
assert.equal(
  ownedHarness.identityReads.filter((entry) => entry === "/Applications/CuaDriver.app").length,
  3,
  "clean daemon teardown must refresh the full bundle attestation",
);
assert.equal(
  ownedHarness.identityReads.filter((entry) => entry === cuaTargetPath).length,
  3,
  "clean target teardown must refresh the full bundle attestation",
);
assert.equal(
  ownedHarness.applicationTerminations.length,
  1,
  "close must terminate the exact target process owned by prepareTarget",
);
assert.equal(ownedHarness.control.targetRunning, false);
const ownedStopIndex = ownedHarness.commands.findIndex(
  (entry) => entry.command === "/opt/nixmac-e2e/bin/cua-driver" && entry.args[0] === "stop",
);
assert.deepEqual(ownedHarness.commands[ownedStopIndex], {
  command: "/opt/nixmac-e2e/bin/cua-driver",
  args: ["stop", "--socket", ownedHarness.driver.socketPath],
});
assert.equal(
  ownedHarness.commands
    .slice(ownedStopIndex + 1)
    .some((entry) => entry.command === "/usr/sbin/lsof"),
  true,
  "close must re-check the socket after a zero-exit stop",
);

const sameAppReusedPidHarness = createCuaHarness();
await sameAppReusedPidHarness.driver.connect();
await sameAppReusedPidHarness.driver.prepareTarget({
  appBundleId: cuaTargetBundleId,
  appPath: cuaTargetPath,
});
sameAppReusedPidHarness.control.targetBirthUsec += 1;
await sameAppReusedPidHarness.driver.close();
assert.equal(
  sameAppReusedPidHarness.applicationTerminations.length,
  0,
  "cleanup must never kill a same-app process that reused the owned pid",
);

const targetSwapBeforeTerminationHarness = createCuaHarness({
  targetReplacementBeforeTermination: true,
});
await targetSwapBeforeTerminationHarness.driver.connect();
await targetSwapBeforeTerminationHarness.driver.prepareTarget({
  appBundleId: cuaTargetBundleId,
  appPath: cuaTargetPath,
});
await assert.rejects(
  () => targetSwapBeforeTerminationHarness.driver.close(),
  /application instance changed before termination/,
  "atomic application-instance termination must reject a target PID swap after libproc proof",
);
assert.equal(targetSwapBeforeTerminationHarness.control.targetRunning, true);
assert.equal(targetSwapBeforeTerminationHarness.applicationTerminations.length, 1);
await targetSwapBeforeTerminationHarness.driver.close();
assert.equal(
  targetSwapBeforeTerminationHarness.applicationTerminations.length,
  1,
  "a retry must recognize the replacement and decline another termination request",
);

const daemonMutationOverrides = {};
const daemonMutationAtTeardownHarness = createCuaHarness({
  driverIdentityOverrides: daemonMutationOverrides,
});
await daemonMutationAtTeardownHarness.driver.connect();
daemonMutationOverrides.digestSha256 = "0".repeat(64);
await assert.rejects(
  () => daemonMutationAtTeardownHarness.driver.close(),
  /CuaDriver\.app digestSha256 mismatch/,
  "clean daemon teardown must detect bundle mutation before stop",
);
assert.equal(
  daemonMutationAtTeardownHarness.commands.some(
    (entry) => entry.command === "/opt/nixmac-e2e/bin/cua-driver" && entry.args[0] === "stop",
  ),
  false,
);
delete daemonMutationOverrides.digestSha256;
await daemonMutationAtTeardownHarness.driver.close();

const targetMutationOverrides = {};
const targetMutationAtTeardownHarness = createCuaHarness({
  targetIdentityOverrides: targetMutationOverrides,
});
await targetMutationAtTeardownHarness.driver.connect();
await targetMutationAtTeardownHarness.driver.prepareTarget({
  appBundleId: cuaTargetBundleId,
  appPath: cuaTargetPath,
});
targetMutationOverrides.digestSha256 = "0".repeat(64);
await assert.rejects(
  () => targetMutationAtTeardownHarness.driver.close(),
  /owned target identity changed/,
  "clean target teardown must detect bundle mutation before termination",
);
assert.equal(targetMutationAtTeardownHarness.applicationTerminations.length, 0);
delete targetMutationOverrides.digestSha256;
await targetMutationAtTeardownHarness.driver.close();
assert.equal(targetMutationAtTeardownHarness.applicationTerminations.length, 1);

const targetMutationOnFailureOverrides = {};
const targetMutationOnFailureHarness = createCuaHarness({
  targetIdentityOverrides: targetMutationOnFailureOverrides,
  duringTool: {
    click() {
      targetMutationOnFailureOverrides.digestSha256 = "0".repeat(64);
      throw new Error("synthetic click transport failure");
    },
  },
});
await targetMutationOnFailureHarness.driver.connect();
await targetMutationOnFailureHarness.driver.prepareTarget({
  appBundleId: cuaTargetBundleId,
  appPath: cuaTargetPath,
});
const targetMutationOnFailureState = await targetMutationOnFailureHarness.driver.visibleState({
  app: cuaTargetBundleId,
});
const targetIdentityReadsBeforeFailure = targetMutationOnFailureHarness.identityReads.filter(
  (entry) => entry === cuaTargetPath,
).length;
const targetMutationFailureResult = await targetMutationOnFailureHarness.driver.click({
  app: cuaTargetBundleId,
  elementAddress: {
    kind: "cua-element-index",
    elementIndex: 7,
    ...targetMutationOnFailureState.target,
  },
});
assert.equal(targetMutationFailureResult.ok, false);
assert.match(targetMutationFailureResult.text, /target failure attestation failed/);
assert.equal(
  targetMutationOnFailureHarness.identityReads.filter((entry) => entry === cuaTargetPath).length,
  targetIdentityReadsBeforeFailure + 1,
  "an RPC failure must refresh target bundle evidence for diagnosis",
);
delete targetMutationOnFailureOverrides.digestSha256;
await targetMutationOnFailureHarness.driver.close();

const targetKillRetryHarness = createCuaHarness({ targetKillFailures: 1 });
await targetKillRetryHarness.driver.connect();
await targetKillRetryHarness.driver.prepareTarget({
  appBundleId: cuaTargetBundleId,
  appPath: cuaTargetPath,
});
await assert.rejects(
  () => targetKillRetryHarness.driver.close(),
  /synthetic target application termination failure/,
);
assert.equal(
  targetKillRetryHarness.applicationTerminations.length,
  1,
);
assert.equal(
  targetKillRetryHarness.commands.filter(
    (entry) => entry.command === "/opt/nixmac-e2e/bin/cua-driver" && entry.args[0] === "stop",
  ).length,
  1,
  "daemon cleanup must proceed independently when target cleanup fails",
);
await targetKillRetryHarness.driver.close();
assert.equal(
  targetKillRetryHarness.applicationTerminations.length,
  2,
  "failed target cleanup must retain ownership for a second close retry",
);
assert.equal(
  targetKillRetryHarness.commands.filter(
    (entry) => entry.command === "/opt/nixmac-e2e/bin/cua-driver" && entry.args[0] === "stop",
  ).length,
  1,
  "confirmed daemon cleanup must not be repeated",
);

const targetExitTimeoutHarness = createCuaHarness({
  targetExitChecksAfterKill: 3,
  driverOptions: { targetExitAttempts: 2 },
});
await targetExitTimeoutHarness.driver.connect();
await targetExitTimeoutHarness.driver.prepareTarget({
  appBundleId: cuaTargetBundleId,
  appPath: cuaTargetPath,
});
await assert.rejects(
  () => targetExitTimeoutHarness.driver.close(),
  /owned target pid 4242 did not exit after 2 checks/,
);
targetExitTimeoutHarness.control.targetExitChecksRemaining = 0;
await targetExitTimeoutHarness.driver.close();
assert.equal(
  targetExitTimeoutHarness.applicationTerminations.length,
  1,
  "a retry should clear retained ownership once the exact pid is confirmed absent",
);

const daemonStopRetryHarness = createCuaHarness({ daemonStopFailures: 1 });
await daemonStopRetryHarness.driver.connect();
await assert.rejects(() => daemonStopRetryHarness.driver.close(), /synthetic daemon stop failure/);
await daemonStopRetryHarness.driver.close();
assert.equal(
  daemonStopRetryHarness.commands.filter(
    (entry) => entry.command === "/opt/nixmac-e2e/bin/cua-driver" && entry.args[0] === "stop",
  ).length,
  2,
  "failed owned-daemon cleanup must remain retryable",
);

const mismatchedPermissionSourceHarness = createCuaHarness({
  permissionSourceExecutable: "/Applications/OtherDriver.app/Contents/MacOS/cua-driver",
});
await assert.rejects(
  () => mismatchedPermissionSourceHarness.driver.connect(),
  /permissions source executable does not match the OS-derived socket owner/,
);
assert.equal(
  mismatchedPermissionSourceHarness.commands.some((entry) => entry.args[0] === "stop"),
  true,
  "a mismatched permission source must clean the exact adapter-owned daemon",
);

const malformedPermissionsHarness = createCuaHarness({
  toolOutputs: { check_permissions: {} },
});
await assert.rejects(
  () => malformedPermissionsHarness.driver.connect(),
  /malformed CuaDriver check_permissions structured output/,
);

const extendedPermissionsHarness = createCuaHarness({
  toolStructuredMutators: {
    check_permissions(output) {
      output.unexpected_top_level = true;
      output.source.unexpected_nested = true;
    },
  },
});
await assert.rejects(
  () => extendedPermissionsHarness.driver.connect(),
  /malformed CuaDriver check_permissions structured output/,
  "check_permissions must reject unknown top-level and nested source keys",
);

const malformedListAppsHarness = createCuaHarness({
  toolOutputs: { list_apps: {} },
});
await malformedListAppsHarness.driver.connect();
await assert.rejects(
  () =>
    malformedListAppsHarness.driver.prepareTarget({
      appBundleId: cuaTargetBundleId,
      appPath: cuaTargetPath,
    }),
  /malformed CuaDriver list_apps structured output/,
);
await malformedListAppsHarness.driver.close();

const extendedListAppsHarness = createCuaHarness({
  toolStructuredMutators: {
    list_apps(output) {
      output.unexpected_top_level = true;
      output.apps[0].unexpected_nested = true;
    },
  },
});
await extendedListAppsHarness.driver.connect();
await assert.rejects(
  () =>
    extendedListAppsHarness.driver.prepareTarget({
      appBundleId: cuaTargetBundleId,
      appPath: cuaTargetPath,
    }),
  /malformed CuaDriver list_apps structured output/,
  "list_apps must reject unknown top-level and nested app keys",
);
await extendedListAppsHarness.driver.close();

const malformedLaunchHarness = createCuaHarness({
  toolOutputs: { launch_app: {} },
});
await malformedLaunchHarness.driver.connect();
await assert.rejects(
  () =>
    malformedLaunchHarness.driver.prepareTarget({
      appBundleId: cuaTargetBundleId,
      appPath: cuaTargetPath,
    }),
  /malformed CuaDriver launch_app structured output/,
);
await malformedLaunchHarness.driver.close();

const extendedLaunchHarness = createCuaHarness({
  toolStructuredMutators: {
    launch_app(output) {
      output.unexpected_top_level = true;
      output.windows.push({
        app_name: "Nixmac E2E",
        bounds: { height: 720, unexpected_nested: true, width: 960, x: 80, y: 120 },
        is_on_screen: true,
        pid: 4242,
        title: "Nixmac E2E",
        window_id: 7002,
      });
    },
  },
});
await extendedLaunchHarness.driver.connect();
await assert.rejects(
  () =>
    extendedLaunchHarness.driver.prepareTarget({
      appBundleId: cuaTargetBundleId,
      appPath: cuaTargetPath,
    }),
  /malformed CuaDriver launch_app structured output/,
  "launch_app must reject unknown top-level and nested window keys",
);
await extendedLaunchHarness.driver.close();

const malformedWindowsHarness = createCuaHarness({
  toolOutputs: { list_windows: { windows: [{}] } },
});
await malformedWindowsHarness.driver.connect();
await assert.rejects(
  () =>
    malformedWindowsHarness.driver.prepareTarget({
      appBundleId: cuaTargetBundleId,
      appPath: cuaTargetPath,
    }),
  /malformed CuaDriver list_windows structured output/,
);
await malformedWindowsHarness.driver.close();

const extendedWindowsHarness = createCuaHarness({
  toolStructuredMutators: {
    list_windows(output) {
      output.unexpected_top_level = true;
      output.windows[0].bounds.unexpected_nested = true;
    },
  },
});
await extendedWindowsHarness.driver.connect();
await assert.rejects(
  () =>
    extendedWindowsHarness.driver.prepareTarget({
      appBundleId: cuaTargetBundleId,
      appPath: cuaTargetPath,
    }),
  /malformed CuaDriver list_windows structured output/,
  "list_windows must reject unknown top-level and nested window keys",
);
await extendedWindowsHarness.driver.close();

const malformedWindowStateHarness = createCuaHarness({
  toolOutputs: {
    get_window_state: {
      elements: [],
      pid: 4242,
      window_id: 7002,
    },
  },
});
await malformedWindowStateHarness.driver.connect();
await malformedWindowStateHarness.driver.prepareTarget({
  appBundleId: cuaTargetBundleId,
  appPath: cuaTargetPath,
});
await assert.rejects(
  () => malformedWindowStateHarness.driver.visibleState({ app: cuaTargetBundleId }),
  /malformed CuaDriver get_window_state structured output/,
);
await malformedWindowStateHarness.driver.close();

const extendedWindowStateHarness = createCuaHarness({
  toolStructuredMutators: {
    get_window_state(output) {
      output.unexpected_top_level = true;
      output.elements[0].frame.unexpected_nested = true;
    },
  },
});
await extendedWindowStateHarness.driver.connect();
await extendedWindowStateHarness.driver.prepareTarget({
  appBundleId: cuaTargetBundleId,
  appPath: cuaTargetPath,
});
await assert.rejects(
  () => extendedWindowStateHarness.driver.visibleState({ app: cuaTargetBundleId }),
  /malformed CuaDriver get_window_state structured output/,
  "get_window_state must reject unknown top-level and nested element keys",
);
await extendedWindowStateHarness.driver.close();

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

const targetSwapDuringStateHarness = createCuaHarness({
  duringTool: {
    get_window_state(control) {
      control.targetBirthUsec += 1;
    },
  },
});
await targetSwapDuringStateHarness.driver.connect();
await targetSwapDuringStateHarness.driver.prepareTarget({
  appBundleId: cuaTargetBundleId,
  appPath: cuaTargetPath,
});
await assert.rejects(
  () => targetSwapDuringStateHarness.driver.visibleState({ app: cuaTargetBundleId }),
  /target process instance changed/,
  "state returned across a same-app process-instance swap must be discarded",
);
assert.equal(targetSwapDuringStateHarness.driver.latestSnapshot, null);
targetSwapDuringStateHarness.control.targetRunning = false;
await targetSwapDuringStateHarness.driver.close();

const targetSwapBeforeClickHarness = createCuaHarness();
await targetSwapBeforeClickHarness.driver.connect();
await targetSwapBeforeClickHarness.driver.prepareTarget({
  appBundleId: cuaTargetBundleId,
  appPath: cuaTargetPath,
});
const targetSwapBeforeClickState = await targetSwapBeforeClickHarness.driver.visibleState({
  app: cuaTargetBundleId,
});
targetSwapBeforeClickHarness.control.targetBirthUsec += 1;
const clickCommandCountBeforeTargetSwap = targetSwapBeforeClickHarness.commands.filter(
  (entry) => entry.args[0] === "call" && entry.args[1] === "click",
).length;
assert.equal(
  (
    await targetSwapBeforeClickHarness.driver.click({
      app: cuaTargetBundleId,
      elementAddress: {
        kind: "cua-element-index",
        elementIndex: 7,
        ...targetSwapBeforeClickState.target,
      },
    })
  ).ok,
  false,
);
assert.equal(
  targetSwapBeforeClickHarness.commands.filter(
    (entry) => entry.args[0] === "call" && entry.args[1] === "click",
  ).length,
  clickCommandCountBeforeTargetSwap,
  "a reused target PID must receive no click RPC",
);
targetSwapBeforeClickHarness.control.targetRunning = false;
await targetSwapBeforeClickHarness.driver.close();

const targetSwapDuringSetValueHarness = createCuaHarness({
  duringTool: {
    set_value(control) {
      control.targetBirthUsec += 1;
    },
  },
});
await targetSwapDuringSetValueHarness.driver.connect();
await targetSwapDuringSetValueHarness.driver.prepareTarget({
  appBundleId: cuaTargetBundleId,
  appPath: cuaTargetPath,
});
const targetSwapDuringSetValueState = await targetSwapDuringSetValueHarness.driver.visibleState({
  app: cuaTargetBundleId,
});
assert.equal(
  (
    await targetSwapDuringSetValueHarness.driver.setValue({
      app: cuaTargetBundleId,
      elementAddress: {
        kind: "cua-element-index",
        elementIndex: 8,
        ...targetSwapDuringSetValueState.target,
      },
      value: "must not be evidence",
    })
  ).ok,
  false,
  "setValue output must be discarded when the target instance changes in flight",
);
targetSwapDuringSetValueHarness.control.targetRunning = false;
await targetSwapDuringSetValueHarness.driver.close();

const listenerSwapDuringRpcHarness = createCuaHarness({
  duringTool: {
    get_window_state(control) {
      control.daemonListenerPid = 31338;
      control.daemonListenerBirthUsec += 1;
    },
  },
});
await listenerSwapDuringRpcHarness.driver.connect();
await listenerSwapDuringRpcHarness.driver.prepareTarget({
  appBundleId: cuaTargetBundleId,
  appPath: cuaTargetPath,
});
await assert.rejects(
  () => listenerSwapDuringRpcHarness.driver.visibleState({ app: cuaTargetBundleId }),
  /daemon listener process instance changed during RPC/,
  "a listener swap during an unauthenticated upstream RPC must discard its output",
);
assert.equal(listenerSwapDuringRpcHarness.driver.latestSnapshot, null);
listenerSwapDuringRpcHarness.control.targetRunning = false;
listenerSwapDuringRpcHarness.control.daemonListenerPresent = false;
listenerSwapDuringRpcHarness.control.daemonRunning = false;
listenerSwapDuringRpcHarness.control.socketPresent = false;
await listenerSwapDuringRpcHarness.driver.close();

const socketRebindDuringRpcHarness = createCuaHarness({
  duringTool: {
    get_window_state(control) {
      control.socketIno += 1;
      control.daemonListenerPid = 31338;
      control.daemonListenerBirthUsec += 1;
    },
  },
});
await socketRebindDuringRpcHarness.driver.connect();
await socketRebindDuringRpcHarness.driver.prepareTarget({
  appBundleId: cuaTargetBundleId,
  appPath: cuaTargetPath,
});
await assert.rejects(
  () => socketRebindDuringRpcHarness.driver.visibleState({ app: cuaTargetBundleId }),
  /daemon socket object changed during RPC/,
  "an in-flight unlink/rebind fake daemon must not mint screenshot evidence",
);
assert.equal(socketRebindDuringRpcHarness.driver.latestSnapshot, null);
socketRebindDuringRpcHarness.control.targetRunning = false;
socketRebindDuringRpcHarness.control.daemonListenerPresent = false;
socketRebindDuringRpcHarness.control.daemonRunning = false;
socketRebindDuringRpcHarness.control.socketPresent = false;
await socketRebindDuringRpcHarness.driver.close();

const sameUidFilesystemForgeryState = structuredClone(cuaWindowStateFixture);
delete sameUidFilesystemForgeryState.screenshot_png_b64;
sameUidFilesystemForgeryState.screenshot_file_path = "/tmp/same-uid-forged-screenshot.png";
const sameUidFilesystemForgeryHarness = createCuaHarness({
  toolOutputs: { get_window_state: sameUidFilesystemForgeryState },
});
await sameUidFilesystemForgeryHarness.driver.connect();
await sameUidFilesystemForgeryHarness.driver.prepareTarget({
  appBundleId: cuaTargetBundleId,
  appPath: cuaTargetPath,
});
await assert.rejects(
  () => sameUidFilesystemForgeryHarness.driver.visibleState({ app: cuaTargetBundleId }),
  /malformed CuaDriver get_window_state structured output/,
  "a same-UID filesystem path must not substitute for inline screenshot bytes",
);
await sameUidFilesystemForgeryHarness.driver.close();

const wrongScreenshotMimeHarness = createCuaHarness({
  toolOutputs: {
    get_window_state: {
      ...cuaWindowStateFixture,
      screenshot_mime_type: "image/jpeg",
    },
  },
});
await wrongScreenshotMimeHarness.driver.connect();
await wrongScreenshotMimeHarness.driver.prepareTarget({
  appBundleId: cuaTargetBundleId,
  appPath: cuaTargetPath,
});
await assert.rejects(
  () => wrongScreenshotMimeHarness.driver.visibleState({ app: cuaTargetBundleId }),
  /screenshot_mime_type must be image\/png/,
);
await wrongScreenshotMimeHarness.driver.close();

const nonCanonicalBase64Harness = createCuaHarness({
  toolOutputs: {
    get_window_state: {
      ...cuaWindowStateFixture,
      screenshot_png_b64: `${cuaWindowStateFixture.screenshot_png_b64}\n`,
    },
  },
});
await nonCanonicalBase64Harness.driver.connect();
await nonCanonicalBase64Harness.driver.prepareTarget({
  appBundleId: cuaTargetBundleId,
  appPath: cuaTargetPath,
});
await assert.rejects(
  () => nonCanonicalBase64Harness.driver.visibleState({ app: cuaTargetBundleId }),
  /canonical base64/,
);
await nonCanonicalBase64Harness.driver.close();

const decodedImageCapHarness = createCuaHarness({
  driverOptions: { maxImageBytes: 70 },
  screenshotBytes: Buffer.alloc(71),
});
await decodedImageCapHarness.driver.connect();
await decodedImageCapHarness.driver.prepareTarget({
  appBundleId: cuaTargetBundleId,
  appPath: cuaTargetPath,
});
await assert.rejects(
  () => decodedImageCapHarness.driver.visibleState({ app: cuaTargetBundleId }),
  /decoded screenshot exceeds/,
);
await decodedImageCapHarness.driver.close();

const headerOnlyPngHarness = createCuaHarness({
  screenshotBytes: Buffer.from("89504e470d0a1a0a", "hex"),
});
await headerOnlyPngHarness.driver.connect();
await headerOnlyPngHarness.driver.prepareTarget({
  appBundleId: cuaTargetBundleId,
  appPath: cuaTargetPath,
});
await assert.rejects(
  () => headerOnlyPngHarness.driver.visibleState({ app: cuaTargetBundleId }),
  /valid PNG/,
  "a PNG signature without complete chunks is not screenshot evidence",
);
await headerOnlyPngHarness.driver.close();

const corruptIdatPng = Buffer.from(cuaScreenshotBytes);
corruptIdatPng[44] ^= 0xff;
const corruptIdatHarness = createCuaHarness({ screenshotBytes: corruptIdatPng });
await corruptIdatHarness.driver.connect();
await corruptIdatHarness.driver.prepareTarget({
  appBundleId: cuaTargetBundleId,
  appPath: cuaTargetPath,
});
await assert.rejects(
  () => corruptIdatHarness.driver.visibleState({ app: cuaTargetBundleId }),
  /valid PNG/,
  "corrupt IDAT payloads must not become screenshot evidence",
);
await corruptIdatHarness.driver.close();

assert.equal(cuaDriverDescriptor.id, "cua-driver");
assert.equal(
  validateDriverDescriptor(cuaDriverDescriptor, {
    additionalAddressValidators: {
      "cua-element-index": validateCuaElementIndexAddress,
    },
  }).ok,
  true,
);

await rm(cuaRuntimeFixtureDir, { force: true, recursive: true });
console.log("Computer Use runtime driver contract self-test passed.");
