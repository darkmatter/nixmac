import { randomUUID } from "node:crypto";
import path from "node:path";
import { createDriverDescriptor, driverContractVersion } from "./contract.mjs";

const DEFAULT_CUA_CLI = "/Applications/CuaDriver.app/Contents/MacOS/cua-driver";
const DEFAULT_CUA_APP = "/Applications/CuaDriver.app";
const DEFAULT_CUA_VERSION = "0.22.0";
const DEFAULT_SOCKET_DIRECTORY = "/tmp";
const DEFAULT_CALL_MAX_BUFFER = 32 * 1024 * 1024;
const MAX_UNIX_SOCKET_BYTES = 103;
const PNG_BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

const readOnlyAppAliases = Object.freeze({
  Safari: "com.apple.Safari",
  "com.apple.Safari": "com.apple.Safari",
  "com.google.Chrome": "com.google.Chrome",
});

export const cuaCompatDriverDescriptor = createDriverDescriptor({
  id: "cuadriver-compat",
  displayName: "CuaDriver compatibility adapter",
  contractVersion: driverContractVersion,
  status: "pilot",
  addressKinds: ["codex-index", "text-pattern"],
  capabilities: {
    connect: true,
    visibleState: true,
    findElement: true,
    click: true,
    setValue: true,
    screenshotFromState: true,
    textFromState: true,
    close: true,
    metadata: false,
    wait: false,
  },
});

function requirePlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function requirePositiveInteger(value, label) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw new TypeError(`${label} must be a positive integer`);
  }
  return normalized;
}

export function cuaShellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

export function cuaSocketPath(runId, socketDirectory = DEFAULT_SOCKET_DIRECTORY) {
  const safeRunId = requireNonEmptyString(runId, "CuaDriver runId").replace(
    /[^a-zA-Z0-9._-]/g,
    "-",
  );
  const directory = requireNonEmptyString(socketDirectory, "CuaDriver socket directory");
  if (!path.posix.isAbsolute(directory) || path.posix.normalize(directory) !== directory) {
    throw new Error("CuaDriver socket directory must be an absolute normalized POSIX path");
  }
  const socketPath = path.posix.join(directory, `nixmac-cua-${safeRunId}.sock`);
  if (Buffer.byteLength(socketPath, "utf8") > MAX_UNIX_SOCKET_BYTES) {
    throw new Error(`CuaDriver Unix socket path exceeds ${MAX_UNIX_SOCKET_BYTES} UTF-8 bytes`);
  }
  return socketPath;
}

function parseCuaOutput(stdout, tool) {
  const text = requireNonEmptyString(stdout, `CuaDriver ${tool} stdout`).trim();
  let decoded;
  try {
    decoded = JSON.parse(text);
  } catch (error) {
    throw new Error(`CuaDriver ${tool} returned malformed JSON: ${error.message}`);
  }
  const object = requirePlainObject(decoded, `CuaDriver ${tool} output`);
  if (Array.isArray(object.content) || Object.hasOwn(object, "structuredContent")) {
    if (!Array.isArray(object.content)) {
      throw new Error(`CuaDriver ${tool} envelope content must be an array`);
    }
    const contentText = object.content.find((item) => item?.type === "text")?.text ?? "";
    return {
      isError: object.isError === true,
      structured: object.structuredContent ?? null,
      text: String(contentText),
    };
  }
  return { isError: false, structured: object, text: "" };
}

function compatResponse({ text = "", imageBase64 = "", isError = false } = {}) {
  const content = [];
  if (text) content.push({ type: "text", text });
  if (imageBase64) content.push({ type: "image", data: imageBase64, mimeType: "image/png" });
  return { result: { isError, content } };
}

