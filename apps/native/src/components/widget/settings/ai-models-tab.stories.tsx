// @ts-nocheck - Storybook 10 alpha types have inference issues (resolves to `never`)
import preview from "#storybook/preview";
import { useMemo, useState } from "react";
import { AiModelsTab } from "./ai-models-tab";
import type { ProviderDataFlowPrefs } from "./provider-data-flow-note";

type ModelValues = {
  evolveProvider: string;
  evolveModel: string;
  summaryProvider: string;
  summaryModel: string;
  openrouterApiKey: string;
  openaiApiKey: string;
  vllmApiBaseUrl: string;
};

const DEFAULT_VALUES: ModelValues = {
  evolveProvider: "codex",
  evolveModel: "",
  summaryProvider: "claude",
  summaryModel: "",
  openrouterApiKey: "",
  openaiApiKey: "",
  vllmApiBaseUrl: "",
};

function AiModelsTabFixture({
  initialValues,
  dataFlowPrefs = {},
}: {
  initialValues?: Partial<ModelValues>;
  dataFlowPrefs?: ProviderDataFlowPrefs;
}) {
  const [values, setValues] = useState<ModelValues>({
    ...DEFAULT_VALUES,
    ...initialValues,
  });

  const field = (name: keyof ModelValues) => ({
    state: { value: values[name] },
    handleBlur: () => {},
    handleChange: (value: ModelValues[keyof ModelValues]) => {
      setValues((current) => ({ ...current, [name]: value }));
    },
  });

  const form = useMemo(
    () => ({
      store: {
        state: { values },
        subscribe: () => ({ unsubscribe: () => {} }),
      },
      Subscribe: ({ children, selector }: { children: (value: unknown) => JSX.Element; selector: (state: { values: ModelValues }) => unknown }) => children(selector({ values })),
    }),
    [values],
  );

  return (
    <div className="w-[560px] rounded-lg border bg-background p-6">
      <AiModelsTab
        dataFlowPrefs={dataFlowPrefs}
        evolveModelField={field("evolveModel")}
        evolveProviderField={field("evolveProvider")}
        form={form as any}
        summaryModelField={field("summaryModel")}
        summaryProviderField={field("summaryProvider")}
      />
    </div>
  );
}

const meta = preview.meta({
  title: "Widget/Settings/AiModelsTab",
  component: AiModelsTabFixture,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
});

export default meta;

export const CliProviders = meta.story({
  render: () => <AiModelsTabFixture />,
});

export const CloudProviders = meta.story({
  render: () => (
    <AiModelsTabFixture
      dataFlowPrefs={{ openrouterApiKey: "sk-or-storybook" }}
      initialValues={{
        evolveProvider: "openrouter",
        evolveModel: "anthropic/claude-sonnet-4",
        summaryProvider: "openrouter",
        summaryModel: "openai/gpt-4o-mini",
        openrouterApiKey: "sk-or-storybook",
      }}
    />
  ),
});

export const CloudFallbackToOpenAi = meta.story({
  render: () => (
    <AiModelsTabFixture
      dataFlowPrefs={{ openaiApiKey: "sk-oai-storybook" }}
      initialValues={{
        evolveProvider: "openrouter",
        evolveModel: "anthropic/claude-sonnet-4",
        summaryProvider: "openrouter",
        summaryModel: "openai/gpt-4o-mini",
        openaiApiKey: "sk-oai-storybook",
      }}
    />
  ),
});

export const LocalOllama = meta.story({
  render: () => (
    <AiModelsTabFixture
      dataFlowPrefs={{ ollamaApiBaseUrl: "http://localhost:11434" }}
      initialValues={{
        evolveProvider: "ollama",
        evolveModel: "llama3.1",
        summaryProvider: "ollama",
        summaryModel: "llama3.1",
      }}
    />
  ),
});

export const RemoteOllama = meta.story({
  render: () => (
    <AiModelsTabFixture
      dataFlowPrefs={{ ollamaApiBaseUrl: "http://ollama.example.com:11434" }}
      initialValues={{
        evolveProvider: "ollama",
        evolveModel: "llama3.1",
        summaryProvider: "ollama",
        summaryModel: "llama3.1",
      }}
    />
  ),
});

export const OpenAiCompatible = meta.story({
  render: () => (
    <AiModelsTabFixture
      initialValues={{
        evolveProvider: "vllm",
        evolveModel: "gpt-oss-120b",
        summaryProvider: "vllm",
        summaryModel: "gpt-oss-120b",
        vllmApiBaseUrl: "http://gpu-box.example.com:8000",
      }}
    />
  ),
});
