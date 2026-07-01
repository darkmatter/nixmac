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

declare const __NIXMAC_PROFILE__: "development" | "release" | "e2e";
declare const __NIXMAC_PROFILE_JSON__: string;