function normalizeRole(role, label = "") {
  if (["AXButton", "AXRadioButton"].includes(role) && /^(?:Summary|Semantic|Diff)$/i.test(label)) {
    return "tab";
  }
  const roleMap = {
    AXApplication: "application",
    AXButton: "button",
    AXCheckBox: "switch",
    AXComboBox: "combo box",
    AXGroup: "container",
    AXHeading: "heading",
    AXLink: "link",
    AXList: "content list",
    AXPopUpButton: "pop up button",
    AXRadioButton: "radio button",
    AXSecureTextField: "secure text field",
    AXStaticText: "text",
    AXTab: "tab",
    AXTextArea: "text entry area",
    AXTextField: "text field",
    AXWebArea: "HTML content",
    AXWindow: "standard window",
  };
  if (roleMap[role]) return roleMap[role];
  return String(role || "element")
    .replace(/^AX/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase();
}

function normalizeElementLine(element) {
  const index = Number(element.element_index);
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new TypeError("CuaDriver element index must be a non-negative integer");
  }
  const label = typeof element.label === "string" ? element.label.trim() : "";
  const role = normalizeRole(element.role, label);
  const qualifiers = [];
  if (element.enabled === false) qualifiers.push("disabled");
  if (element.selected === true) qualifiers.push("selected");
  if (/text (?:entry area|field)$/.test(role)) qualifiers.push("settable");
  const qualifiedRole = `${role}${qualifiers.map((item) => ` (${item})`).join("")}`;
  const pieces = [`${index}`, qualifiedRole];
  if (label) pieces.push(label);
  if (typeof element.value === "string" && element.value !== "") {
    pieces.push(`Value: ${element.value}`);
  }
  if (typeof element.value_description === "string" && element.value_description !== "") {
    pieces.push(`Description: ${element.value_description}`);
  }
  return pieces.join(" ");
}

export function cuaWindowStateText(state, binding) {
  const structured = requirePlainObject(state, "CuaDriver window state");
  if (!Array.isArray(structured.elements)) {
    throw new Error("CuaDriver window state elements must be an array");
  }
  const title = String(binding.title || "nixmac").replaceAll('"', "'");
  const appName = String(binding.appName || "nixmac").replaceAll('"', "'");
  const lines = structured.elements.map(normalizeElementLine);
  return [`Window: "${title}", App: ${appName}.`, ...lines].join("\n");
}

function validateWindowState(state, binding) {
  const structured = requirePlainObject(state, "CuaDriver get_window_state structured output");
  if (structured.pid !== binding.pid || structured.window_id !== binding.windowId) {
    throw new Error("CuaDriver get_window_state target identity mismatch");
  }
  if (!Array.isArray(structured.elements)) {
    throw new Error("CuaDriver get_window_state elements must be an array");
  }
  if (structured.screenshot_mime_type !== "image/png") {
    throw new Error("CuaDriver get_window_state screenshot must be image/png");
  }
  if (
    typeof structured.screenshot_png_b64 !== "string" ||
    !structured.screenshot_png_b64 ||
    !PNG_BASE64_PATTERN.test(structured.screenshot_png_b64)
  ) {
    throw new Error("CuaDriver get_window_state screenshot must be canonical base64 PNG data");
  }
  const decoded = Buffer.from(structured.screenshot_png_b64, "base64");
  if (
    decoded.toString("base64") !== structured.screenshot_png_b64 ||
    decoded.length < 24 ||
    decoded[0] !== 0x89 ||
    decoded.toString("ascii", 1, 4) !== "PNG"
  ) {
    throw new Error("CuaDriver get_window_state screenshot is not a complete PNG");
  }
  if (
    decoded.readUInt32BE(16) !== structured.screenshot_width ||
    decoded.readUInt32BE(20) !== structured.screenshot_height
  ) {
    throw new Error("CuaDriver screenshot dimensions do not match its PNG payload");
  }
  return structured;
}

function eligibleWindows(windows, pid) {
  if (!Array.isArray(windows)) throw new Error("CuaDriver list_windows response is malformed");
  return windows
    .filter(
      (window) =>
        window?.pid === pid &&
        window.layer === 0 &&
        window.is_on_screen === true &&
        window.on_current_space !== false &&
        Number.isSafeInteger(window.window_id) &&
        window.window_id > 0 &&
        Number.isFinite(window.z_index) &&
        Number(window.bounds?.width) > 0 &&
        Number(window.bounds?.height) > 0,
    )
    .sort((left, right) => right.z_index - left.z_index || left.window_id - right.window_id);
}

