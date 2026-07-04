// Provider brand icons — real logos for AI providers supported by nixmac.
//
// Sources (all trademarked by their respective owners; used here for provider
// identification in the same way the app already displays provider names):
//   - OpenAI:    https://openai.com/brand/ (blossom symbol, Feb 2025)
//   - OpenRouter: https://openrouter.ai  (via simple-icons, CC0)
//   - Ollama:    https://github.com/ollama/ollama/blob/main/docs/ollama-logo.svg
//
// SVGs are inlined with `?raw` (matching the nixmac-mascot pattern) so the
// shapes inherit `currentColor` and adapt to light/dark themes automatically.
import type { CSSProperties } from "react";
import ollamaSvg from "./ollama.svg?raw";
import openaiSvg from "./openai.svg?raw";
import openrouterSvg from "./openrouter.svg?raw";

export type ProviderIconId =
  | "openai"
  | "openrouter"
  | "ollama"
  | "openai_compatible"
  | "claude"
  | "codex"
  | "opencode"
  | "nixmac";

const SVG_BY_PROVIDER: Partial<Record<ProviderIconId, string>> = {
  openai: openaiSvg,
  openrouter: openrouterSvg,
  ollama: ollamaSvg,
};

interface ProviderIconProps {
  provider: ProviderIconId;
  /** Rendered size in px (square). Default 16. */
  size?: number;
  className?: string;
  style?: CSSProperties;
  /** Accessible label. Defaults to the provider name. */
  label?: string;
}

const DEFAULT_LABELS: Record<ProviderIconId, string> = {
  openai: "OpenAI",
  openrouter: "OpenRouter",
  ollama: "Ollama",
  openai_compatible: "OpenAI Compatible",
  claude: "Claude CLI",
  codex: "Codex CLI",
  opencode: "OpenCode CLI",
  nixmac: "nixmac",
};

export function ProviderIcon({
  provider,
  size = 16,
  className,
  style,
  label,
}: ProviderIconProps) {
  const svg = SVG_BY_PROVIDER[provider];
  const accessibleLabel = label ?? DEFAULT_LABELS[provider];

  // Render inline SVG when we have a real logo, otherwise fall back to a
  // monogram chip so the layout stays consistent across all providers.
  if (!svg) {
    const initials = provider === "nixmac" ? "n" : provider.slice(0, 2).toUpperCase();
    return (
      <span
        className={className}
        role="img"
        aria-label={accessibleLabel}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: size,
          height: size,
          fontSize: size * 0.5,
          fontWeight: 700,
          lineHeight: 1,
          ...style,
        }}
      >
        {initials}
      </span>
    );
  }

  return (
    <span
      className={className}
      role="img"
      aria-label={accessibleLabel}
      style={{ display: "inline-flex", width: size, height: size, ...style }}
      // SVG content is a static local asset, not user input — safe to inline.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

