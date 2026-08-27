import type { AuthStatus, GlobalPreferences } from "@/ipc/types";
import { accountStatusQueryOptions } from "@/lib/account-status";
import { hasNixmacHostedModelSelected } from "@/lib/providers/ai-models";
import { nav } from "@/router";
import { useViewModel } from "@nixmac/state";
import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";

export function shouldPromptForHostedModelAuth(
  preferences: Pick<GlobalPreferences, "evolveProvider" | "summaryProvider"> | null,
  status: Pick<AuthStatus, "webApiAuthReady">,
): boolean {
  return hasNixmacHostedModelSelected(preferences) && !status.webApiAuthReady;
}

/**
 * Surface the settings choice whenever the app enters a state where hosted
 * inference is selected without a usable hosted-model credential.
 */
export function useHostedModelAuthGuard(): void {
  const hydrated = useViewModel((state) => state.hydrated);
  const preferences = useViewModel((state) => state.preferences);
  const onboardingComplete = useViewModel(
    (state) =>
      state.onboardingState?.completedAt !== null &&
      state.onboardingState?.completedAt !== undefined,
  );
  const hasHostedModelSelected = hasNixmacHostedModelSelected(preferences);
  const guardEnabled =
    hydrated && onboardingComplete && preferences !== null && hasHostedModelSelected;
  const { data: status } = useQuery(accountStatusQueryOptions(guardEnabled));
  const shouldPrompt =
    guardEnabled && status !== undefined && shouldPromptForHostedModelAuth(preferences, status);
  const wasPromptable = useRef(false);

  useEffect(() => {
    if (shouldPrompt && !wasPromptable.current) {
      void nav.openSettings("ai-models", "hosted-auth");
    }
    wasPromptable.current = shouldPrompt;
  }, [shouldPrompt]);
}
