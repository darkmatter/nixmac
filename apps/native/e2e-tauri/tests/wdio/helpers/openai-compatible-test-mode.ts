import { getMockOpenAiCompatibleFixturePreset } from "./mock-openai-compatible-presets.js";

const WDIO_VLLM_MODE_ENV = "NIXMAC_WDIO_VLLM_MODE";
const VALID_OPENAI_COMPATIBLE_TEST_MODES = new Set(["playback", "real"]);

function normalizeMode(mode: string | undefined | null): string {
  return String(mode ?? "")
    .trim()
    .toLowerCase();
}

function getWdioOpenAiCompatibleMode(): string {
  const rawMode = process.env[WDIO_VLLM_MODE_ENV] ?? "playback";
  const mode = normalizeMode(rawMode);

  if (!VALID_OPENAI_COMPATIBLE_TEST_MODES.has(mode)) {
    const availableModes = Array.from(VALID_OPENAI_COMPATIBLE_TEST_MODES).join(", ");
    throw new Error(
      `[wdio:test-env] Invalid ${WDIO_VLLM_MODE_ENV}=${rawMode}. Expected one of: ${availableModes}`,
    );
  }

  return mode;
}

export function isPlaybackMode(): boolean {
  return getWdioOpenAiCompatibleMode() === "playback";
}

interface OpenAiCompatibleSetupOptions {
  initializeConfigRepo?: boolean;
  mockOpenAiCompatible?: { responseFiles?: string[] };
}

export function createOpenAiCompatibleSetupOptionsForSuite({
  initializeConfigRepo = true,
  playbackPreset,
}: {
  initializeConfigRepo?: boolean;
  playbackPreset?: string;
} = {}): OpenAiCompatibleSetupOptions {
  const mode = getWdioOpenAiCompatibleMode();

  const setupOptions: OpenAiCompatibleSetupOptions = {
    initializeConfigRepo,
  };

  if (mode === "real") {
    return setupOptions;
  }

  if (mode === "playback") {
    setupOptions.mockOpenAiCompatible = playbackPreset
      ? { responseFiles: getMockOpenAiCompatibleFixturePreset(playbackPreset) }
      : {};
  }

  return setupOptions;
}
