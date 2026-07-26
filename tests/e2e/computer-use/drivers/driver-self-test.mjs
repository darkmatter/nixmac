#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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

console.log("Computer Use runtime driver contract self-test passed.");
