import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ModelCombobox } from "@/components/widget/model-combobox";
import { darwinAPI } from "@/tauri-api";
import type { AnyFieldApi } from "@tanstack/react-form";

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
  form: any;
}

export function AiModelsTab({
  evolveProviderField,
  evolveModelField,
  summaryProviderField,
  summaryModelField,
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
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label
                  className="text-xs font-medium text-muted-foreground"
                  htmlFor="evolveModel"
                >
                  Model Name
                </label>
                <form.Subscribe
                  selector={(state: any) => [
                    state.values.evolveProvider,
                    state.values.openaiApiKey,
                  ]}
                >
                  {([evolveProvider, apiKey]: [string, string]) => (
                    <ModelCombobox
                      provider={evolveProvider as "openai" | "ollama"}
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
                          ? "qwen3-coder:30b"
                          : "anthropic/claude-sonnet-4"
                      }
                      apiKey={apiKey}
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
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label
                  className="text-xs font-medium text-muted-foreground"
                  htmlFor="summaryModel"
                >
                  Model Name
                </label>
                <form.Subscribe
                  selector={(state: any) => [
                    state.values.summaryProvider,
                    state.values.openaiApiKey,
                  ]}
                >
                  {([summaryProvider, apiKey]: [string, string]) => (
                    <ModelCombobox
                      provider={summaryProvider as "openai" | "ollama"}
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
                          : "openai/gpt-4o-mini"
                      }
                      apiKey={apiKey}
                    />
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
