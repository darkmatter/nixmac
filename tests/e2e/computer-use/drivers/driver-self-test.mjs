#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { findElement } from "../transport.mjs";
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
  assert.equal(await scenario.clickElementIndex(fake, scenarioState, "1", "Stale Save"), false);
  assert.equal(
    events.some(
      (event) =>
        event.type === "computer-use.click.failed" &&
        event.data.label === "Stale Save" &&
        event.data.response === "stale element",
    ),
    true,
  );

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
  assert.deepEqual(waitResult, {
    ok: true,
    text: "1 text Ready",
    result: "ready",
  });
  assert.equal(pollingFake.visibleStateCalls, 2);
} finally {
  await rm(scenarioRunDir, { recursive: true, force: true });
}

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
