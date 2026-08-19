import { describe, expect, it } from "vitest";
import { EnvProfileSchema, type NixmacEnv } from "./env-profile-schema";
import { settings, toSettings } from "./env";

function profile(env: NixmacEnv, overrides: Record<string, unknown> = {}) {
  return EnvProfileSchema.parse({ NIXMAC_ENV: env, ...overrides });
}

describe("toSettings", () => {
  it("refuses to skip permissions in a production build, whatever the profile says", () => {
    const settingsForProd = toSettings(
      profile("production", { VITE_NIXMAC_SKIP_PERMISSIONS: true }),
    );
    expect(settingsForProd.skipPermissions).toBe(false);
  });

  it("refuses the nix-installed bypass in a production build", () => {
    const settingsForProd = toSettings(
      profile("production", { NIX_INSTALLED_OVERRIDE: true }),
    );
    expect(settingsForProd.nixInstalledOverride).toBeUndefined();
  });

  it("honours both bypasses outside production", () => {
    for (const env of ["development", "e2e"] as const) {
      const bypassed = toSettings(
        profile(env, {
          VITE_NIXMAC_SKIP_PERMISSIONS: true,
          NIX_INSTALLED_OVERRIDE: true,
        }),
      );
      expect(bypassed.skipPermissions).toBe(true);
      expect(bypassed.nixInstalledOverride).toBe(true);
    }
  });

  it("leaves the bypasses off when the profile does not ask for them", () => {
    for (const env of ["development", "production", "e2e"] as const) {
      const plain = toSettings(profile(env));
      expect(plain.skipPermissions).toBe(false);
      expect(plain.nixInstalledOverride).toBeUndefined();
    }
  });
});

describe("baked profile", () => {
  // Fails if the define stops arriving or a fallback profile creeps back in.
  // Vitest resolves the defines exactly as the app build does; the selector is
  // `development` inside the devenv shell (nix/dev.nix) and unset in CI, and
  // both pick env.development.json.
  it("resolves to the development profile under vitest", () => {
    expect(settings.nixmacEnv).toBe("development");
  });
});
