/// <reference types="vite/client" />

interface ViteTypeOptions {
  strictImportMetaEnv: unknown;
}

/**
 * Vite / Storybook / Vitest tooling only. App config lives in committed env profiles
 * (`env.{development,release,e2e}.json`) resolved via `lib/env.ts`.
 */
interface ImportMetaEnv {
  readonly VITE_CREEVEY_SKIP_REGEX?: string;
  readonly STORYBOOK?: string;
  readonly VITEST?: string;
}

/**
 * The selected deployment profile, substituted by `nixmac-profile.ts` as a
 * JavaScript object literal. Typed `unknown` on purpose: `lib/env.ts` parses it
 * against `EnvProfileSchema`, so the shape is checked rather than declared.
 */
declare const __NIXMAC_PROFILE_DATA__: unknown;
