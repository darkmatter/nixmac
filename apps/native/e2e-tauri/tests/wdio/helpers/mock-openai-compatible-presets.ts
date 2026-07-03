const MOCK_OPENAI_COMPATIBLE_FIXTURE_PRESETS: Record<string, string[]> = Object.freeze({
  basicPromptsAddFont: ["add-font.jsonl"],
  basicPromptsConfigureScreenshots: ["configure-screenshots.jsonl"],
  modifySequentialPrompts: ["add-font-add-another.jsonl"],
  askQuestionPrompts: ["ask-question.jsonl", "add-font.jsonl"],
  conversationalPromptsOnBegin: ["conversational.jsonl"],
  conversationalPromptsOnEvolve: ["add-font.jsonl", "conversational.jsonl"],
});

function listMockOpenAiCompatibleFixturePresetNames(): string[] {
  return Object.keys(MOCK_OPENAI_COMPATIBLE_FIXTURE_PRESETS);
}

export function getMockOpenAiCompatibleFixturePreset(presetName: string): string[] {
  const files = MOCK_OPENAI_COMPATIBLE_FIXTURE_PRESETS[presetName];
  if (!files) {
    const available = listMockOpenAiCompatibleFixturePresetNames().join(", ");
    throw new Error(
      `[wdio:test-env] Unknown mock OpenAI-compatible fixture preset: ${presetName}. Available presets: ${available}`,
    );
  }

  return [...files];
}

function createMockOpenAiCompatibleSetupOptions({
  preset,
  initializeConfigRepo = true,
  mockOpenAiCompatible = {},
}: {
  preset?: string;
  initializeConfigRepo?: boolean;
  mockOpenAiCompatible?: Record<string, unknown>;
} = {}): {
  initializeConfigRepo: boolean;
  mockOpenAiCompatible: Record<string, unknown>;
} {
  if (!preset) {
    throw new Error('[wdio:test-env] createMockOpenAiCompatibleSetupOptions requires a "preset" value');
  }

  return {
    initializeConfigRepo,
    mockOpenAiCompatible: {
      ...mockOpenAiCompatible,
      responseFiles: getMockOpenAiCompatibleFixturePreset(preset),
    },
  };
}