export function selectExactCuaWindow(
  windows,
  pid,
  { requireUnique = true, expectedTitle = "", minWidth = 0, minHeight = 0 } = {},
) {
  const eligible = eligibleWindows(windows, pid);
  const explicit = eligible.filter((window) => window.on_current_space === true);
  let candidates = explicit.length ? explicit : eligible;
  if (expectedTitle) candidates = candidates.filter((window) => window.title === expectedTitle);
  candidates = candidates.filter(
    (window) => window.bounds.width >= minWidth && window.bounds.height >= minHeight,
  );
  if (!candidates.length) {
    throw new Error(`CuaDriver found no current on-screen layer-0 window for pid ${pid}`);
  }
  if (requireUnique && candidates.length !== 1) {
    throw new Error(`CuaDriver found ${candidates.length} eligible windows for exact pid ${pid}`);
  }
  return candidates[0];
}

function webTextEntry(element) {
  return ["AXTextArea", "AXTextField", "AXSecureTextField"].includes(element?.role);
}

export function cuaElementPixelCenter(element, binding, state) {
  const frame = element?.frame;
  const bounds = binding?.bounds;
  if (
    !frame ||
    !bounds ||
    ![frame.x, frame.y, frame.w, frame.h, bounds.x, bounds.y, bounds.width, bounds.height].every(
      Number.isFinite,
    ) ||
    frame.w <= 0 ||
    frame.h <= 0 ||
    bounds.width <= 0 ||
    bounds.height <= 0
  ) {
    throw new Error("CuaDriver text element has no usable pixel frame");
  }
  const screenshotWidth = requirePositiveInteger(state.screenshot_width, "screenshot width");
  const screenshotHeight = requirePositiveInteger(state.screenshot_height, "screenshot height");
  const x = (frame.x - bounds.x + frame.w / 2) * (screenshotWidth / bounds.width);
  const y = (frame.y - bounds.y + frame.h / 2) * (screenshotHeight / bounds.height);
  if (x < 0 || y < 0 || x >= screenshotWidth || y >= screenshotHeight) {
    throw new Error("CuaDriver text element center falls outside the bound window screenshot");
  }
  return { x, y };
}

function closestReadbackElement(elements, original) {
  const candidates = elements.filter(
    (element) =>
      element?.role === original.role &&
      (element.label || "") === (original.label || "") &&
      element.frame &&
      original.frame,
  );
  candidates.sort((left, right) => {
    const leftDistance =
      (left.frame.x - original.frame.x) ** 2 + (left.frame.y - original.frame.y) ** 2;
    const rightDistance =
      (right.frame.x - original.frame.x) ** 2 + (right.frame.y - original.frame.y) ** 2;
    return leftDistance - rightDistance;
  });
  return candidates[0] ?? null;
}

export class CuaCompatClient {
  constructor({
    runRemote,
    appPath,
    appBundleId = "com.darkmatter.nixmac",
    runId = randomUUID(),
    socketDirectory = DEFAULT_SOCKET_DIRECTORY,
    cliPath = DEFAULT_CUA_CLI,
    driverAppPath = DEFAULT_CUA_APP,
    expectedVersion = DEFAULT_CUA_VERSION,
    toolInvocation = "call",
    sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
    statusAttempts = 24,
    statusDelayMs = 250,
  } = {}) {
    if (typeof runRemote !== "function") throw new TypeError("CuaCompatClient requires runRemote");
    this.runRemote = runRemote;
    this.appPath = requireNonEmptyString(appPath, "CuaCompatClient appPath");
    this.appBundleId = requireNonEmptyString(appBundleId, "CuaCompatClient appBundleId");
    this.cliPath = requireNonEmptyString(cliPath, "CuaCompatClient cliPath");
    this.driverAppPath = requireNonEmptyString(driverAppPath, "CuaCompatClient driverAppPath");
    this.expectedVersion = requireNonEmptyString(
      expectedVersion,
      "CuaCompatClient expectedVersion",
    );
    if (!["direct", "call"].includes(toolInvocation)) {
      throw new TypeError("CuaCompatClient toolInvocation must be direct or call");
    }
    this.toolInvocation = toolInvocation;
    this.runId = requireNonEmptyString(runId, "CuaCompatClient runId").replace(
      /[^a-zA-Z0-9._-]/g,
      "-",
    );
    this.socketPath = cuaSocketPath(this.runId, socketDirectory);
    this.sleep = sleep;
    this.statusAttempts = requirePositiveInteger(statusAttempts, "CuaDriver statusAttempts");
    this.statusDelayMs = Number(statusDelayMs);
    if (!Number.isFinite(this.statusDelayMs) || this.statusDelayMs < 0) {
      throw new TypeError("CuaDriver statusDelayMs must be a non-negative number");
    }
    this.connected = false;
    this.startedDaemon = false;
    this.canonicalAppPath = "";
    this.latest = new Map();
  }

