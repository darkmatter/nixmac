import type * as monacoNs from "monaco-editor";
import type { NixdLspClient } from "./lsp-client";

interface LspDiagnostic {
  range: LspRange;
  severity?: number;
  message: string;
  source?: string;
}

interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

interface LspPosition {
  line: number;
  character: number;
}

interface LspHoverResult {
  contents: { kind: string; value: string } | string;
  range?: LspRange;
}

interface LspCompletionItem {
  label: string;
  kind?: number;
  detail?: string;
  documentation?: string | { kind: string; value: string };
  insertText?: string;
}

interface LspCompletionResult {
  items?: LspCompletionItem[];
  isIncomplete?: boolean;
}

function lspToMonacoRange(range: LspRange): monacoNs.IRange {
  return {
    startLineNumber: range.start.line + 1,
    startColumn: range.start.character + 1,
    endLineNumber: range.end.line + 1,
    endColumn: range.end.character + 1,
  };
}

function monacoToLspPosition(position: monacoNs.Position): LspPosition {
  return {
    line: position.lineNumber - 1,
    character: position.column - 1,
  };
}

const LSP_SEVERITY_TO_MONACO: Record<number, number> = {
  1: 8, // Error
  2: 4, // Warning
  3: 2, // Information
  4: 1, // Hint
};

// LSP completion kind → Monaco completion kind
const LSP_COMPLETION_KIND_TO_MONACO: Record<number, number> = {
  1: 18, // Text
  2: 0, // Method
  3: 1, // Function
  4: 4, // Constructor
  5: 4, // Field
  6: 5, // Variable
  7: 7, // Class
  8: 8, // Interface
  9: 9, // Module
  10: 10, // Property
  13: 14, // Enum
  14: 3, // Keyword
  15: 15, // Snippet
  21: 23, // Constant
};

/**
 * Bridge Monaco editor to an LSP client.
 *
 * Handles:
 * - textDocument/didOpen, didChange, didClose
 * - textDocument/publishDiagnostics (server → Monaco markers)
 * - textDocument/hover (Monaco hover provider)
 * - textDocument/completion (Monaco completion provider)
 *
 * Returns a dispose function that cleans up all registrations.
 */
export function bridgeMonacoToLsp(
  monaco: typeof monacoNs,
  editor: monacoNs.editor.IStandaloneCodeEditor,
  client: NixdLspClient,
  filePath: string,
  configDir: string,
): () => void {
  const disposables: monacoNs.IDisposable[] = [];
  const uri = `file://${configDir}/${filePath}`;
  const model = editor.getModel();
  if (!model) return () => {};

  // --- didOpen ---
  client.sendNotification("textDocument/didOpen", {
    textDocument: {
      uri,
      languageId: "nix",
      version: 1,
      text: model.getValue(),
    },
  });

  // --- didChange ---
  let version = 2;
  disposables.push(
    model.onDidChangeContent(() => {
      client.sendNotification("textDocument/didChange", {
        textDocument: { uri, version: version++ },
        contentChanges: [{ text: model.getValue() }],
      });
    }),
  );

  // --- publishDiagnostics ---
  const unsubDiag = client.onNotification((method, params) => {
    if (method !== "textDocument/publishDiagnostics") return;
    const p = params as { uri: string; diagnostics: LspDiagnostic[] };
    if (p.uri !== uri) return;

    const markers: monacoNs.editor.IMarkerData[] = p.diagnostics.map((d) => ({
      ...lspToMonacoRange(d.range),
      message: d.message,
      severity: LSP_SEVERITY_TO_MONACO[d.severity ?? 1] ?? 8,
      source: d.source ?? "nixd",
    }));

    monaco.editor.setModelMarkers(model, "nixd", markers);
  });

  // --- Hover provider ---
  const hoverDisposable = monaco.languages.registerHoverProvider("nix", {
    async provideHover(_model, position) {
      if (_model !== model) return null;
      try {
        const result = (await client.sendRequest("textDocument/hover", {
          textDocument: { uri },
          position: monacoToLspPosition(position),
        })) as LspHoverResult | null;

        if (!result) return null;

        const contents =
          typeof result.contents === "string"
            ? result.contents
            : result.contents.value;

        return {
          range: result.range ? lspToMonacoRange(result.range) : undefined,
          contents: [{ value: contents }],
        };
      } catch {
        return null;
      }
    },
  });
  disposables.push(hoverDisposable);

  // --- Completion provider ---
  const completionDisposable = monaco.languages.registerCompletionItemProvider("nix", {
    triggerCharacters: [".", "/"],
    async provideCompletionItems(_model, position) {
      if (_model !== model) return { suggestions: [] };
      try {
        const result = (await client.sendRequest("textDocument/completion", {
          textDocument: { uri },
          position: monacoToLspPosition(position),
        })) as LspCompletionResult | LspCompletionItem[] | null;

        if (!result) return { suggestions: [] };

        const items = Array.isArray(result) ? result : result.items ?? [];
        const word = _model.getWordUntilPosition(position);

        const suggestions: monacoNs.languages.CompletionItem[] = items.map((item) => {
          const doc =
            typeof item.documentation === "string"
              ? item.documentation
              : item.documentation?.value;

          return {
            label: item.label,
            kind: LSP_COMPLETION_KIND_TO_MONACO[item.kind ?? 1] ?? 18,
            detail: item.detail,
            documentation: doc,
            insertText: item.insertText ?? item.label,
            range: {
              startLineNumber: position.lineNumber,
              startColumn: word.startColumn,
              endLineNumber: position.lineNumber,
              endColumn: word.endColumn,
            },
          };
        });

        return { suggestions };
      } catch {
        return { suggestions: [] };
      }
    },
  });
  disposables.push(completionDisposable);

  // --- Cleanup ---
  return () => {
    // didClose
    client.sendNotification("textDocument/didClose", {
      textDocument: { uri },
    });

    unsubDiag();
    monaco.editor.setModelMarkers(model, "nixd", []);
    for (const d of disposables) d.dispose();
  };
}
