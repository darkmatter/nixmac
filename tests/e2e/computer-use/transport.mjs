import { createDriverDescriptor, driverContractVersion } from "./drivers/contract.mjs";

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
  constructor(url, { WebSocketImpl = globalThis.WebSocket } = {}) {
    this.url = url;
    this.WebSocketImpl = WebSocketImpl;
    this.nextId = 1;
    this.pending = new Map();
    this.ws = null;
    this.threadId = null;
  }

  async connect() {
    this.ws = new this.WebSocketImpl(this.url);
    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (!message.id || !this.pending.has(message.id)) return;
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
      capabilities: { experimentalApi: true },
    });
    const thread = await this.request("thread/start", {
      cwd: "/tmp",
      model: "gpt-5.4-mini",
      approvalPolicy: "never",
      sandbox: "danger-full-access",
      ephemeral: true,
    });
    this.threadId = thread.result.thread.id;
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
    return this.request(
      "mcpServer/tool/call",
      { server: "computer-use", threadId: this.threadId, tool, arguments: args },
      timeout,
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