  _run(command, options = {}) {
    const result = this.runRemote(command, options);
    if (!result?.ok) {
      throw new Error(
        result?.stderr || result?.stdout || result?.error || `Remote command failed: ${command}`,
      );
    }
    return result;
  }

  _cli(args, options = {}) {
    const command = [this.cliPath, ...args].map(cuaShellQuote).join(" ");
    return this._run(command, options).stdout;
  }

  _call(tool, input, options = {}) {
    const toolArgs =
      this.toolInvocation === "call"
        ? ["call", tool, JSON.stringify(input)]
        : [tool, JSON.stringify(input)];
    const stdout = this._cli(
      [...toolArgs, "--socket", this.socketPath],
      {
        maxBuffer: options.maxBuffer ?? DEFAULT_CALL_MAX_BUFFER,
        timeoutMs: options.timeoutMs ?? (tool === "get_window_state" ? 150_000 : 60_000),
      },
    );
    return parseCuaOutput(stdout, tool);
  }

  _requireSuccessful(parsed, tool) {
    if (parsed.isError) throw new Error(parsed.text || `CuaDriver ${tool} failed`);
    return requirePlainObject(parsed.structured, `CuaDriver ${tool} structured output`);
  }

  _canonicalRemotePath(inputPath) {
    const script = "import os,sys; print(os.path.realpath(sys.argv[1]))";
    return this._run(
      `/usr/bin/python3 -c ${cuaShellQuote(script)} ${cuaShellQuote(inputPath)}`,
    ).stdout.trim();
  }

