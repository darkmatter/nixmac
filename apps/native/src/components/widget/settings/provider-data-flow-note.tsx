// Data-flow disclosure shown under the provider selectors (ENG-231).
// Copy is derived from where the request will actually go, not just the
// selected provider: the cloud path falls back from OpenRouter to OpenAI
// based on which API key is configured (mirrors
// get_effective_openai_compatible_credential in src-tauri/src/storage/store.rs),
// and Ollama only stays on-machine when its base URL is local.
// Starter-access/proxy provider modes will need their own entry here (ENG-542).

export interface ProviderDataFlowPrefs {
  openrouterApiKey?: string;
  openaiApiKey?: string;
  ollamaApiBaseUrl?: string;
}

const NOT_SENT_TO_NIXMAC = "They are not sent to nixmac's servers.";

const ENDPOINT_DEPENDENT_NOTE = (endpointLabel: string) =>
  `Your prompts and config context are sent to ${endpointLabel}. Where your data goes depends on that endpoint.`;

const CLI_NOTE = (cliLabel: string) =>
  `Your prompts and config context are passed to the ${cliLabel} on your machine. Where they go next depends on that tool's own account and configuration.`;

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1", "0.0.0.0"]);

/** True when the URL clearly points at this machine. Unparseable or
 * non-loopback hosts return false so we never overclaim locality. */
export function isLocalEndpoint(rawUrl: string): boolean {
  const candidate = rawUrl.includes("://") ? rawUrl : `http://${rawUrl}`;
  let hostname: string;
  try {
    hostname = new URL(candidate).hostname;
  } catch {
    return false;
  }
  return LOCAL_HOSTNAMES.has(hostname) || hostname.startsWith("127.");
}

export function getProviderDataFlowNote(
  provider: string,
  prefs: ProviderDataFlowPrefs,
): string | null {
  switch (provider) {
    case "openrouter":
    case "openai": {
      const hasOpenrouterKey = !!prefs.openrouterApiKey?.trim();
      const hasOpenaiKey = !!prefs.openaiApiKey?.trim();
      const destination = hasOpenrouterKey
        ? "OpenRouter"
        : hasOpenaiKey
          ? "OpenAI"
          : "OpenRouter or OpenAI, based on the API key you configure";
      return `Your prompts and config context are sent to ${destination} to process your request. ${NOT_SENT_TO_NIXMAC}`;
    }
    case "ollama": {
      const url = prefs.ollamaApiBaseUrl?.trim();
      if (!url || isLocalEndpoint(url)) {
        return "Using a local model — your data never leaves your machine.";
      }
      return ENDPOINT_DEPENDENT_NOTE("your configured Ollama endpoint");
    }
    case "vllm":
      return ENDPOINT_DEPENDENT_NOTE("the OpenAI-compatible endpoint you configure");
    case "claude":
      return CLI_NOTE("Claude CLI");
    case "codex":
      return CLI_NOTE("Codex CLI");
    case "opencode":
      return CLI_NOTE("OpenCode CLI");
    default:
      return null;
  }
}

export function ProviderDataFlowNote({
  provider,
  prefs,
}: {
  provider: string;
  prefs: ProviderDataFlowPrefs;
}) {
  const note = getProviderDataFlowNote(provider, prefs);
  if (!note) return null;
  return <p className="text-muted-foreground text-xs">{note}</p>;
}
