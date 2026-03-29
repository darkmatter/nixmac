export { invoke } from "./tauri-runtime";

// Minimal stubs for runtime classes required by @tauri-apps/plugin-updater
// (and other plugins that import from @tauri-apps/api/core).
// These are never called in Storybook – the exports just need to resolve so
// the bundler can include all plugin code without a "missing export" error.

export class Resource {
  readonly rid: number;
  constructor(rid: number) {
    this.rid = rid;
  }
  async close(): Promise<void> {}
}

export class Channel<T = unknown> {
  readonly id: number;
  private _onmessage: ((response: T) => void) | null = null;

  constructor() {
    this.id = Math.floor(Math.random() * 1_000_000);
  }

  get onmessage(): ((response: T) => void) | null {
    return this._onmessage;
  }

  set onmessage(handler: ((response: T) => void) | null) {
    this._onmessage = handler;
  }
}