  async connect() {
    if (this.connected) return;
    this.canonicalAppPath = this._canonicalRemotePath(this.appPath);
    this._run(
      `test -x ${cuaShellQuote(this.cliPath)} && test -d ${cuaShellQuote(
        this.driverAppPath,
      )} && test ! -e ${cuaShellQuote(this.socketPath)}`,
    );
    const competingDaemon = this.runRemote("/usr/bin/pgrep -x cua-driver", { timeoutMs: 10_000 });
    if (competingDaemon?.ok && competingDaemon.stdout?.trim()) {
      throw new Error(
        `CuaDriver parity refuses to start beside an existing daemon pid: ${competingDaemon.stdout.trim()}`,
      );
    }
    if (!competingDaemon?.ok && competingDaemon?.status !== 1) {
      throw new Error("CuaDriver parity could not prove the remote daemon slot is empty");
    }
    const actualVersion = this._cli(["--version"]).trim();
    if (actualVersion !== `cua-driver ${this.expectedVersion}`) {
      throw new Error(
        `CuaDriver version mismatch: expected cua-driver ${this.expectedVersion}, got ${actualVersion}`,
      );
    }
    this.startedDaemon = true;
    try {
      this._run(
        `/usr/bin/open -n -g ${cuaShellQuote(this.driverAppPath)} --args serve --socket ${cuaShellQuote(
          this.socketPath,
        )} --no-permissions-gate`,
      );
      let ready = false;
      let lastError = null;
      for (let attempt = 1; attempt <= this.statusAttempts; attempt += 1) {
        try {
          this._cli(["status", "--socket", this.socketPath]);
          ready = true;
          break;
        } catch (error) {
          lastError = error;
          if (attempt < this.statusAttempts) await this.sleep(this.statusDelayMs);
        }
      }
      if (!ready) {
        throw new Error(`CuaDriver daemon did not become ready: ${lastError?.message || "unknown"}`);
      }
      const permissions = this._requireSuccessful(
        this._call("check_permissions", { prompt: false }),
        "check_permissions",
      );
      if (permissions.accessibility !== true || permissions.screen_recording !== true) {
        throw new Error("CuaDriver requires Accessibility and Screen Recording permissions");
      }
      this.connected = true;
    } catch (error) {
      try {
        await this.close();
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          `CuaDriver startup failed and remote daemon cleanup failed: ${error.message}`,
        );
      }
      throw error;
    }
  }

  _mainAppRequest(app) {
    return app === this.appPath || app === this.canonicalAppPath || app === this.appBundleId;
  }

  _appBundleId(app) {
    if (this._mainAppRequest(app)) return this.appBundleId;
    return readOnlyAppAliases[app] ?? "";
  }

  _resolveBinding(app) {
    const bundleId = this._appBundleId(app);
    if (!bundleId) throw new Error(`CuaDriver refuses unapproved app target: ${app}`);
    const apps = this._requireSuccessful(this._call("list_apps", {}), "list_apps").apps;
    if (!Array.isArray(apps)) throw new Error("CuaDriver list_apps response is malformed");
    let candidates = apps.filter(
      (candidate) =>
        candidate?.running === true &&
        Number.isSafeInteger(candidate.pid) &&
        candidate.pid > 0 &&
        candidate.bundle_id === bundleId,
    );
    if (this._mainAppRequest(app)) {
      candidates = candidates.filter(
        (candidate) =>
          typeof candidate.launch_path === "string" &&
          this._canonicalRemotePath(candidate.launch_path) === this.canonicalAppPath,
      );
    }
    if (candidates.length !== 1) {
      throw new Error(
        `CuaDriver requires exactly one running ${bundleId} process at the approved path; found ${candidates.length}`,
      );
    }
    const pid = candidates[0].pid;
    const windows = this._requireSuccessful(
      this._call("list_windows", { pid, on_screen_only: true }),
      "list_windows",
    ).windows;
    const window = selectExactCuaWindow(windows, pid, {
      requireUnique: this._mainAppRequest(app),
      ...(this._mainAppRequest(app)
        ? { expectedTitle: "nixmac", minWidth: 500, minHeight: 500 }
        : {}),
    });
    return Object.freeze({
      app,
      appName: window.app_name || candidates[0].name || bundleId,
      bounds: Object.freeze({ ...window.bounds }),
      bundleId,
      pid,
      title: window.title || candidates[0].name || bundleId,
      windowId: window.window_id,
    });
  }

  _capture(app, binding = this._resolveBinding(app)) {
    const parsed = this._call("get_window_state", {
      pid: binding.pid,
      window_id: binding.windowId,
    });
    const state = validateWindowState(this._requireSuccessful(parsed, "get_window_state"), binding);
    const elements = new Map();
    for (const element of state.elements) {
      if (Number.isSafeInteger(element?.element_index) && element.element_index >= 0) {
        elements.set(element.element_index, Object.freeze({ ...element }));
      }
    }
    this.latest.set(app, Object.freeze({ binding, elements, state }));
    return compatResponse({
      text: cuaWindowStateText(state, binding),
      imageBase64: state.screenshot_png_b64,
    });
  }

  _latestAction(app, elementIndex) {
    const snapshot = this.latest.get(app);
    if (!snapshot) throw new Error("CuaDriver action requires a preceding get_app_state snapshot");
    const normalizedIndex = Number(elementIndex);
    if (!Number.isSafeInteger(normalizedIndex) || normalizedIndex < 0) {
      throw new TypeError("CuaDriver element_index must be a non-negative integer");
    }
    const element = snapshot.elements.get(normalizedIndex);
    if (!element) throw new Error(`CuaDriver snapshot has no element_index ${normalizedIndex}`);
    const windows = this._requireSuccessful(
      this._call("list_windows", { pid: snapshot.binding.pid }),
      "list_windows",
    ).windows;
    const live = windows?.find(
      (window) =>
        window?.pid === snapshot.binding.pid && window.window_id === snapshot.binding.windowId,
    );
    if (!live) throw new Error("CuaDriver target pid/window changed after get_app_state");
    return { element, snapshot };
  }

  _actionInput(snapshot, element) {
    const input = {
      pid: snapshot.binding.pid,
      window_id: snapshot.binding.windowId,
    };
    if (typeof element.element_token === "string" && element.element_token) {
      input.element_token = element.element_token;
    } else {
      if (typeof snapshot.state.snapshot_id !== "string" || !snapshot.state.snapshot_id) {
        throw new Error("CuaDriver index action requires the originating snapshot_id");
      }
      input.element_index = element.element_index;
      input.snapshot_id = snapshot.state.snapshot_id;
    }
    return input;
  }

  _actionFailure(parsed) {
    const structured = parsed.structured;
    return (
      parsed.isError ||
      structured?.ok === false ||
      structured?.is_error === true ||
      structured?.effect === "suspected_noop"
    );
  }

  _actionResponse(parsed, label) {
    if (this._actionFailure(parsed)) {
      const detail = `${parsed.text} ${JSON.stringify(parsed.structured ?? {})}`;
      const text = /stale|snapshot.*(?:changed|superseded)|element.*invalid/i.test(detail)
        ? "Computer Use server error -10005: The element ID is no longer valid."
        : parsed.text || `${label} failed: ${JSON.stringify(parsed.structured ?? {})}`;
      return compatResponse({ text, isError: true });
    }
    return compatResponse({ text: parsed.text || `${label} completed.` });
  }

  _webKitSetValue(app, snapshot, element, value) {
    const point = cuaElementPixelCenter(element, snapshot.binding, snapshot.state);
    const target = { pid: snapshot.binding.pid, window_id: snapshot.binding.windowId };
    for (const [tool, input] of [
      ["click", { ...target, ...point, delivery_mode: "foreground" }],
      ["hotkey", { ...target, keys: ["cmd", "a"], delivery_mode: "background" }],
      ["type_text", { ...target, text: value, delay_ms: 10, delivery_mode: "background" }],
    ]) {
      const result = this._call(tool, input);
      if (this._actionFailure(result)) {
        throw new Error(
          result.text || `CuaDriver ${tool} failed: ${JSON.stringify(result.structured ?? {})}`,
        );
      }
    }
    const refreshed = this._resolveBinding(app);
    if (
      refreshed.pid !== snapshot.binding.pid ||
      refreshed.windowId !== snapshot.binding.windowId
    ) {
      throw new Error("CuaDriver target changed before WebKit set_value readback");
    }
    const parsed = this._call("get_window_state", {
      pid: refreshed.pid,
      window_id: refreshed.windowId,
    });
    const state = validateWindowState(
      this._requireSuccessful(parsed, "get_window_state"),
      refreshed,
    );
    const readback = closestReadbackElement(state.elements, element);
    if (!readback || readback.value !== value) {
      throw new Error("CuaDriver WebKit set_value readback did not match the requested value");
    }
    const elements = new Map(
      state.elements
        .filter((item) => Number.isSafeInteger(item?.element_index) && item.element_index >= 0)
        .map((item) => [item.element_index, Object.freeze({ ...item })]),
    );
    this.latest.set(app, Object.freeze({ binding: refreshed, elements, state }));
    return compatResponse({ text: "Computer Use set_value completed with WebKit readback." });
  }

  async tool(tool, args = {}) {
    try {
      if (!this.connected) throw new Error("CuaDriver client is not connected");
      const app = requireNonEmptyString(args.app, `CuaDriver ${tool} app`);
      if (tool === "get_app_state") return this._capture(app);
      if (!this._mainAppRequest(app)) {
        throw new Error(`CuaDriver ${tool} is allowed only for the exact staged nixmac app`);
      }
      const { element, snapshot } = this._latestAction(app, args.element_index);
      if (tool === "click") {
        return this._actionResponse(
          this._call("click", this._actionInput(snapshot, element)),
          "Computer Use click",
        );
      }
      if (tool === "set_value") {
        if (typeof args.value !== "string") {
          throw new TypeError("CuaDriver set_value requires a string value");
        }
        if (webTextEntry(element)) return this._webKitSetValue(app, snapshot, element, args.value);
        return this._actionResponse(
          this._call("set_value", {
            ...this._actionInput(snapshot, element),
            value: args.value,
          }),
          "Computer Use set_value",
        );
      }
      throw new Error(`Unsupported Computer Use tool: ${tool}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stale = /stale|snapshot|pid\/window changed|target changed/i.test(message);
      return compatResponse({
        text: stale
          ? "Computer Use server error -10005: The element ID is no longer valid."
          : `CuaDriver ${tool} failed: ${message}`,
        isError: true,
      });
    }
  }

  async close() {
    this.latest.clear();
    this.connected = false;
    if (!this.startedDaemon) return;
    this._cli(["stop", "--socket", this.socketPath]);
    for (let attempt = 1; attempt <= this.statusAttempts; attempt += 1) {
      const probe = this.runRemote(`test ! -e ${cuaShellQuote(this.socketPath)}`);
      if (probe?.ok) {
        this.startedDaemon = false;
        return;
      }
      if (attempt < this.statusAttempts) await this.sleep(this.statusDelayMs);
    }
    throw new Error(`CuaDriver socket remained after stop: ${this.socketPath}`);
  }
}
