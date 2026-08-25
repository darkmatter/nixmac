#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  CuaCompatClient,
  cuaElementPixelCenter,
  cuaSocketPath,
  cuaWindowStateText,
  selectExactCuaWindow,
} from "./cua-compat.mjs";

const stagedApp = "/private/tmp/nixmac-e2e/nixmac.app";
const socketPath = "/tmp/nixmac-cua-run-123.sock";
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAABAAAAAQBPJcTWAAAAEElEQVR4nGP8wwACLGCSAQANBAECv1AVswAAAABJRU5ErkJggg==";
const typedPng =
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAABAAAAAQBPJcTWAAAAEklEQVR4nGNkYPjLwMDAwgAGAAsXAQPfmWhAAAAAAElFTkSuQmCC";

assert.equal(cuaSocketPath("run-123"), socketPath);
assert.throws(
  () => cuaSocketPath("x".repeat(200)),
  /Unix socket path exceeds/,
  "run-selected sockets must stay inside the Unix path bound",
);

const windowRecord = {
  app_name: "nixmac",
  bounds: { x: 0, y: 0, width: 800, height: 600 },
  is_on_screen: true,
  layer: 0,
  on_current_space: true,
  pid: 4242,
  title: "nixmac",
  window_id: 7002,
  z_index: 10,
};

assert.equal(selectExactCuaWindow([windowRecord], 4242).window_id, 7002);
assert.equal(
  selectExactCuaWindow(
    [
      windowRecord,
      {
        ...windowRecord,
        bounds: { x: 0, y: 0, width: 144, height: 80 },
        title: "Preview Indicator",
        window_id: 7004,
        z_index: 100,
      },
    ],
    4242,
    { expectedTitle: "nixmac", minWidth: 500, minHeight: 500 },
  ).window_id,
  7002,
  "exact main-window targeting must ignore the same-pid preview indicator",
);
assert.throws(
  () => selectExactCuaWindow([windowRecord, { ...windowRecord, window_id: 7003 }], 4242),
  /2 eligible windows/,
  "the staged target must never silently choose between multiple windows",
);
const promptElement = {
  depth: 1,
  element_index: 7,
  element_token: "snapshot:7",
  enabled: true,
  frame: { x: 0, y: 0, w: 800, h: 600 },
  label: "Prompt input",
  parent_index: 0,
  role: "AXTextArea",
  value: "",
};

function windowState(value) {
  return {
    _note: "fixture",
    element_count: 2,
    elements: [
      {
        depth: 0,
        element_index: 0,
        element_token: "snapshot:0",
        frame: { x: 0, y: 0, w: 800, h: 600 },
        label: "nixmac",
        role: "AXWindow",
      },
      { ...promptElement, value },
    ],
    pid: 4242,
    screenshot_height: 2,
    screenshot_mime_type: "image/png",
    screenshot_png_b64: value ? typedPng : png,
    screenshot_width: 2,
    snapshot_id: `snapshot-${value || "empty"}`,
    tree_markdown: "",
    window_id: 7002,
  };
}

assert.match(
  cuaWindowStateText(
    {
      ...windowState(""),
      elements: [
        {
          depth: 1,
          element_index: 21,
          element_token: "snapshot:21",
          label: "Semantic",
          role: "AXButton",
          selected: true,
        },
      ],
    },
    { appName: "nixmac", title: "nixmac" },
  ),
  /21 tab \(selected\) Semantic/,
  "CuaDriver AX buttons that implement Review tabs must preserve the runner's tab contract",
);

assert.match(
  cuaWindowStateText(windowState("fixture"), {
    appName: "nixmac",
    title: "nixmac",
  }),
  /7 text entry area \(settable\) Prompt input Value: fixture/,
);
assert.deepEqual(
  cuaElementPixelCenter(
    promptElement,
    { bounds: windowRecord.bounds },
    { screenshot_width: 2, screenshot_height: 2 },
  ),
  { x: 1, y: 1 },
);

function envelope(structuredContent, text = "ok", isError = false) {
  return JSON.stringify({
    content: [{ type: "text", text }],
    isError,
    structuredContent,
  });
}

