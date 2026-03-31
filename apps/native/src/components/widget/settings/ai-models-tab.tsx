import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ModelCombobox } from "@/components/widget/model-combobox";
import { darwinAPI, DEFAULT_MAX_ITERATIONS } from "@/tauri-api";
import type { AnyFieldApi } from "@tanstack/react-form";
import { Info } from "lucide-react";

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
  maxIterationsField: AnyFieldApi;
  // biome-ignore lint/suspicious/noExplicitAny: tanstack form types are complex
  maxBuildAttemptsField: AnyFieldApi;
  // biome-ignore lint/suspicious/noExplicitAny: tanstack form types are complex
  form: any;
}

export function AiModelsTab({
  evolveProviderField,
  evolveModelField,
  summaryProviderField,
  summaryModelField,
  maxIterationsField,
  maxBuildAttemptsField,
  form,
}: AiModelsTabProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-4 font-semibold text-base">AI Models</h2>
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
                    await darwinAPI.models.clearCached(value);
                    evolveProviderField.handleChange(value);
                    await darwinAPI.ui.setPrefs({
                      evolveProvider: value,
                    });
                  }}
                  value={evolveProviderField.state.value}
                >
                  <SelectTrigger id="evolveProvider">
                    <SelectValue placeholder="Select provider" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="openai">OpenAI / OpenRouter</SelectItem>
                    <SelectItem value="ollama">Ollama</SelectItem>
                    <SelectItem value="vllm">vLLM / LiteLLM</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="evolveModel">
                  Model Name
                </label>
                <form.Subscribe
                  selector={(state: any) => [
                    state.values.evolveProvider,
                    state.values.openaiApiKey,
                  ]}
                >
                  {([evolveProvider]: [string, string]) => (
                    <ModelCombobox
                      provider={evolveProvider as "openai" | "ollama" | "vllm"}
                      value={evolveModelField.state.value}
                      onChange={async (value) => {
                        evolveModelField.handleChange(value);
                        await darwinAPI.ui.setPrefs({
                          evolveModel: value,
                        });
                      }}
                      onBlur={evolveModelField.handleBlur}
                      placeholder={
                        evolveProvider === "ollama"
                          ? ""
                          : evolveProvider === "vllm"
                            ? "gpt-oss-120b"
                            : "anthropic/claude-sonnet-4"
                      }
                    />
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
                    await darwinAPI.models.clearCached(value);
                    summaryProviderField.handleChange(value);
                    await darwinAPI.ui.setPrefs({
                      summaryProvider: value,
                    });
                  }}
                  value={summaryProviderField.state.value}
                >
                  <SelectTrigger id="summaryProvider">
                    <SelectValue placeholder="Select provider" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="openai">OpenAI / OpenRouter</SelectItem>
                    <SelectItem value="ollama">Ollama</SelectItem>
                    <SelectItem value="vllm">vLLM / LiteLLM</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="summaryModel">
                  Model Name
                </label>
                <form.Subscribe
                  selector={(state: any) => [
                    state.values.summaryProvider,
                    state.values.openaiApiKey,
                  ]}
                >
                  {([summaryProvider]: [string, string]) => (
                    <ModelCombobox
                      provider={summaryProvider as "openai" | "ollama" | "vllm"}
                      value={summaryModelField.state.value}
                      onChange={async (value) => {
                        summaryModelField.handleChange(value);
                        await darwinAPI.ui.setPrefs({
                          summaryModel: value,
                        });
                      }}
                      onBlur={summaryModelField.handleBlur}
                      placeholder={
                        summaryProvider === "ollama"
                          ? "llama3.1"
                          : summaryProvider === "vllm"
                            ? "gpt-oss-120b"
                            : "openai/gpt-4o-mini"
                      }
                    />
                  )}
                </form.Subscribe>
              </div>
            </div>
          </div>

          {/* Evolution Limits */}
          <div className="space-y-4 pt-4 border-t border-border">
            <h3 className="font-medium text-sm">Evolution Limits</h3>
            <p className="text-muted-foreground text-xs">
              Control how long the AI will try before giving up
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <label
                    className="text-xs font-medium text-muted-foreground"
                    htmlFor="maxIterations"
                  >
                    Max Iterations
                  </label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex h-4 w-4 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:text-foreground/70"
                        aria-label="Max iterations info"
                      >
                        <Info className="h-3.5 w-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-xs text-xs">
                      <p>API calls before stopping (default: {DEFAULT_MAX_ITERATIONS}).</p>
                      <p className="mt-1">
                        Lower = faster/cheaper, may not finish complex changes.
                        <br />
                        Higher = more thorough, uses more API calls.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <Input
                  id="maxIterations"
                  type="number"
                  min={10}
                  max={200}
                  value={maxIterationsField.state.value}
                  onChange={async (e) => {
                    const value = Number.parseInt(e.target.value, 10) || DEFAULT_MAX_ITERATIONS;
                    maxIterationsField.handleChange(value);
                    await darwinAPI.ui.setPrefs({ maxIterations: value });
                  }}
                  onBlur={maxIterationsField.handleBlur}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <label
                    className="text-xs font-medium text-muted-foreground"
                    htmlFor="maxBuildAttempts"
                  >
                    Max Build Attempts
                  </label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex h-4 w-4 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:text-foreground/70"
                        aria-label="Max build attempts info"
                      >
                        <Info className="h-3.5 w-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-xs text-xs">
                      Failed builds before stopping (default: 5).
                    </TooltipContent>
                  </Tooltip>
                </div>
                <Input
                  id="maxBuildAttempts"
                  type="number"
                  min={1}
                  max={20}
                  value={maxBuildAttemptsField.state.value}
                  onChange={async (e) => {
                    const value = Number.parseInt(e.target.value, 10) || 5;
                    maxBuildAttemptsField.handleChange(value);
                    await darwinAPI.ui.setPrefs({ maxBuildAttempts: value });
                  }}
                  onBlur={maxBuildAttemptsField.handleBlur}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
