import type * as monacoNs from "monaco-editor";
import { wireTmGrammars } from "monaco-editor-textmate";
import { Registry } from "monaco-textmate";
import { loadWASM } from "vscode-oniguruma";

let initialized = false;

export async function initNixGrammar(
  monaco: typeof monacoNs,
  editor?: monacoNs.editor.ICodeEditor,
): Promise<void> {
  if (initialized) return;

  // Load oniguruma WASM
  const onigWasmUrl = new URL(
    "vscode-oniguruma/release/onig.wasm",
    import.meta.url,
  );
  const response = await fetch(onigWasmUrl);
  await loadWASM(response);

  // Register Nix language with Monaco if not already registered
  const langs = monaco.languages.getLanguages();
  if (!langs.some((l) => l.id === "nix")) {
    monaco.languages.register({ id: "nix", extensions: [".nix"] });
  }

  const registry = new Registry({
    async getGrammarDefinition(scopeName: string) {
      if (scopeName === "source.nix") {
        const grammarResponse = await fetch("/grammars/nix.tmLanguage.json");
        const grammar = await grammarResponse.json();
        return {
          format: "json" as const,
          content: grammar,
        };
      }
      return { format: "json" as const, content: {} };
    },
  });

  const grammars = new Map<string, string>();
  grammars.set("nix", "source.nix");

  await wireTmGrammars(monaco, registry, grammars, editor);
  initialized = true;
}
