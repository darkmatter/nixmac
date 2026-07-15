import type { UiPrefs, UiPrefsUpdate } from "@/ipc/types";
import { modelForProvider } from "@/lib/providers/ai-models";

const OPENROUTER_PROVIDER = "openrouter";
const OPENAI_PROVIDER = "openai";

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

function shouldMigrateLegacyOpenaiProvider(
  prefs: Pick<UiPrefs, "openaiApiKey" | "openrouterApiKey">,
  model?: string | null,
): boolean {
  if (!hasValue(prefs.openrouterApiKey)) {
    return false;
  }
  return !hasValue(prefs.openaiApiKey) || isOpenrouterModelSlug(model);
}

export function migrateLegacyOpenaiProviderPrefs(prefs: UiPrefs): {
  values: ProviderMigrationValues;
  update: Partial<UiPrefsUpdate> | null;
} {
  const update: Partial<UiPrefsUpdate> = {};
  const evolveModel = modelForProvider(prefs.evolveModels, prefs.evolveProvider);
  const summaryModel = modelForProvider(prefs.summaryModels, prefs.summaryProvider);
  // Empty model means "track the provider default at runtime".
  const values = {
    evolveProvider: prefs.evolveProvider ?? OPENROUTER_PROVIDER,
    evolveModel,
    summaryProvider: prefs.summaryProvider ?? OPENROUTER_PROVIDER,
    summaryModel,
  };

  if (
    prefs.evolveProvider === OPENAI_PROVIDER &&
    shouldMigrateLegacyOpenaiProvider(prefs, evolveModel)
  ) {
    values.evolveProvider = OPENROUTER_PROVIDER;
    update.evolveProvider = values.evolveProvider;
    if (isOpenrouterModelSlug(evolveModel)) {
      // Models are remembered per provider, so the kept slug must be re-sent
      // to land under the provider we're switching to.
      values.evolveModel = evolveModel;
      update.evolveModel = evolveModel;
    } else {
      // No slug to carry over: fall back to openrouter's own remembered
      // model. Send no model update — "" would delete that remembered entry.
      values.evolveModel = modelForProvider(prefs.evolveModels, OPENROUTER_PROVIDER);
    }
  }

  if (
    prefs.summaryProvider === OPENAI_PROVIDER &&
    shouldMigrateLegacyOpenaiProvider(prefs, summaryModel)
  ) {
    values.summaryProvider = OPENROUTER_PROVIDER;
    update.summaryProvider = values.summaryProvider;
    if (isOpenrouterModelSlug(summaryModel)) {
      values.summaryModel = summaryModel;
      update.summaryModel = summaryModel;
    } else {
      values.summaryModel = modelForProvider(prefs.summaryModels, OPENROUTER_PROVIDER);
    }
  }

  return {
    values,
    update: Object.keys(update).length > 0 ? update : null,
  };
}
