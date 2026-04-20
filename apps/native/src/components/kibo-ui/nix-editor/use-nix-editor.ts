import * as monaco from "monaco-editor";
import { useCallback, useEffect, useRef, useState } from "react";
import { initNixGrammar } from "@/lib/nix-grammar";
import { lspClient } from "@/lib/lsp-client";
import { bridgeMonacoToLsp } from "@/lib/lsp-monaco-bridge";
import { darwinAPI } from "@/tauri-api";

interface UseNixEditorOptions {
  filePath: string;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onSave?: (content: string) => void;
}

export function useNixEditor({ filePath, containerRef, onSave }: UseNixEditorOptions) {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDirty, setIsDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lspStatus, setLspStatus] = useState<"off" | "starting" | "running" | "error">("off");
  const originalContentRef = useRef<string>("");

  const save = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor) return;
    const content = editor.getValue();
    try {
      await darwinAPI.editor.writeFile(filePath, content);
      originalContentRef.current = content;
      setIsDirty(false);
      onSave?.(content);
    } catch (e) {
      setError(String(e));
    }
  }, [filePath, onSave]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    let editor: monaco.editor.IStandaloneCodeEditor | null = null;
    let lspCleanup: (() => void) | null = null;

    async function init() {
      try {
        // Load file content + config dir in parallel
        const [content, config] = await Promise.all([
          darwinAPI.editor.readFile(filePath),
          darwinAPI.config.get(),
        ]);
        if (disposed) return;

        originalContentRef.current = content;
        const configDir = config?.configDir ?? "";

        // Determine language from extension
        const ext = filePath.split(".").pop() ?? "";
        const language = ext === "nix" ? "nix" : ext;

        // Initialize Nix grammar if needed
        if (language === "nix") {
          await initNixGrammar(monaco);
        }

        if (disposed) return;

        // Create editor
        editor = monaco.editor.create(container!, {
          value: content,
          language,
          theme: "vs-dark",
          minimap: { enabled: false },
          fontSize: 13,
          scrollBeyondLastLine: false,
          wordWrap: "on",
          tabSize: 2,
          insertSpaces: true,
          automaticLayout: true,
          padding: { top: 12, bottom: 12 },
          renderLineHighlight: "line",
          scrollbar: {
            verticalScrollbarSize: 8,
            horizontalScrollbarSize: 8,
          },
        });

        editorRef.current = editor;

        // Wire Nix grammar to this editor instance
        if (language === "nix") {
          await initNixGrammar(monaco, editor);
        }

        // Track dirty state
        editor.onDidChangeModelContent(() => {
          const current = editor!.getValue();
          setIsDirty(current !== originalContentRef.current);
        });

        // Cmd+S to save
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
          const content = editor!.getValue();
          darwinAPI.editor.writeFile(filePath, content).then(() => {
            originalContentRef.current = content;
            setIsDirty(false);
            onSave?.(content);
          }).catch((e) => setError(String(e)));
        });

        setIsLoading(false);

        // Start LSP for Nix files (non-blocking — editor works without it)
        if (language === "nix" && configDir) {
          setLspStatus("starting");
          try {
            if (!lspClient.running) {
              await lspClient.start(configDir);
            }
            if (disposed) return;
            lspCleanup = bridgeMonacoToLsp(monaco, editor, lspClient, filePath, configDir);
            setLspStatus("running");
          } catch (e) {
            console.warn("[nix-editor] LSP failed to start:", e);
            setLspStatus("error");
            // Editor still works — just no diagnostics/hover/completion
          }
        }
      } catch (e) {
        if (!disposed) {
          setError(String(e));
          setIsLoading(false);
        }
      }
    }

    init();

    return () => {
      disposed = true;
      lspCleanup?.();
      if (editor) {
        editor.dispose();
        editorRef.current = null;
      }
      // Don't stop the LSP client — keep it running for subsequent editor opens
    };
  }, [filePath, containerRef, onSave]);

  return { isLoading, isDirty, error, save, editorRef, lspStatus };
}
