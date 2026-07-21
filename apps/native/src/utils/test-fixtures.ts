import type {
	GlobalPreferences,
	NixInstallState,
	OnboardingState,
	PermissionsState,
	RebuildStatus,
} from "@/ipc/types";
import { viewModelActions } from "@nixmac/state";

/**
 * Full `GlobalPreferences` value for tests and stories. Matches the backend
 * defaults; override only the fields a scenario cares about.
 */
export function makeGlobalPreferences(
	overrides: Partial<GlobalPreferences> = {},
): GlobalPreferences {
	return {
		hostAttr: null,
		configDir: null,
		repoRoot: null,
		sendDiagnostics: true,
		diagnosticsNoticeAcknowledged: true,
		evolveProvider: null,
		evolveModel: null,
		evolveModels: {},
		summaryProvider: null,
		summaryModel: null,
		summaryModels: {},
		ollamaApiBaseUrl: null,
		openaiCompatibleApiBaseUrl: null,
		confirmBuild: true,
		confirmClear: true,
		confirmRollback: true,
		autoSummarizeOnFocus: false,
		scanHomebrewOnStartup: true,
		defaultToDiffTab: false,
		experimentalSpinningMascot: false,
		experimentalStreamingEvolve: false,
		developerMode: false,
		pinnedVersion: null,
		updateChannel: "stable",
		featureFlagOverrides: null,
		pendingImportDir: null,
		autoFormatNixFiles: false,
		...overrides,
	};
}

/**
 * Full `OnboardingState` value for tests and stories; defaults to a fresh
 * (never-onboarded) profile. Matches the backend defaults; override the
 * fields a scenario cares about — `makeCompletedOnboardingState` for the
 * common "finished user" shape.
 */
export function makeOnboardingState(
	overrides: Partial<OnboardingState> = {},
): OnboardingState {
	return {
		completedAt: null,
		macScannedAt: null,
		loginDecided: false,
		lastBuildAt: null,
		provisionalConfigDir: null,
		...overrides,
	};
}

/** Onboarding state of a user who completed the wizard. */
export function makeCompletedOnboardingState(
	overrides: Partial<OnboardingState> = {},
): OnboardingState {
	return makeOnboardingState({
		completedAt: 1751967600,
		macScannedAt: 1751967000,
		loginDecided: true,
		lastBuildAt: 1751967300,
		...overrides,
	});
}

/** All-granted permissions snapshot for tests and stories. */
export function makeGrantedPermissions(): PermissionsState {
	return {
		permissions: [],
		allRequiredGranted: true,
		checkedAt: Date.now(),
	};
}

/** Fully installed nix/darwin-rebuild snapshot for tests and stories. */
export function makeNixInstallState(
	overrides: Partial<NixInstallState> = {},
): NixInstallState {
	return {
		installed: true,
		darwinRebuildAvailable: true,
		installing: false,
		installPhase: null,
		prefetching: false,
		lastError: null,
		...overrides,
	};
}

/** Idle rebuild status for tests and stories; override per scenario. */
export function makeRebuildStatus(
	overrides: Partial<RebuildStatus> = {},
): RebuildStatus {
	return {
		isRunning: false,
		success: null,
		exitCode: null,
		errorType: null,
		errorMessage: null,
		systemUntouched: null,
		...overrides,
	};
}

/**
 * Seed the ViewModel with the Storybook/test bypass invariants: permissions
 * granted, Nix installed with nix-darwin available, a demo config selected,
 * and the onboarding completion latch set — so a widget mounted inside a
 * story never falls into the onboarding flow. Story-level seeding (which
 * runs after this) can still override any field.
 */
export function seedViewModelBypass(): void {
	const current = viewModelActions.getState();
	viewModelActions.setState({
		permissions: makeGrantedPermissions(),
		permissionsHydrated: true,
		nixInstall: makeNixInstallState(),
		onboardingState: current.onboardingState ?? makeCompletedOnboardingState(),
		preferences:
			current.preferences ??
			makeGlobalPreferences({
				hostAttr: "Demo-MacBook-Pro",
				configDir: "/Users/demo/.darwin",
				repoRoot: "/Users/demo/.darwin",
			}),
		hosts:
			current.hosts.length > 0
				? current.hosts
				: ["Demo-MacBook-Pro", "Work-MacBook"],
	});
}
