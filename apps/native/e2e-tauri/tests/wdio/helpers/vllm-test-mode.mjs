import { getMockVllmFixturePreset } from './mock-vllm-presets.mjs';

const WDIO_VLLM_MODE_ENV = 'NIXMAC_WDIO_VLLM_MODE';
const VALID_VLLM_TEST_MODES = new Set(['playback', 'real']);

function normalizeMode(mode) {
  return String(mode ?? '').trim().toLowerCase();
}

export function getWdioVllmMode() {
  const rawMode = process.env[WDIO_VLLM_MODE_ENV] ?? 'playback';
  const mode = normalizeMode(rawMode);

  if (!VALID_VLLM_TEST_MODES.has(mode)) {
    const availableModes = Array.from(VALID_VLLM_TEST_MODES).join(', ');
    throw new Error(
      `[wdio:test-env] Invalid ${WDIO_VLLM_MODE_ENV}=${rawMode}. Expected one of: ${availableModes}`,
    );
  }

  return mode;
}

export function isPlaybackMode() {
  return getWdioVllmMode() === 'playback';
}

export function createVllmSetupOptionsForSuite({
  initializeConfigRepo = true,
  playbackPreset,
} = {}) {
  const mode = getWdioVllmMode();

  const setupOptions = {
    initializeConfigRepo,
  };

  if (mode === 'real') {
    return setupOptions;
  }

  if (mode === 'playback') {
    setupOptions.mockVllm = playbackPreset
      ? { responseFiles: getMockVllmFixturePreset(playbackPreset) }
      : {};
  }

  return setupOptions;
}
