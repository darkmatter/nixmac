import type { UiPrefs, UiPrefsUpdate } from "@/ipc/types";

const OPENROUTER_PROVIDER = "openrouter";
const OPENAI_PROVIDER = "openai";
const DEFAULT_OPENROUTER_EVOLVE_MODEL = "anthropic/claude-sonnet-4";
const DEFAULT_OPENROUTER_SUMMARY_MODEL = "openai/gpt-4o-mini";

interface ProviderMigrationValues {
  evolveProvider: string;
  evolveModel: string;
  summaryProvider: string;
  summaryModel: string;
}

function hasValue(value?: string | null): boolean {
  return Boolean(value?.trim());
}

function isOpenrouterModelSlug(value?: string | null): boolean {
  return Boolean(value?.trim().includes("/"));
}

function shouldMigrateLegacyOpenaiProvider(prefs: Pick<UiPrefs, "openaiApiKey" | "openrouterApiKey">): boolean {
  return hasValue(prefs.openrouterApiKey) && !hasValue(prefs.openaiApiKey);
}

export function migrateLegacyOpenaiProviderPrefs(prefs: UiPrefs): {
  values: ProviderMigrationValues;
  update: Partial<UiPrefsUpdate> | null;
} {
  const update: Partial<UiPrefsUpdate> = {};
  const values = {
    evolveProvider: prefs.evolveProvider ?? OPENROUTER_PROVIDER,
    evolveModel: prefs.evolveModel ?? DEFAULT_OPENROUTER_EVOLVE_MODEL,
    summaryProvider: prefs.summaryProvider ?? OPENROUTER_PROVIDER,
    summaryModel: prefs.summaryModel ?? DEFAULT_OPENROUTER_SUMMARY_MODEL,
  };

  if (!shouldMigrateLegacyOpenaiProvider(prefs)) {
    return { values, update: null };
  }

  if (prefs.evolveProvider === OPENAI_PROVIDER) {
    values.evolveProvider = OPENROUTER_PROVIDER;
    update.evolveProvider = values.evolveProvider;
    if (!isOpenrouterModelSlug(prefs.evolveModel)) {
      values.evolveModel = DEFAULT_OPENROUTER_EVOLVE_MODEL;
      update.evolveModel = values.evolveModel;
    }
  }

  if (prefs.summaryProvider === OPENAI_PROVIDER) {
    values.summaryProvider = OPENROUTER_PROVIDER;
    update.summaryProvider = values.summaryProvider;
    if (!isOpenrouterModelSlug(prefs.summaryModel)) {
      values.summaryModel = DEFAULT_OPENROUTER_SUMMARY_MODEL;
      update.summaryModel = values.summaryModel;
    }
  }

  return {
    values,
    update: Object.keys(update).length > 0 ? update : null,
  };
}
