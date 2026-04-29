const MOCK_VLLM_FIXTURE_PRESETS: Record<string, string[]> = Object.freeze({
  basicPromptsAddFont: ['add-font.jsonl'],
  basicPromptsConfigureScreenshots: ['configure-screenshots.jsonl'],
  modifySequentialPrompts: ['add-font-add-another.jsonl'],
  askQuestionPrompts: ['ask-question.jsonl', 'add-font.jsonl'],
});

export function listMockVllmFixturePresetNames(): string[] {
  return Object.keys(MOCK_VLLM_FIXTURE_PRESETS);
}

export function getMockVllmFixturePreset(presetName: string): string[] {
  const files = MOCK_VLLM_FIXTURE_PRESETS[presetName];
  if (!files) {
    const available = listMockVllmFixturePresetNames().join(', ');
    throw new Error(
      `[wdio:test-env] Unknown mock vLLM fixture preset: ${presetName}. Available presets: ${available}`,
    );
  }

  return [...files];
}

export function createMockVllmSetupOptions({
  preset,
  initializeConfigRepo = true,
  mockVllm = {},
}: {
  preset?: string;
  initializeConfigRepo?: boolean;
  mockVllm?: Record<string, unknown>;
} = {}): {
  initializeConfigRepo: boolean;
  mockVllm: Record<string, unknown>;
} {
  if (!preset) {
    throw new Error('[wdio:test-env] createMockVllmSetupOptions requires a "preset" value');
  }

  return {
    initializeConfigRepo,
    mockVllm: {
      ...mockVllm,
      responseFiles: getMockVllmFixturePreset(preset),
    },
  };
}
