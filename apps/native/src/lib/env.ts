import { z } from "zod";
import development from "../../env.development.json";
import e2e from "../../env.e2e.json";
import release from "../../env.release.json";

/** Keys from committed `env.{development,release,e2e}.json` (native JSON module types). */
type EnvProfileKey =
	| keyof typeof development
	| keyof typeof release
	| keyof typeof e2e;

type ProfileLookupKey =
	| EnvProfileKey
	| "NIXMAC_VERSION"
	| "NIX_INSTALLED_OVERRIDE"
	| "VITE_POSTHOG_KEY";

declare const __NIXMAC_PROFILE__: "development" | "release" | "e2e";
declare const __NIXMAC_PROFILE_JSON__: string;

const envBool = z.preprocess((value) => {
	if (typeof value === "boolean") return value;
	if (typeof value === "string") {
		const normalized = value.trim().toLowerCase();
		return normalized === "true" || normalized === "1" || normalized === "yes";
	}
	return false;
}, z.boolean());

const optionalEnvString = z.preprocess((value) => {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}, z.string().optional());

/** Checked-in profile JSON merged with process env at build time (`nixmac-profile.ts`). */
const EnvProfileSchema = z
	.object({
		$schema: z.string().optional(),
		NIXMAC_ENV: z.string().default("development"),
		NIXMAC_VERSION: optionalEnvString,
		VITE_SERVER_URL: optionalEnvString,
		VITE_POSTHOG_KEY: optionalEnvString,
		VITE_POSTHOG_HOST: z.string().default("https://us.i.posthog.com"),
		VITE_NIXMAC_FILESYSTEM: envBool.default(false),
		NIX_INSTALLED_OVERRIDE: envBool.default(false),
		NIXMAC_DISABLE_UPDATER: envBool.default(false),
		VITE_NIXMAC_SKIP_PERMISSIONS: envBool.default(false),
	})
	.passthrough();

type EnvProfile = z.infer<typeof EnvProfileSchema>;

type SettingsType = {
	readonly nixmacEnv: string;
	readonly nixmacVersion: string;
	readonly viteServerUrl?: string;
	readonly posthogKey?: string;
	readonly posthogHost: string;
	readonly filesystemEnabled: boolean;
	readonly nixInstalledOverride?: boolean;
	readonly skipPermissions: boolean;
};

function loadMergedProfile(): EnvProfile {
	try {
		return EnvProfileSchema.parse(JSON.parse(__NIXMAC_PROFILE_JSON__));
	} catch {
		return EnvProfileSchema.parse(development);
	}
}

function toSettings(profile: EnvProfile): SettingsType {
	return {
		nixmacEnv: profile.NIXMAC_ENV,
		nixmacVersion: profile.NIXMAC_VERSION ?? "unknown",
		viteServerUrl: profile.VITE_SERVER_URL,
		posthogKey: profile.VITE_POSTHOG_KEY,
		posthogHost: profile.VITE_POSTHOG_HOST,
		filesystemEnabled: profile.VITE_NIXMAC_FILESYSTEM,
		nixInstalledOverride: profile.NIX_INSTALLED_OVERRIDE ? true : undefined,
		skipPermissions: profile.VITE_NIXMAC_SKIP_PERMISSIONS,
	};
}

const profile = loadMergedProfile();

/** Compile-time profile name selected by `NIXMAC_ENV` (mirrors `build.rs`). */
export const isE2eProfile = __NIXMAC_PROFILE__ === "e2e";

/** Resolved deployment profile for app code. */
export const settings: SettingsType = toSettings(profile);

/** Deployment environment from the baked profile (`NIXMAC_ENV` key). */
export const nixmacEnvironment = settings.nixmacEnv;

/** App version from the merged profile (`NIXMAC_VERSION`). */
export const nixmacVersion = settings.nixmacVersion;

/** Raw merged profile value for ad-hoc reads. */
function getProfileValue(
	key: ProfileLookupKey,
): string | boolean | number | undefined {
	const value = profile[key as keyof EnvProfile];
	if (
		typeof value === "string" ||
		typeof value === "boolean" ||
		typeof value === "number"
	) {
		return value;
	}
	return undefined;
}

export function getWebSiteUrl(): string {
	return settings.viteServerUrl || "https://nixmac.com";
}

console.log("Running with env", import.meta.env);
