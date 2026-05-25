import mintedThemeJson from "@/themes/minted.json";
import type { editor } from "monaco-editor";

export const NIXMAC_THEME = "apathy-minted";

type VscodeTokenColor = {
  scope?: string | string[];
  settings?: {
    foreground?: string;
    fontStyle?: string;
  };
};

type VscodeTheme = {
  colors?: Record<string, string>;
  tokenColors?: VscodeTokenColor[];
};

const mintedTheme = mintedThemeJson as VscodeTheme;

function tokenColor(color: string | undefined): string | undefined {
  if (!color) return undefined;
  const normalized = color.trim().replace(/^#/, "");
  return normalized.length >= 6 ? normalized.slice(0, 6) : undefined;
}

function scopes(scope: string | string[] | undefined): string[] {
  if (!scope) return [];
  return (Array.isArray(scope) ? scope : scope.split(","))
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !/\s/.test(part));
}

const tokenRules: editor.ITokenThemeRule[] = (mintedTheme.tokenColors ?? []).flatMap((entry) => {
  const foreground = tokenColor(entry.settings?.foreground);
  const fontStyle = entry.settings?.fontStyle;

  if (!foreground && !fontStyle) return [];

  return scopes(entry.scope).map((token) => ({
    token,
    ...(foreground ? { foreground } : {}),
    ...(fontStyle ? { fontStyle } : {}),
  }));
});

const mintedForeground = tokenColor(mintedTheme.colors?.["editor.foreground"]) ?? "e1e2e5";
const mintedComment = "282948";
const mintedString = "b7ce99";
const mintedKeyword = "4a5585";
const mintedNumber = "7bc2df";
const mintedFunction = "99d3b9";
const mintedType = "998fe1";
const mintedWarning = "fcb086";
const mintedDeleted = "f09fad";
const mintedAdded = "9ff0e3";

export const NIXMAC_THEME_DATA: editor.IStandaloneThemeData = {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "", foreground: mintedForeground },
    ...tokenRules,
    // Monaco's built-in tokenizers use language-specific suffixes that can outrank
    // the generic TextMate scopes from the Minted theme. Keep these explicit so
    // bundled JSON/YAML/TOML/Shell views still inherit the Minted palette.
    { token: "comment", foreground: mintedComment, fontStyle: "italic" },
    { token: "string", foreground: mintedString },
    { token: "string.escape", foreground: mintedString },
    { token: "keyword", foreground: mintedKeyword },
    { token: "keyword.control", foreground: mintedKeyword },
    { token: "keyword.operator", foreground: mintedForeground },
    { token: "constant", foreground: mintedNumber },
    { token: "constant.language", foreground: mintedNumber },
    { token: "constant.numeric", foreground: mintedNumber },
    { token: "number", foreground: mintedNumber },
    { token: "type", foreground: mintedType },
    { token: "type.identifier", foreground: mintedType },
    { token: "entity.name.function", foreground: mintedFunction },
    { token: "entity.name.type", foreground: mintedType },
    { token: "support.function", foreground: mintedFunction },
    { token: "variable.parameter", foreground: mintedWarning },
    { token: "invalid", foreground: mintedDeleted },
    { token: "addition.diff", foreground: mintedAdded },
    { token: "deletion.diff", foreground: mintedDeleted },
    { token: "info.diff", foreground: mintedForeground },
    { token: "string.key.json", foreground: mintedKeyword },
    { token: "string.value.json", foreground: mintedString },
    { token: "keyword.json", foreground: mintedNumber },
    { token: "number.json", foreground: mintedNumber },
    { token: "string.yaml", foreground: mintedString },
    { token: "comment.yaml", foreground: mintedComment, fontStyle: "italic" },
    { token: "keyword.yaml", foreground: mintedKeyword },
    { token: "number.yaml", foreground: mintedNumber },
    { token: "type.yaml", foreground: mintedType },
    { token: "tag.yaml", foreground: mintedDeleted },
    { token: "string.toml", foreground: mintedString },
    { token: "comment.toml", foreground: mintedComment, fontStyle: "italic" },
    { token: "keyword.toml", foreground: mintedKeyword },
    { token: "number.toml", foreground: mintedNumber },
    { token: "type.toml", foreground: mintedType },
    { token: "string.shell", foreground: mintedString },
    { token: "comment.shell", foreground: mintedComment, fontStyle: "italic" },
    { token: "keyword.shell", foreground: mintedKeyword },
    { token: "number.shell", foreground: mintedNumber },
    { token: "variable.shell", foreground: mintedWarning },
    { token: "predefined.shell", foreground: mintedFunction },
  ],
  colors: {
    ...(mintedTheme.colors ?? {}),
    "editor.background": "#090910",
    "editor.foreground": "#e1e2e5",
    "editorGutter.background": "#090910",
    "editor.selectionBackground": "#191a25fa",
    "editor.inactiveSelectionBackground": "#0c002ecf",
    "editor.lineHighlightBackground": "#1b162994",
    "editorCursor.foreground": "#da4c51",
    "scrollbarSlider.background": "#1b1b364d",
    "scrollbarSlider.hoverBackground": "#383d51aa",
    "scrollbarSlider.activeBackground": "#4a4854cc",
    "diffEditor.insertedLineBackground": "#010e0daa",
    "diffEditor.removedLineBackground": "#0f0404ff",
    "diffEditor.insertedTextBackground": "#112b2a42",
    "diffEditor.removedTextBackground": "#20030cbb",
    "diffEditorGutter.insertedLineBackground": "#011211e2",
    "diffEditorGutter.removedLineBackground": "#2d0a12b4",
  },
};
