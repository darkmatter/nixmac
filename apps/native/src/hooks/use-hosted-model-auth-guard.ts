import type { AuthStatus, GlobalPreferences } from "@/ipc/types";
import { hasNixmacHostedModelSelected } from "@/lib/providers/ai-models";
import { orpc } from "@/lib/orpc";
import { nav } from "@/router";
import { useViewModel } from "@nixmac/state";
import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

export function shouldPromptForHostedModelAuth(
  preferences: Pick<GlobalPreferences, "evolveProvider" | "summaryProvider"> | null,
  status: Pick<AuthStatus, "signedIn">,
): boolean {
  return hasNixmacHostedModelSelected(preferences) && !status.signedIn;
}

/**
 * Surface the settings choice once per app launch when hosted inference is
 * still selected but the device no longer has a usable account credential.
 */
export function useHostedModelAuthGuard(): void {
  const hydrated = useViewModel((state) => state.hydrated);
  const preferences = useViewModel((state) => state.preferences);
  const onboardingComplete = useViewModel(
    (state) =>
      state.onboardingState?.completedAt !== null &&
      state.onboardingState?.completedAt !== undefined,
  );
  const { data: status } = useQuery(orpc.account.status.queryOptions({}));
  const isAuthenticated = !!status?.account;
  const hasNixmacHostedModel = useMemo(
    () => hasNixmacHostedModelSelected(preferences),
    [preferences],
  );

  useEffect(() => {
    if (
      !hydrated ||
      !onboardingComplete ||
      !preferences ||
      !hasNixmacHostedModel ||
      isAuthenticated
    )
      return;

    nav.openSettings("ai-models", "hosted-auth");
  }, [hydrated, onboardingComplete, preferences, hasNixmacHostedModel, isAuthenticated]);
}
