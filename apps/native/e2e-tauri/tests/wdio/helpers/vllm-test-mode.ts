import { getMockVllmFixturePreset } from './mock-vllm-presets.js';

const WDIO_VLLM_MODE_ENV = 'NIXMAC_WDIO_VLLM_MODE';
const VALID_VLLM_TEST_MODES = new Set(['playback', 'real']);

function normalizeMode(mode: string | undefined | null): string {
  return String(mode ?? '').trim().toLowerCase();
}

export function getWdioVllmMode(): string {
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

export function isPlaybackMode(): boolean {
  return getWdioVllmMode() === 'playback';
}

export interface VllmSetupOptions {
  initializeConfigRepo?: boolean;
  mockVllm?: { responseFiles?: string[] };
}

export function createVllmSetupOptionsForSuite({
  initializeConfigRepo = true,
  playbackPreset,
}: {
  initializeConfigRepo?: boolean;
  playbackPreset?: string;
} = {}): VllmSetupOptions {
  const mode = getWdioVllmMode();

  const setupOptions: VllmSetupOptions = {
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
