import { spawnSync } from "node:child_process";
import { createDriverDescriptor, driverContractVersion } from "./drivers/contract.mjs";

const nodeReplToolNames = Object.freeze({
  click: "click",
  get_app_state: "get_app_state",
  set_value: "set_value",
});

function normalizeComputerUseArgs(tool, args) {
  const normalized = { ...args };
  if (tool === "get_app_state") normalized.disableDiff = true;
  if (Object.hasOwn(normalized, "element_index")) {
    const elementIndex = Number(normalized.element_index);
    if (!Number.isInteger(elementIndex) || elementIndex < 0) {
      throw new TypeError(`${tool} requires a non-negative integer element_index`);
    }
    normalized.element_index = elementIndex;
  }
  return normalized;
}

export function nodeReplComputerUseCode(tool, args = {}) {
  const method = nodeReplToolNames[tool];
  if (!method) throw new Error(`Unsupported Computer Use tool: ${tool}`);
  const input = JSON.stringify(normalizeComputerUseArgs(tool, args));
  if (tool === "get_app_state") {
    return `{
  const { sky } = await import("@oai/sky");
  const state = await sky.get_app_state(${input});
  nodeRepl.write(state.text);
  const screenshotUrl = state.screenshot?.url;
  if (screenshotUrl) {
    if (screenshotUrl.startsWith("file:")) {
      const { readFile } = await import("node:fs/promises");
      const { fileURLToPath } = await import("node:url");
      const bytes = await readFile(fileURLToPath(screenshotUrl));
      const mimeType = bytes[0] === 0xff && bytes[1] === 0xd8 ? "image/jpeg" : "image/png";
      await nodeRepl.emitImage({ bytes, mimeType });
    } else {
      await nodeRepl.emitImage(screenshotUrl);
    }
  }
}`;
  }
  return `{
  const { sky } = await import("@oai/sky");
  await sky.${method}(${input});
  nodeRepl.write("Computer Use ${method} completed.");
}`;
}

export const codexAppServerDriverDescriptor = createDriverDescriptor({
  id: "codex-app-server-computer-use",
  displayName: "Codex app-server Computer Use",
  contractVersion: driverContractVersion,
  status: "production",
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

// Codex app-server transport primitives. AppServerClient intentionally retains
// the current Codex thread policy so extraction does not change runner behavior.
export class AppServerClient {
  constructor(
    url,
    {
      WebSocketImpl = globalThis.WebSocket,
      allowedComputerUseApps = [],
      reportViewerApps = ["com.google.Chrome", "Safari", "com.apple.Safari"],
    } = {},
  ) {
    this.url = url;
    this.WebSocketImpl = WebSocketImpl;
    this.allowedComputerUseApps = new Set(allowedComputerUseApps);
    this.reportViewerApps = new Set(reportViewerApps);
    this.nextId = 1;
    this.pending = new Map();
    this.ws = null;
    this.threadId = null;
  }

  respondToElicitation(message) {
    const params = message.params ?? {};
    const meta = params._meta ?? {};
    const requestedApp = meta.tool_params?.app;
    const approvedApp = this.allowedComputerUseApps.has(requestedApp);
    const approvedReportRead =
      meta.tool_name === "get_app_state" && this.reportViewerApps.has(requestedApp);
    const approved =
      params.serverName === "node_repl" &&
      meta.connector_id === "computer-use" &&
      meta.riskLevel === "low" &&
      (approvedApp || approvedReportRead);
    this.ws.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id: message.id,
        result: approved
          ? { action: "accept", content: {}, _meta: { persist: "session" } }
          : { action: "decline", content: null, _meta: null },
      }),
    );
  }

  async connect() {
    this.ws = new this.WebSocketImpl(this.url);
    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (
        message.method === "mcpServer/elicitation/request" &&
        message.id !== undefined &&
        message.id !== null
      ) {
        this.respondToElicitation(message);
        return;
      }
      if (message.id === undefined || message.id === null || !this.pending.has(message.id)) return;
      const entry = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
      else entry.resolve(message);
    };
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Timed out connecting to ${this.url}`)),
        10000,
      );
      this.ws.onopen = () => {
        clearTimeout(timer);
        resolve();
      };
      this.ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error(`WebSocket error connecting to ${this.url}`));
      };
    });
    await this.request("initialize", {
      clientInfo: { name: "nixmac-remote-computer-use-e2e", version: "1.0.0" },
      capabilities: {
        experimentalApi: true,
        mcpServerOpenaiFormElicitation: true,
      },
    });
    this.notify("initialized");
    const thread = await this.request("thread/start", {
      cwd: "/tmp",
      model: "gpt-5.4-mini",
      approvalPolicy: "on-request",
      sandbox: "danger-full-access",
      ephemeral: true,
    });
    this.threadId = thread.result.thread.id;
  }

  notify(method, params = {}) {
    this.ws.send(JSON.stringify({ jsonrpc: "2.0", method, params }));
  }

  request(method, params = {}, timeout = 60000) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for ${method}`));
      }, timeout);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
    });
  }

  tool(tool, args = {}, timeout = 60000) {
    const executionTimeout = tool === "get_app_state" ? Math.max(timeout, 120000) : timeout;
    return this.request(
      "mcpServer/tool/call",
      {
        server: "node_repl",
        threadId: this.threadId,
        tool: "js",
        arguments: {
          code: nodeReplComputerUseCode(tool, args),
          timeout_ms: executionTimeout,
          title: `nixmac E2E: ${tool}`,
        },
      },
      executionTimeout + 15000,
    );
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

export function contentText(response) {
  return response?.result?.content?.find((item) => item.type === "text")?.text ?? "";
}

export function contentImage(response) {
  return response?.result?.content?.find((item) => item.type === "image")?.data ?? "";
}

export function contentImageMimeType(response) {
  return response?.result?.content?.find((item) => item.type === "image")?.mimeType ?? "image/png";
}

export function computerUseImageAsPng(response) {
  const encoded = contentImage(response);
  if (!encoded) return Buffer.alloc(0);
  const image = Buffer.from(encoded, "base64");
  const isPng =
    image.length >= 8 &&
    image[0] === 0x89 &&
    image[1] === 0x50 &&
    image[2] === 0x4e &&
    image[3] === 0x47;
  if (isPng) return image;
  const mimeType = contentImageMimeType(response);
  const isJpeg =
    mimeType === "image/jpeg" || (image.length >= 2 && image[0] === 0xff && image[1] === 0xd8);
  if (!isJpeg) throw new Error(`Unsupported Computer Use image type: ${mimeType}`);
  const converted = spawnSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-f",
      "image2pipe",
      "-i",
      "pipe:0",
      "-frames:v",
      "1",
      "-f",
      "image2pipe",
      "-vcodec",
      "png",
      "pipe:1",
    ],
    { input: image, maxBuffer: 32 * 1024 * 1024 },
  );
  if (converted.error) throw converted.error;
  if (converted.status !== 0 || !converted.stdout?.length) {
    throw new Error(
      `Could not convert Computer Use JPEG to PNG: ${String(converted.stderr || "ffmpeg failed").trim()}`,
    );
  }
  return converted.stdout;
}

