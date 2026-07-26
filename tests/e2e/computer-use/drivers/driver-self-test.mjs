#!/usr/bin/env node
import assert from "node:assert/strict";
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
import {
  CodexAppServerDriver,
  codexAppServerDriverDescriptor,
} from "./codex-app-server.mjs";

const requiredMethods = [
  "connect",
  "prepareTarget",
  "visibleState",
  "click",
  "setValue",
  "close",
];

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
assert.throws(
  () => normalizeVisibleState({ text: 7 }),
  /visible state text must be a string/,
);
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
          content: [{ type: "text", text: "Clicked element 7" }],
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
          content: [{ type: "text", text: "Set element 8 value" }],
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
const codexState = await codexDriver.visibleState({ app: "com.darkmatter.nixmac" });
assert.equal(codexState.text, "mock AX");
assert.equal(codexState.imageBase64, "mock-image");
const codexClicked = await codexDriver.click({
  app: "com.darkmatter.nixmac",
  elementIndex: 7,
});
assert.equal(codexClicked.ok, true);
const codexSetValue = await codexDriver.setValue({
  app: "com.darkmatter.nixmac",
  elementIndex: 8,
  value: 42,
});
assert.deepEqual(codexSetValue, {
  ok: true,
  text: "Set element 8 value",
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
      arguments: { app: "com.darkmatter.nixmac", element_index: 7 },
    },
    {
      server: "computer-use",
      threadId: "thread-codex-driver",
      tool: "set_value",
      arguments: {
        app: "com.darkmatter.nixmac",
        element_index: 8,
        value: "42",
      },
    },
  ],
  "Codex driver should preserve tool names, thread ID, and argument shapes",
);

for (const [method, request, expectedText] of [
  [
    "click",
    { app: "com.darkmatter.nixmac", elementIndex: 91 },
    "Error: stale element index 91",
  ],
  [
    "click",
    { app: "com.darkmatter.nixmac", elementIndex: 92 },
    "Synthetic click tool error",
  ],
  [
    "setValue",
    { app: "com.darkmatter.nixmac", elementIndex: 93, value: "ignored" },
    "Error: set_value element index 93 not found",
  ],
  [
    "setValue",
    { app: "com.darkmatter.nixmac", elementIndex: 94, value: "ignored" },
    "Synthetic set_value tool error",
  ],
]) {
  assert.deepEqual(await codexDriver[method](request), {
    ok: false,
    text: expectedText,
    isError: true,
  });
}

assert.equal(
  codexAppServerDriverDescriptor.id,
  "codex-app-server-computer-use",
);
codexDriver.close();
assert.equal(codexDriver.client.ws.closed, true);

console.log("Computer Use runtime driver contract self-test passed.");
