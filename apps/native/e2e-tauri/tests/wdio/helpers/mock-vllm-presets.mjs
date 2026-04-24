const MOCK_VLLM_FIXTURE_PRESETS = Object.freeze({
  basicPromptsAddFont: ['add-font.jsonl'],
});

export function listMockVllmFixturePresetNames() {
  return Object.keys(MOCK_VLLM_FIXTURE_PRESETS);
}

export function getMockVllmFixturePreset(presetName) {
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
} = {}) {
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
