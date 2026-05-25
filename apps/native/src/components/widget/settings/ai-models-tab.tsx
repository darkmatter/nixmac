import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ModelCombobox } from "@/components/widget/controls/model-combobox";
import { getProviderConfigInvalidReason, isCliProvider } from "@/lib/ai-provider-validation";
import { tauriAPI } from "@/ipc/api";
import type { CliToolsState } from "@/ipc/types";
import type { AnyFieldApi, ReactFormExtendedApi } from "@tanstack/react-form";
import { useEffect, useState } from "react";

interface AiModelsTabProps {
  // biome-ignore lint/suspicious/noExplicitAny: tanstack form types are complex
  evolveProviderField: AnyFieldApi;
  // biome-ignore lint/suspicious/noExplicitAny: tanstack form types are complex
  evolveModelField: AnyFieldApi;
  // biome-ignore lint/suspicious/noExplicitAny: tanstack form types are complex
  summaryProviderField: AnyFieldApi;
  // biome-ignore lint/suspicious/noExplicitAny: tanstack form types are complex
  summaryModelField: AnyFieldApi;
  // biome-ignore lint/suspicious/noExplicitAny: tanstack form types are complex
  form: ReactFormExtendedApi<any, any, any, any, any, any, any, any, any, any, any, any>;
}

const CLI_PROVIDERS = [
  { value: "claude", label: "Claude CLI" },
  { value: "codex", label: "Codex CLI" },
  { value: "opencode", label: "OpenCode CLI" },
] as const;

function isPlainInputCliProvider(provider: string): boolean {
  return provider === "claude" || provider === "codex";
}

const DEFAULT_EVOLVE_MODEL: Record<string, string> = {
  openrouter: "anthropic/claude-sonnet-4",
  openai: "anthropic/claude-sonnet-4",
  ollama: "",
  vllm: "gpt-oss-120b",
  claude: "",
  codex: "",
  opencode: "",
};

const DEFAULT_SUMMARY_MODEL: Record<string, string> = {
  openrouter: "openai/gpt-4o-mini",
  openai: "openai/gpt-4o-mini",
  ollama: "llama3.1",
  vllm: "gpt-oss-120b",
  claude: "",
  codex: "",
  opencode: "",
};

function useCliToolStatus() {
  const [status, setStatus] = useState<CliToolsState | null>(null);
  useEffect(() => {
    tauriAPI.cli.checkTools().then(setStatus).catch(() => {});
  }, []);
  return status;
}

function useProviderPrefs(form: AiModelsTabProps["form"]) {
  const [prefs, setPrefs] = useState({
    openrouterApiKey: "",
    openaiApiKey: "",
    vllmApiBaseUrl: "",
  });

  useEffect(() => {
    const subscription = form.store.subscribe(() => {
      const v = form.store.state.values;
      setPrefs({
        openrouterApiKey: v.openrouterApiKey ?? "",
        openaiApiKey: v.openaiApiKey ?? "",
        vllmApiBaseUrl: v.vllmApiBaseUrl ?? "",
      });
    });

    // trigger initial
    const v = form.store.state.values;
    setPrefs({
      openrouterApiKey: v.openrouterApiKey ?? "",
      openaiApiKey: v.openaiApiKey ?? "",
      vllmApiBaseUrl: v.vllmApiBaseUrl ?? "",
    });

    return () => subscription.unsubscribe();
  }, [form]);
  return prefs;
}