const commands = [];
const toolCalls = [];
let typedValue = "";
let typedVisual = true;
let socketStopped = false;
let daemonRunning = false;
let staleClick = false;
let nextClickEffect = "";
let corruptScreenshot = true;

function fakeRemote(command) {
  commands.push(command);
  if (command === "/usr/bin/pgrep -x cua-driver") {
    return { ok: false, status: 1, stdout: "", stderr: "" };
  }
  if (command.includes("/usr/bin/python3 -c")) {
    return { ok: true, stdout: stagedApp, stderr: "" };
  }
  if (command.startsWith("test -x ")) return { ok: true, stdout: "", stderr: "" };
  if (command === 'test ! -e "$HOME/Library/Caches/cua-driver/cua-driver.pid"') {
    return { ok: !daemonRunning, stdout: "", stderr: daemonRunning ? "pid file exists" : "" };
  }
  if (command.includes("'--version'")) {
    return { ok: true, stdout: "cua-driver 0.22.0", stderr: "" };
  }
  if (command.startsWith("/usr/bin/open ")) {
    daemonRunning = true;
    return { ok: true, stdout: "", stderr: "" };
  }
  if (command.includes("'status' '--socket'")) {
    return { ok: true, stdout: "running", stderr: "" };
  }
  if (command.includes("'stop' '--socket'")) {
    socketStopped = true;
    daemonRunning = false;
    return { ok: true, stdout: "stopped", stderr: "" };
  }
  if (command.startsWith("/bin/bash -c ") && command.includes("CUA_PID_FILE=")) {
    return daemonRunning
      ? { ok: true, stdout: "5151\n", stderr: "" }
      : { ok: false, stdout: "", stderr: "daemon absent" };
  }
  if (command.startsWith("test ! -e ")) {
    return {
      ok: socketStopped && !daemonRunning,
      stdout: "",
      stderr: socketStopped && !daemonRunning ? "" : "socket exists",
    };
  }
  const match =
    command.match(/'call' '([^']+)' '([^']*)' '--socket'/) ||
    command.match(
      /'(check_permissions|list_apps|list_windows|get_window_state|click|hotkey|type_text|set_value)' '([^']*)' '--socket'/,
    );
  if (!match) return { ok: false, stdout: "", stderr: `unexpected remote command: ${command}` };
  const [, tool, encodedInput] = match;
  const input = JSON.parse(encodedInput);
  toolCalls.push({ tool, input });
  if (tool === "check_permissions") {
    return {
      ok: true,
      stdout: envelope({
        accessibility: true,
        direct_capture_status: "not_checked",
        screen_recording: true,
        screen_recording_capturable: null,
        source: { bundle_id: "com.trycua.driver" },
      }),
      stderr: "",
    };
  }
  if (tool === "list_apps") {
    return {
      ok: true,
      stdout: envelope({
        apps: [
          {
            bundle_id: "com.darkmatter.nixmac",
            launch_path: stagedApp,
            name: "nixmac",
            pid: 4242,
            running: true,
          },
        ],
      }),
      stderr: "",
    };
  }
  if (tool === "list_windows") {
    return { ok: true, stdout: envelope({ current_space_id: null, windows: [windowRecord] }), stderr: "" };
  }
  if (tool === "get_window_state") {
    const state = windowState(typedValue);
    if (!typedVisual && typedValue) state.screenshot_png_b64 = typedPng;
    if (corruptScreenshot) state.screenshot_png_b64 = "not-a-png";
    return { ok: true, stdout: envelope(state), stderr: "" };
  }
  if (tool === "click" && staleClick && Object.hasOwn(input, "element_token")) {
    return {
      ok: true,
      stdout: envelope({ ok: false, reason: "stale_element" }, "stale element", true),
      stderr: "",
    };
  }
  if (tool === "click" && nextClickEffect) {
    const effect = nextClickEffect;
    nextClickEffect = "";
    return { ok: true, stdout: envelope({ effect }), stderr: "" };
  }
  if (tool === "type_text") typedValue = input.text;
  return {
    ok: true,
    stdout: envelope({ effect: "unverifiable", path: "cgevent", verified: false }),
    stderr: "",
  };
}

