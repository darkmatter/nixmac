import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}

interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

type NotificationHandler = (method: string, params: unknown) => void;

export class NixdLspClient {
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (reason: unknown) => void }
  >();
  private unlisten: UnlistenFn | null = null;
  private notificationHandlers: NotificationHandler[] = [];
  private _running = false;

  get running() {
    return this._running;
  }

  async start(configDir: string): Promise<void> {
    if (this._running) return;

    await invoke("lsp_start");

    // Listen for messages from nixd via Tauri events
    this.unlisten = await listen<string>("lsp:message", (event) => {
      this.handleMessage(event.payload);
    });

    this._running = true;

    // Send LSP initialize
    await this.sendRequest("initialize", {
      processId: null,
      rootUri: `file://${configDir}`,
      capabilities: {
        textDocument: {
          publishDiagnostics: { relatedInformation: true },
          hover: { contentFormat: ["markdown", "plaintext"] },
          completion: {
            completionItem: {
              snippetSupport: false,
              documentationFormat: ["markdown", "plaintext"],
            },
          },
        },
      },
    });

    // Send initialized notification
    this.sendNotification("initialized", {});
  }

  async stop(): Promise<void> {
    if (!this._running) return;

    try {
      await this.sendRequest("shutdown", null);
      this.sendNotification("exit", null);
    } catch {
      // Best effort
    }

    try {
      await invoke("lsp_stop");
    } catch {
      // Best effort
    }

    this.unlisten?.();
    this.unlisten = null;
    this._running = false;
    this.pending.clear();
  }

  async sendRequest(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    const request: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };

    const promise = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });

    await invoke("lsp_send", { message: JSON.stringify(request) });
    return promise;
  }

  sendNotification(method: string, params: unknown): void {
    const notification: JsonRpcNotification = { jsonrpc: "2.0", method, params };
    invoke("lsp_send", { message: JSON.stringify(notification) }).catch((e) => {
      console.warn("[lsp-client] Failed to send notification:", e);
    });
  }

  onNotification(handler: NotificationHandler): () => void {
    this.notificationHandlers.push(handler);
    return () => {
      const idx = this.notificationHandlers.indexOf(handler);
      if (idx >= 0) this.notificationHandlers.splice(idx, 1);
    };
  }

  private handleMessage(raw: string) {
    let msg: JsonRpcResponse & { method?: string; params?: unknown };
    try {
      msg = JSON.parse(raw);
    } catch {
      console.warn("[lsp-client] Failed to parse message:", raw.slice(0, 200));
      return;
    }

    // Response to a request we sent
    if ("id" in msg && msg.id != null && this.pending.has(msg.id)) {
      const handler = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      if (msg.error) {
        handler.reject(new Error(`${msg.error.message} (${msg.error.code})`));
      } else {
        handler.resolve(msg.result);
      }
      return;
    }

    // Server-initiated notification
    if ("method" in msg && msg.method) {
      for (const handler of this.notificationHandlers) {
        handler(msg.method, msg.params);
      }
    }
  }
}

// Singleton — one nixd instance shared across editor opens
export const lspClient = new NixdLspClient();
