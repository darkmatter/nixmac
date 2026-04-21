/**
 * Unit tests for useNixEditor.
 *
 * We mock monaco-editor in full: spinning up the real editor in jsdom would
 * require WebWorker / WASM / canvas, none of which are worth it for testing
 * the hook's orchestration logic (load file → create editor → wire LSP →
 * dispose on unmount).
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks — `vi.mock` factories are lifted to the top of the file,
// so any variables they reference must live inside `vi.hoisted(...)`.
// ---------------------------------------------------------------------------

type FakeEditor = {
  getValue: ReturnType<typeof vi.fn>;
  onDidChangeModelContent: ReturnType<typeof vi.fn>;
  addCommand: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  getModel: ReturnType<typeof vi.fn>;
  _triggerChange: () => void;
  _triggerSaveCommand: () => void | Promise<void>;
};

const h = vi.hoisted(() => {
  const state: {
    lastEditor: FakeEditor | null;
    changeHandler: (() => void) | null;
    saveCommandHandler: (() => void | Promise<void>) | null;
    editorValue: string;
  } = {
    lastEditor: null,
    changeHandler: null,
    saveCommandHandler: null,
    editorValue: "",
  };

  const monacoCreate = vi.fn((_container: HTMLElement, options: { value: string; language?: string }) => {
    state.editorValue = options.value;
    state.changeHandler = null;
    state.saveCommandHandler = null;

    const editor: FakeEditor = {
      getValue: vi.fn(() => state.editorValue),
      onDidChangeModelContent: vi.fn((fn: () => void) => {
        state.changeHandler = fn;
        return { dispose: vi.fn() };
      }),
      addCommand: vi.fn((_keybinding: number, fn: () => void | Promise<void>) => {
        state.saveCommandHandler = fn;
      }),
      dispose: vi.fn(),
      getModel: vi.fn(() => ({})),
      _triggerChange: () => state.changeHandler?.(),
      _triggerSaveCommand: () => state.saveCommandHandler?.(),
    };
    state.lastEditor = editor;
    return editor;
  });

  const initNixGrammar = vi.fn(async () => {});
  const bridgeMonacoToLsp = vi.fn(() => vi.fn());
  const mockLspStart = vi.fn(async () => {});
  const mockLspClient = {
    _running: false,
    get running() {
      return this._running;
    },
    start: mockLspStart,
  };

  const mockReadFile = vi.fn<(p: string) => Promise<string>>();
  const mockWriteFile = vi.fn<(p: string, content: string) => Promise<void>>();
  const mockConfigGet = vi.fn<() => Promise<{ configDir: string } | null>>();

  return {
    state,
    monacoCreate,
    initNixGrammar,
    bridgeMonacoToLsp,
    mockLspStart,
    mockLspClient,
    mockReadFile,
    mockWriteFile,
    mockConfigGet,
  };
});

vi.mock("monaco-editor", () => ({
  editor: {
    create: (container: HTMLElement, options: { value: string }) =>
      h.monacoCreate(container, options),
    setModelMarkers: vi.fn(),
  },
  languages: {
    getLanguages: vi.fn(() => []),
    register: vi.fn(),
    registerHoverProvider: vi.fn(() => ({ dispose: vi.fn() })),
    registerCompletionItemProvider: vi.fn(() => ({ dispose: vi.fn() })),
  },
  KeyMod: { CtrlCmd: 2048 },
  KeyCode: { KeyS: 49 },
}));

vi.mock("@/lib/nix-grammar", () => ({
  initNixGrammar: (...args: any[]) => (h.initNixGrammar as (...a: any[]) => unknown)(...args),
}));

vi.mock("@/lib/lsp-client", () => ({
  lspClient: h.mockLspClient,
}));

vi.mock("@/lib/lsp-monaco-bridge", () => ({
  bridgeMonacoToLsp: (...args: any[]) => (h.bridgeMonacoToLsp as (...a: any[]) => unknown)(...args),
}));

vi.mock("@/tauri-api", () => ({
  darwinAPI: {
    editor: {
      readFile: (p: string) => h.mockReadFile(p),
      writeFile: (p: string, c: string) => h.mockWriteFile(p, c),
    },
    config: {
      get: () => h.mockConfigGet(),
    },
  },
}));

// ---------------------------------------------------------------------------
// Hook under test — imported AFTER all vi.mock() calls.
// ---------------------------------------------------------------------------

import { useNixEditor } from "./use-nix-editor";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContainerRef() {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const ref = createRef<HTMLDivElement>();
  Object.defineProperty(ref, "current", { value: el, writable: true });
  return { ref, el };
}

function setEditorValue(v: string) {
  h.state.editorValue = v;
}

function resetAllMocks() {
  h.monacoCreate.mockClear();
  h.initNixGrammar.mockClear();
  h.bridgeMonacoToLsp.mockClear().mockReturnValue(vi.fn());
  h.mockLspStart.mockReset().mockResolvedValue();
  h.mockLspClient._running = false;
  h.mockReadFile.mockReset();
  h.mockWriteFile.mockReset().mockResolvedValue();
  h.mockConfigGet.mockReset();
  h.state.lastEditor = null;
  h.state.changeHandler = null;
  h.state.saveCommandHandler = null;
  h.state.editorValue = "";
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useNixEditor", () => {
  beforeEach(() => {
    resetAllMocks();
    h.mockReadFile.mockResolvedValue("{ config, ... }: {}");
    h.mockConfigGet.mockResolvedValue({ configDir: "/Users/me/.darwin" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads the file, creates a monaco editor, and flips isLoading false", async () => {
    const { ref } = makeContainerRef();

    const { result } = renderHook(() =>
      useNixEditor({ filePath: "configuration.nix", containerRef: ref }),
    );

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(h.mockReadFile).toHaveBeenCalledWith("configuration.nix");
    expect(h.monacoCreate).toHaveBeenCalledTimes(1);
    const options = h.monacoCreate.mock.calls[0][1];
    expect(options.value).toBe("{ config, ... }: {}");
    expect(options.language).toBe("nix");

    // Nix grammar was initialized twice: once for the monaco registry, once for the editor instance.
    expect(h.initNixGrammar).toHaveBeenCalledTimes(2);
    expect(result.current.error).toBeNull();
    expect(result.current.isDirty).toBe(false);
  });

  it("starts the LSP and bridges it for .nix files when a configDir is available", async () => {
    const { ref } = makeContainerRef();

    const { result } = renderHook(() =>
      useNixEditor({ filePath: "configuration.nix", containerRef: ref }),
    );

    await waitFor(() => {
      expect(result.current.lspStatus).toBe("running");
    });

    expect(h.mockLspStart).toHaveBeenCalledWith("/Users/me/.darwin");
    expect(h.bridgeMonacoToLsp).toHaveBeenCalledTimes(1);
  });

  it("skips LSP startup for non-Nix files and infers language from the extension", async () => {
    const { ref } = makeContainerRef();

    const { result } = renderHook(() =>
      useNixEditor({ filePath: "README.md", containerRef: ref }),
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(h.monacoCreate.mock.calls[0][1].language).toBe("md");
    expect(h.initNixGrammar).not.toHaveBeenCalled();
    expect(h.mockLspStart).not.toHaveBeenCalled();
    expect(h.bridgeMonacoToLsp).not.toHaveBeenCalled();
    expect(result.current.lspStatus).toBe("off");
  });

  it("sets lspStatus='error' when lspClient.start throws, but keeps the editor usable", async () => {
    h.mockLspStart.mockRejectedValueOnce(new Error("nixd crashed"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { ref } = makeContainerRef();

    const { result } = renderHook(() =>
      useNixEditor({ filePath: "configuration.nix", containerRef: ref }),
    );

    await waitFor(() => {
      expect(result.current.lspStatus).toBe("error");
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(h.monacoCreate).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("reuses a running LSP client instead of calling start() again", async () => {
    h.mockLspClient._running = true;
    const { ref } = makeContainerRef();

    const { result } = renderHook(() =>
      useNixEditor({ filePath: "configuration.nix", containerRef: ref }),
    );

    await waitFor(() => {
      expect(result.current.lspStatus).toBe("running");
    });

    expect(h.mockLspStart).not.toHaveBeenCalled();
    expect(h.bridgeMonacoToLsp).toHaveBeenCalledTimes(1);
  });

  it("marks the editor as dirty when its contents change", async () => {
    const { ref } = makeContainerRef();
    const { result } = renderHook(() =>
      useNixEditor({ filePath: "configuration.nix", containerRef: ref }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isDirty).toBe(false);

    act(() => {
      setEditorValue("{ config, ... }: { new = true; }");
      h.state.lastEditor!._triggerChange();
    });

    await waitFor(() => {
      expect(result.current.isDirty).toBe(true);
    });
  });

  it("save() writes to disk, clears dirty, and calls onSave", async () => {
    const onSave = vi.fn();
    const { ref } = makeContainerRef();

    const { result } = renderHook(() =>
      useNixEditor({ filePath: "configuration.nix", containerRef: ref, onSave }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      setEditorValue("# edited");
      h.state.lastEditor!._triggerChange();
    });
    await waitFor(() => expect(result.current.isDirty).toBe(true));

    await act(async () => {
      await result.current.save();
    });

    expect(h.mockWriteFile).toHaveBeenCalledWith("configuration.nix", "# edited");
    expect(onSave).toHaveBeenCalledWith("# edited");
    expect(result.current.isDirty).toBe(false);
  });

  it("save() sets error when writeFile rejects", async () => {
    h.mockWriteFile.mockRejectedValueOnce(new Error("EACCES"));
    const { ref } = makeContainerRef();

    const { result } = renderHook(() =>
      useNixEditor({ filePath: "configuration.nix", containerRef: ref }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.save();
    });

    expect(result.current.error).toContain("EACCES");
  });

  it("Cmd+S command saves via darwinAPI.editor.writeFile", async () => {
    const onSave = vi.fn();
    const { ref } = makeContainerRef();

    renderHook(() =>
      useNixEditor({ filePath: "configuration.nix", containerRef: ref, onSave }),
    );

    await waitFor(() => expect(h.state.lastEditor).not.toBeNull());
    await waitFor(() => expect(h.state.saveCommandHandler).not.toBeNull());

    setEditorValue("{ cmdS = true; }");
    await act(async () => {
      await h.state.lastEditor!._triggerSaveCommand();
    });

    await waitFor(() => {
      expect(h.mockWriteFile).toHaveBeenCalledWith("configuration.nix", "{ cmdS = true; }");
      expect(onSave).toHaveBeenCalledWith("{ cmdS = true; }");
    });
  });

  it("surfaces errors from readFile via the `error` field", async () => {
    h.mockReadFile.mockRejectedValueOnce(new Error("ENOENT"));
    const { ref } = makeContainerRef();

    const { result } = renderHook(() =>
      useNixEditor({ filePath: "configuration.nix", containerRef: ref }),
    );

    await waitFor(() => {
      expect(result.current.error).toContain("ENOENT");
      expect(result.current.isLoading).toBe(false);
    });

    expect(h.monacoCreate).not.toHaveBeenCalled();
  });

  it("does nothing when the container ref has no current element", () => {
    const ref = createRef<HTMLDivElement>();
    // ref.current stays null by design

    const { result } = renderHook(() =>
      useNixEditor({ filePath: "configuration.nix", containerRef: ref }),
    );

    expect(result.current.isLoading).toBe(true);
    expect(h.mockReadFile).not.toHaveBeenCalled();
    expect(h.monacoCreate).not.toHaveBeenCalled();
  });

  it("disposes the editor and runs lsp cleanup on unmount", async () => {
    const lspCleanup = vi.fn();
    h.bridgeMonacoToLsp.mockReturnValueOnce(lspCleanup);

    const { ref } = makeContainerRef();
    const { unmount, result } = renderHook(() =>
      useNixEditor({ filePath: "configuration.nix", containerRef: ref }),
    );

    await waitFor(() => expect(result.current.lspStatus).toBe("running"));
    const editor = h.state.lastEditor!;

    unmount();

    expect(editor.dispose).toHaveBeenCalledTimes(1);
    expect(lspCleanup).toHaveBeenCalledTimes(1);
  });

  it("aborts init if disposed before async setup completes", async () => {
    // Delay readFile so we can unmount in the middle of init.
    let resolveRead: ((v: string) => void) | null = null;
    h.mockReadFile.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          resolveRead = resolve;
        }),
    );

    const { ref } = makeContainerRef();
    const { unmount } = renderHook(() =>
      useNixEditor({ filePath: "configuration.nix", containerRef: ref }),
    );

    unmount();

    // Resolve after unmount — the effect should bail out.
    resolveRead!("{ post = true; }");
    await Promise.resolve();
    await Promise.resolve();

    expect(h.monacoCreate).not.toHaveBeenCalled();
    expect(h.mockLspStart).not.toHaveBeenCalled();
  });
});