export function AiModelsTab({
  evolveProviderField,
  evolveModelField,
  summaryProviderField,
  summaryModelField,
  form,
}: AiModelsTabProps) {
  const cliStatus = useCliToolStatus();
  const providerPrefs = useProviderPrefs(form);

  const renderProviderItems = () => (
    <>
      {([
        { value: "openrouter", label: "OpenRouter" },
        { value: "ollama", label: "Ollama" },
        { value: "vllm", label: "OpenAI Compatible" },
      ] as const).map(({ value, label }) => {
        return (
          <SelectItem key={value} value={value}>
            {label}
          </SelectItem>
        );
      })}
      {CLI_PROVIDERS.map(({ value, label }) => {
        return (
          <SelectItem key={value} value={value}>
            {label}
          </SelectItem>
        );
      })}
    </>
  );

  const evolveProviderError = getProviderConfigInvalidReason(
    evolveProviderField.state.value,
    providerPrefs,
    cliStatus,
  );
  const summaryProviderError = getProviderConfigInvalidReason(
    summaryProviderField.state.value,
    providerPrefs,
    cliStatus,
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-4 font-semibold text-base">AI Models</h2>
        <p className="mb-4 text-muted-foreground text-xs">
          OpenRouter is the supported cloud provider in the main UI. Previously saved direct
          OpenAI keys still work as a legacy fallback, but they are no longer shown in Settings.
        </p>
        <div className="space-y-6">
          {/* Evolution Model */}
          <div className="space-y-4">
            <h3 className="font-medium text-sm">Evolution Model</h3>
            <p className="text-muted-foreground text-xs">
              Model used to plan and apply configuration changes in Nix
            </p>
            <div className="grid gap-4">
              <div className="space-y-2">
                <label
                  className="text-xs font-medium text-muted-foreground"
                  htmlFor="evolveProvider"
                >
                  Provider
                </label>
                <Select
                  onValueChange={async (value) => {
                    await tauriAPI.models.clearCached(value);
                    evolveProviderField.handleChange(value);
                    const defaultModel = DEFAULT_EVOLVE_MODEL[value] ?? "";
                    evolveModelField.handleChange(defaultModel);
                    await tauriAPI.ui.setPrefs({
                      evolveProvider: value,
                      evolveModel: defaultModel,
                    });
                  }}
                  value={evolveProviderField.state.value}
                >
                  <SelectTrigger id="evolveProvider">
                    <SelectValue placeholder="Select provider" />
                  </SelectTrigger>
                  <SelectContent>
                    {renderProviderItems()}
                  </SelectContent>
                </Select>
                {evolveProviderError && (
                  <p className="text-destructive text-xs">{evolveProviderError}</p>
                )}
              </div>
              <div className="space-y-2">
                <form.Subscribe
                  selector={(state: any) => [
                    state.values.evolveProvider,
                    state.values.openaiApiKey,
                  ]}
                >
                  {([evolveProvider]: any[]) => (
                    <>
                      <label className="text-xs font-medium text-muted-foreground" htmlFor="evolveModel">
                        Model Name{isCliProvider(evolveProvider) ? " (optional)" : ""}
                      </label>
                      {isPlainInputCliProvider(evolveProvider) ? (
                        <Input
                          id="evolveModel"
                          value={evolveModelField.state.value}
                          onChange={async (e) => {
                            evolveModelField.handleChange(e.target.value);
                            await tauriAPI.ui.setPrefs({ evolveModel: e.target.value });
                          }}
                          onBlur={evolveModelField.handleBlur}
                          placeholder="Leave empty for CLI default"
                        />
                      ) : (
                        <ModelCombobox
                          provider={evolveProvider as "openrouter" | "openai" | "ollama" | "vllm" | "opencode"}
                          value={evolveModelField.state.value}
                          onChange={async (value) => {
                            evolveModelField.handleChange(value);
                            await tauriAPI.ui.setPrefs({ evolveModel: value });
                          }}
                          onBlur={evolveModelField.handleBlur}
                          placeholder={
                            evolveProvider === "ollama"
                              ? ""
                              : evolveProvider === "vllm"
                                ? "gpt-oss-120b"
                                : evolveProvider === "opencode"
                                  ? "Leave empty for CLI default"
                                  : "anthropic/claude-sonnet-4"
                          }
                        />
                      )}
                    </>
                  )}
                </form.Subscribe>
              </div>
            </div>
          </div>

          {/* Summary Model */}
          <div className="space-y-4 pt-4 border-t border-border">
            <h3 className="font-medium text-sm">Summary Model</h3>
            <p className="text-muted-foreground text-xs">
              Model used to explain and summarize changes
            </p>
            <div className="grid gap-4">
              <div className="space-y-2">
                <label
                  className="text-xs font-medium text-muted-foreground"
                  htmlFor="summaryProvider"
                >
                  Provider
                </label>
                <Select
                  onValueChange={async (value) => {
                    await tauriAPI.models.clearCached(value);
                    summaryProviderField.handleChange(value);
                    const defaultModel = DEFAULT_SUMMARY_MODEL[value] ?? "";
                    summaryModelField.handleChange(defaultModel);
                    await tauriAPI.ui.setPrefs({
                      summaryProvider: value,
                      summaryModel: defaultModel,
                    });
                  }}
                  value={summaryProviderField.state.value}
                >
                  <SelectTrigger id="summaryProvider">
                    <SelectValue placeholder="Select provider" />
                  </SelectTrigger>
                  <SelectContent>
                    {renderProviderItems()}
                  </SelectContent>
                </Select>
                {summaryProviderError && (
                  <p className="text-destructive text-xs">{summaryProviderError}</p>
                )}
              </div>
              <div className="space-y-2">
                <form.Subscribe
                  selector={(state: any) => [
                    state.values.summaryProvider,
                    state.values.openaiApiKey,
                  ]}
                >
                  {([summaryProvider]: any[]) => (
                    <>
                      <label className="text-xs font-medium text-muted-foreground" htmlFor="summaryModel">
                        Model Name{isCliProvider(summaryProvider) ? " (optional)" : ""}
                      </label>
                      {isPlainInputCliProvider(summaryProvider) ? (
                        <Input
                          id="summaryModel"
                          value={summaryModelField.state.value}
                          onChange={async (e) => {
                            summaryModelField.handleChange(e.target.value);
                            await tauriAPI.ui.setPrefs({ summaryModel: e.target.value });
                          }}
                          onBlur={summaryModelField.handleBlur}
                          placeholder="Leave empty for CLI default"
                        />
                      ) : (
                        <ModelCombobox
                          provider={summaryProvider as "openrouter" | "openai" | "ollama" | "vllm" | "opencode"}
                          value={summaryModelField.state.value}
                          onChange={async (value) => {
                            summaryModelField.handleChange(value);
                            await tauriAPI.ui.setPrefs({ summaryModel: value });
                          }}
                          onBlur={summaryModelField.handleBlur}
                          placeholder={
                            summaryProvider === "ollama"
                              ? "llama3.1"
                              : summaryProvider === "vllm"
                                ? "gpt-oss-120b"
                                : summaryProvider === "opencode"
                                  ? "Leave empty for CLI default"
                                  : "openai/gpt-4o-mini"
                          }
                        />
                      )}
                    </>
                  )}
                </form.Subscribe>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
