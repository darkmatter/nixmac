import type { HTMLAttributes } from "react";
import { useEffect } from "react";
import * as monaco from "monaco-editor";
import { createStandaloneCodeEditor, createStandaloneDiffEditor } from "./monaco-editor";

type WrapperProps = HTMLAttributes<HTMLElement>;

type EditorProps = {
  height?: number | string;
  defaultLanguage?: string;
  wrapperProps?: WrapperProps;
  beforeMount?: (monacoInstance: typeof monaco) => void;
  onMount?: (editor: ReturnType<typeof createStandaloneCodeEditor>) => void;
};

type DiffEditorProps = {
  height?: number | string;
  wrapperProps?: WrapperProps;
  beforeMount?: (monacoInstance: typeof monaco) => void;
  onMount?: (editor: ReturnType<typeof createStandaloneDiffEditor>) => void;
};

function pixelHeight(height: number | string | undefined): number | string {
  return height ?? 100;
}

export const loader = {
  config() {},
};

export function Editor({
  height,
  defaultLanguage,
  wrapperProps,
  beforeMount,
  onMount,
}: EditorProps) {
  useEffect(() => {
    beforeMount?.(monaco);
    onMount?.(createStandaloneCodeEditor());
  }, [beforeMount, onMount]);

  const resolvedHeight = pixelHeight(height);

  return (
    <section
      {...wrapperProps}
      style={{ display: "flex", position: "relative", textAlign: "initial", width: "100%", height: resolvedHeight }}
    >
      <div data-keybinding-context="N" data-mode-id={defaultLanguage} style={{ width: "100%" }}>
        <div className="monaco-editor" role="code" data-uri="inmemory://model/N" style={{ width: "100%", height: resolvedHeight }}>
          <div data-slot="monaco-editor-placeholder" />
        </div>
      </div>
    </section>
  );
}

export function DiffEditor({ height, wrapperProps, beforeMount, onMount }: DiffEditorProps) {
  useEffect(() => {
    beforeMount?.(monaco);
    onMount?.(createStandaloneDiffEditor());
  }, [beforeMount, onMount]);

  const resolvedHeight = pixelHeight(height);

  return (
    <section
      {...wrapperProps}
      style={{ display: "flex", position: "relative", textAlign: "initial", width: "100%", height: resolvedHeight }}
    >
      <div data-keybinding-context="N" style={{ width: "100%" }}>
        <div className="monaco-diff-editor" style={{ position: "relative", height: resolvedHeight }}>
          <div data-slot="monaco-editor-placeholder" />
        </div>
      </div>
    </section>
  );
}
