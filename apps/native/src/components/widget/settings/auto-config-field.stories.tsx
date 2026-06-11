// @ts-nocheck - Storybook 10 alpha types have inference issues (resolves to `never`)

import preview from "#storybook/preview";
import { AutoConfigField } from "@/components/widget/settings/auto-config-field";
import { tauriAPI } from "@/ipc/api";
import type { ConfigField } from "@/ipc/types";

const fields: ConfigField[] = [
  {
    key: "maxIterations",
    label: "Max iterations",
    help: "API calls before the agent stops.",
    ty: { kind: "number", min: 1, max: 200, step: 1 },
    default: 25,
    current: 25,
  },
  {
    key: "autoSummarize",
    label: "Auto summarize",
    help: "Create a summary when focus returns to the widget.",
    ty: { kind: "boolean" },
    default: true,
    current: true,
  },
  {
    key: "defaultPrompt",
    label: "Default prompt",
    ty: { kind: "string", multiline: true },
    default: "",
    current: "Install ripgrep and keep the existing module layout.",
  },
  {
    key: "provider",
    label: "Provider",
    ty: {
      kind: "enum",
      variants: [
        { value: "openrouter", label: "OpenRouter" },
        { value: "openai", label: "OpenAI" },
        { value: "ollama", label: "Ollama" },
      ],
    },
    default: "openrouter",
    current: "openrouter",
  },
];

function installDevConfigMock() {
  tauriAPI.devConfigs = {
    list: async () => [],
    set: async () => undefined,
  };
}

const meta = preview.meta({
  title: "Settings/AutoConfigField",
  component: AutoConfigField,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => {
      installDevConfigMock();
      return (
        <div style={{ maxWidth: 420 }}>
          <Story />
        </div>
      );
    },
  ],
  tags: ["autodocs"],
});

export default meta;

export const Controls = meta.story({
  render: () => (
    <div className="space-y-4">
      {fields.map((field) => (
        <AutoConfigField
          key={field.key}
          structName="EvolutionLimits"
          field={field}
        />
      ))}
    </div>
  ),
});
