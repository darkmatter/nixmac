// @ts-nocheck - Storybook 10 alpha types have inference issues (resolves to `never`)
import preview from "#storybook/preview";
import { ProviderDataFlowNote } from "./provider-data-flow-note";

function NoteFixture(props: Parameters<typeof ProviderDataFlowNote>[0]) {
  return (
    <div className="w-[420px] rounded-lg border bg-background p-4">
      <ProviderDataFlowNote {...props} />
    </div>
  );
}

const meta = preview.meta({
  title: "Widget/Settings/ProviderDataFlowNote",
  component: NoteFixture,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
});

export default meta;

export const OpenRouter = meta.story({
  render: () => <NoteFixture provider="openrouter" prefs={{ openrouterApiKey: "sk-or-1" }} />,
});

export const OpenAiFallback = meta.story({
  render: () => <NoteFixture provider="openrouter" prefs={{ openaiApiKey: "sk-oai-1" }} />,
});

export const CloudNoKeyYet = meta.story({
  render: () => <NoteFixture provider="openrouter" prefs={{}} />,
});

export const OllamaLocal = meta.story({
  render: () => (
    <NoteFixture provider="ollama" prefs={{ ollamaApiBaseUrl: "http://localhost:11434" }} />
  ),
});

export const OllamaRemote = meta.story({
  render: () => (
    <NoteFixture
      provider="ollama"
      prefs={{ ollamaApiBaseUrl: "http://ollama.example.com:11434" }}
    />
  ),
});

export const OpenAiCompatibleEndpoint = meta.story({
  render: () => <NoteFixture provider="vllm" prefs={{}} />,
});

export const ClaudeCli = meta.story({
  render: () => <NoteFixture provider="claude" prefs={{}} />,
});

export const UnknownProviderRendersNothing = meta.story({
  render: () => <NoteFixture provider="someday-provider" prefs={{}} />,
});
