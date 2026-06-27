// @ts-nocheck - Storybook 10 alpha types have inference issues (resolves to `never`)
import preview from "#storybook/preview";
import { useMemo, useState } from "react";
import { AiModelsTab } from "./ai-models-tab";

type ModelValues = {
  evolveProvider: string;
  evolveModel: string;
  summaryProvider: string;
  summaryModel: string;
  openrouterApiKey: string;
  openaiApiKey: string;
  vllmApiBaseUrl: string;
};

function AiModelsTabFixture() {
  const [values, setValues] = useState<ModelValues>({
    evolveProvider: "codex",
    evolveModel: "",
    summaryProvider: "claude",
    summaryModel: "",
    openrouterApiKey: "",
    openaiApiKey: "",
    vllmApiBaseUrl: "",
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
      Subscribe: ({
        children,
        selector,
      }: {
        children: (value: unknown) => JSX.Element;
        selector: (state: { values: ModelValues }) => unknown;
      }) => children(selector({ values })),
    }),
    [values],
  );

  return (
    <div className="w-[560px] rounded-lg border bg-background p-6">
      <AiModelsTab
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