export function findElement(text, patterns) {
  const list = Array.isArray(patterns) ? patterns : [patterns];
  for (const line of text.split("\n")) {
    const match = line.match(/^\s*(\d+)\s+(.+)$/);
    if (!match) continue;
    const [, index, label] = match;
    if (list.some((pattern) => pattern.test(label))) return index;
  }
  return null;
}

export function elementEntries(text) {
  return text
    .split("\n")
    .map((line, lineNumber) => {
      const match = line.match(/^\s*(\d+)\s+(.+)$/);
      if (!match) return null;
      return { lineNumber, index: match[1], label: match[2] };
    })
    .filter(Boolean);
}

const clickToolFailurePatterns = [
  /^\s*(?:error|failed|failure):\s*(?:click|action|element|stale|invalid|no such|unable|could not|not found|not clickable)/im,
  /^\s*(?:click|action)\s+(?:failed|could not|unable)/im,
  /^\s*element(?:\s+index)?\s+\d+\s+(?:not found|not clickable|is stale|stale|invalid)/im,
  /\b(?:stale|invalid)\s+element(?:\s+index)?\b/i,
  /\bno such element\b/i,
  /\belement(?:\s+index)?\s+\d+\s+(?:not found|not clickable)\b/i,
  /\b(?:could not|unable to)\s+click\b/i,
];

const setValueToolFailurePatterns = [
  /^\s*(?:error|failed|failure):\s*(?:set|set_value|input|value|element|stale|invalid|no such|unable|could not|not found)/im,
  /^\s*(?:set_value|set value|input|type)\s+(?:failed|could not|unable)/im,
  /^\s*element(?:\s+index)?\s+\d+\s+(?:not found|not settable|is stale|stale|invalid)/im,
  /\b(?:stale|invalid)\s+element(?:\s+index)?\b/i,
  /\bno such element\b/i,
  /\belement(?:\s+index)?\s+\d+\s+(?:not found|not settable)\b/i,
  /\b(?:could not|unable to)\s+(?:set|type|enter)\b/i,
];

export function clickResponseIndicatesFailure(response, responseText = contentText(response)) {
  if (response?.result?.isError === true) return true;
  return clickToolFailurePatterns.some((pattern) => pattern.test(responseText));
}

export function setValueResponseIndicatesFailure(response, responseText = contentText(response)) {
  if (response?.result?.isError === true) return true;
  return setValueToolFailurePatterns.some((pattern) => pattern.test(responseText));
}
