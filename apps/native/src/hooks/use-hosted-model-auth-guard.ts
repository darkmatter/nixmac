import type { AuthStatus, GlobalPreferences } from "@/ipc/types";
import {
	hasNixmacHostedModelSelected,
} from "@/lib/providers/ai-models";
import { client } from "@/lib/orpc";
import { nav } from "@/router";
import { useViewModel } from "@nixmac/state";
import { useEffect, useRef } from "react";

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
	const checked = useRef(false);

	useEffect(() => {
		if (!hydrated || !onboardingComplete || !preferences || checked.current) return;

		checked.current = true;
		let cancelled = false;

		if (!hasNixmacHostedModelSelected(preferences)) return;

		void client.account
			.status()
			.then((status) => {
				if (!cancelled && shouldPromptForHostedModelAuth(preferences, status)) {
					nav.openSettings("ai-models", "hosted-auth");
				}
			})
			.catch((error) => {
				console.error("[auth] failed to check hosted model credentials:", error);
			});

		return () => {
			cancelled = true;
		};
	}, [hydrated, onboardingComplete, preferences]);
}
