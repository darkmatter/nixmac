import { describe, expect, it } from "vitest";
import { getProviderDataFlowNote, isLocalEndpoint } from "./provider-data-flow-note";

describe("isLocalEndpoint", () => {
  it.each([
    "http://localhost:11434",
    "http://127.0.0.1:11434",
    "http://127.1.2.3:11434",
    "http://[::1]:11434",
    "localhost:11434",
  ])("treats %s as local", (url) => {
    expect(isLocalEndpoint(url)).toBe(true);
  });

  it.each([
    "http://ollama.example.com:11434",
    "https://10.0.0.5:11434",
    "http://my-mac.tailnet.ts.net:11434",
    "not a url at all ::",
  ])("treats %s as not provably local", (url) => {
    expect(isLocalEndpoint(url)).toBe(false);
  });
});

describe("getProviderDataFlowNote", () => {
  it("names OpenRouter when an OpenRouter key is configured", () => {
    const note = getProviderDataFlowNote("openrouter", { openrouterApiKey: "sk-or-1" });
    expect(note).toContain("sent to OpenRouter");
    expect(note).toContain("not sent to nixmac's servers");
  });

  it("names OpenAI when only an OpenAI key is configured (backend fallback)", () => {
    const note = getProviderDataFlowNote("openrouter", {
      openrouterApiKey: "  ",
      openaiApiKey: "sk-oai-1",
    });
    expect(note).toContain("sent to OpenAI");
  });

  it("hedges between providers when no key is configured yet", () => {
    const note = getProviderDataFlowNote("openrouter", {});
    expect(note).toContain("OpenRouter or OpenAI");
  });

  it("routes a residual 'openai' provider value through the same cloud logic", () => {
    const note = getProviderDataFlowNote("openai", { openaiApiKey: "sk-oai-1" });
    expect(note).toContain("sent to OpenAI");
  });

  it("shows local copy for Ollama with default (unset) base URL", () => {
    expect(getProviderDataFlowNote("ollama", {})).toBe(
      "Using a local model — your data never leaves your machine.",
    );
  });

  it("shows local copy for Ollama on a loopback base URL", () => {
    const note = getProviderDataFlowNote("ollama", {
      ollamaApiBaseUrl: "http://localhost:11434",
    });
    expect(note).toContain("never leaves your machine");
  });

  it("does not claim locality for a remote Ollama base URL", () => {
    const note = getProviderDataFlowNote("ollama", {
      ollamaApiBaseUrl: "http://ollama.example.com:11434",
    });
    expect(note).not.toContain("never leaves your machine");
    expect(note).toContain("configured Ollama endpoint");
  });

  it("describes vLLM as endpoint-dependent", () => {
    expect(getProviderDataFlowNote("vllm", {})).toContain("OpenAI-compatible endpoint");
  });

  it.each([
    ["claude", "Claude CLI"],
    ["codex", "Codex CLI"],
    ["opencode", "OpenCode CLI"],
  ])("describes %s as passing data through the CLI", (provider, label) => {
    const note = getProviderDataFlowNote(provider, {});
    expect(note).toContain(label);
    expect(note).toContain("account and configuration");
  });

  it("renders nothing for unknown providers", () => {
    expect(getProviderDataFlowNote("", {})).toBeNull();
    expect(getProviderDataFlowNote("someday-provider", {})).toBeNull();
  });
});
