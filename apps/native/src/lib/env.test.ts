import { describe, expect, it } from "vitest";
import { settings } from "./env";

// A Vite `define` is raw text substitution. If its value is not itself a JSON
// *string* literal, it lands in the bundle as a bare object literal and the
// `JSON.parse(__NIXMAC_PROFILE_JSON__)` in ./env.ts throws on it. These tests
// pin the encoding: vitest.config.ts applies the same defines as the app build
// (`define: nixmacBuildDefines(import.meta.dirname)`).
declare const __NIXMAC_PROFILE_JSON__: string;

describe("__NIXMAC_PROFILE_JSON__ define", () => {
  it("substitutes as a string literal, not an object literal", () => {
    const raw: unknown = __NIXMAC_PROFILE_JSON__;
    expect(typeof raw).toBe("string");
  });

  it("round-trips into settings, so no fallback profile was used", () => {
    const parsed = JSON.parse(__NIXMAC_PROFILE_JSON__) as { NIXMAC_ENV: string };
    expect(settings.nixmacEnv).toBe(parsed.NIXMAC_ENV);
  });
});
