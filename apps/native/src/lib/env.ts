import {
	EnvProfileSchema,
	type EnvProfile,
	type NixmacEnv,
} from "./env-profile-schema";

type SettingsType = {
	readonly nixmacEnv: NixmacEnv;
	readonly nixmacVersion: string;
	readonly viteServerUrl?: string;
	readonly posthogKey?: string;
	readonly posthogHost: string;
	readonly filesystemEnabled: boolean;
	readonly nixInstalledOverride?: boolean;
	readonly skipPermissions: boolean;
};

/**
 * Whether this profile may switch off gates that exist for real users.
 *
 * A profile that says `production` never may, whatever else it or the build
 * environment asked for. That is the whole of what this function promises: a
 * release build gets the right profile in the first place because the selectors
 * in `nixmac-profile.ts` and `src-tauri/build.rs` refuse any value they do not
 * recognise, not because of anything here.
 *
 * Rust refuses its own skip-permissions bypass in release builds by a different
 * route — `system/permissions.rs` compiles it out. `NIX_INSTALLED_OVERRIDE`
 * exists only on this side.
 */
function mayBypassUserGates(env: NixmacEnv): boolean {
	return env !== "production";
}

export function toSettings(profile: EnvProfile): SettingsType {
	const bypassAllowed = mayBypassUserGates(profile.NIXMAC_ENV);
	return {
		nixmacEnv: profile.NIXMAC_ENV,
		nixmacVersion: profile.NIXMAC_VERSION ?? "unknown",
		viteServerUrl: profile.VITE_SERVER_URL,
		posthogKey: profile.VITE_POSTHOG_KEY,
		posthogHost: profile.VITE_POSTHOG_HOST,
		filesystemEnabled: profile.VITE_NIXMAC_FILESYSTEM,
		nixInstalledOverride:
			bypassAllowed && profile.NIX_INSTALLED_OVERRIDE ? true : undefined,
		skipPermissions: bypassAllowed && profile.VITE_NIXMAC_SKIP_PERMISSIONS,
	};
}

/**
 * The profile is validated and coerced at build time by `nixmac-profile.ts`;
 * parsing it again here checks this module's type rather than asserting it.
 *
 * There is deliberately no fallback. A profile that fails to parse throws at
 * startup, because silently substituting a different one is how every shipped
 * build came to run on `env.development.json` with the permissions gate off.
 */
const profile = EnvProfileSchema.parse(__NIXMAC_PROFILE_DATA__);

/** True only in builds made from `env.e2e.json`. */
export const isE2eProfile = profile.NIXMAC_ENV === "e2e";

/** Resolved deployment profile for app code. */
export const settings: SettingsType = toSettings(profile);

/** Deployment environment from the baked profile (`NIXMAC_ENV` key). */
export const nixmacEnvironment = settings.nixmacEnv;

/** App version from the merged profile (`NIXMAC_VERSION`). */
export const nixmacVersion = settings.nixmacVersion;

export function getWebSiteUrl(): string {
	return settings.viteServerUrl || "https://nixmac.com";
}

console.log("Running with env", import.meta.env);