const client = new CuaCompatClient({
  runRemote: fakeRemote,
  appPath: stagedApp,
  runId: "run-123",
  sleep: async () => {},
});

await client.connect();
assert.equal(client.socketPath, socketPath);
assert(
  commands.some(
    (command) =>
      command.startsWith("/usr/bin/open ") &&
      command.includes("serve --socket") &&
      command.includes(socketPath),
  ),
  "the Linux controller must start a run-unique daemon remotely through its injected executor",
);
assert(
  commands.some(
    (command) => command.includes("CUA_PID_FILE=") && command.includes("lsof") && command.includes(socketPath),
  ),
  "startup must bind the shared Cua PID file to the exact run-socket listener",
);

const invalidCapture = await client.tool("get_app_state", { app: stagedApp });
assert.equal(invalidCapture.result.isError, true);
assert.match(invalidCapture.result.content[0].text, /canonical base64 PNG/);
corruptScreenshot = false;
const observed = await client.tool("get_app_state", { app: stagedApp });
assert.equal(observed.result.isError, false);
assert.match(observed.result.content[0].text, /Window: "nixmac", App: nixmac/);
assert.equal(observed.result.content[1].type, "image");
assert(
  toolCalls.some(
    ({ tool, input }) => tool === "get_window_state" && input.pid === 4242 && input.window_id === 7002,
  ),
  "state capture must carry the exact staged pid and window id",
);

const setResult = await client.tool("set_value", {
  app: stagedApp,
  element_index: 7,
  value: "typed through WebKit",
});
assert.equal(setResult.result.isError, false);
assert.deepEqual(
  toolCalls
    .filter(({ tool }) => ["click", "hotkey", "type_text"].includes(tool))
    .map(({ tool, input }) => ({ tool, input })),
  [
    {
      tool: "type_text",
      input: {
        pid: 4242,
        window_id: 7002,
        x: 1,
        y: 1,
        text: "typed through WebKit",
        delay_ms: 10,
        session: "nixmac-run-123",
      },
    },
  ],
  "WebKit set_value should prefer one pixel-addressed type_text call before readback",
);
assert.equal(typedValue, "typed through WebKit");
assert.equal(toolCalls.at(-1).tool, "get_window_state");

typedVisual = false;
const axOnlyResult = await client.tool("set_value", {
  app: stagedApp,
  element_index: 7,
  value: "AX echo only",
});
assert.equal(axOnlyResult.result.isError, true);
assert.match(axOnlyResult.result.content[0].text, /independent visual readback/);
typedVisual = true;

await client.tool("get_app_state", { app: stagedApp });
nextClickEffect = "partial";
const partialClick = await client.tool("click", { app: stagedApp, element_index: 7 });
assert.equal(partialClick.result.isError, true);
await client.tool("get_app_state", { app: stagedApp });
const noChangeClick = await client.tool("click", { app: stagedApp, element_index: 7 });
assert.equal(noChangeClick.result.isError, true);
assert.match(noChangeClick.result.content[0].text, /no independent visible postcondition/);
await client.tool("get_app_state", { app: stagedApp });
staleClick = true;
const staleResult = await client.tool("click", { app: stagedApp, element_index: 7 });
assert.equal(staleResult.result.isError, true);
assert.match(staleResult.result.content[0].text, /-10005/);
const staleCall = toolCalls.at(-1);
assert.equal(staleCall.input.element_token, "snapshot:7");
assert.equal(Object.hasOwn(staleCall.input, "element_index"), false);
assert.equal(Object.hasOwn(staleCall.input, "snapshot_id"), false);

await client.close();
assert.equal(socketStopped, true);
assert.equal(
  commands.every((command) => typeof command === "string"),
  true,
  "every CuaDriver operation must cross the injected bounded remote executor",
);

console.log("CuaDriver compatibility self-test passed");
