import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG_DIR, STARTER_TEMPLATES } from "./flake-ref";

describe("DEFAULT_CONFIG_DIR", () => {
  it("uses the canonical nix-darwin location", () => {
    expect(DEFAULT_CONFIG_DIR).toBe("/etc/nix-darwin");
  });
});

describe("STARTER_TEMPLATES", () => {
  it("points the scratch flow at the bundled starter templates", () => {
    expect(STARTER_TEMPLATES.map((template) => template.id)).toEqual([
      "nix-darwin-determinate",
      "nixos-unified",
      "flake-parts",
    ]);
  });

  it("keeps the embedded nix-darwin template as the recommended default", () => {
    expect(STARTER_TEMPLATES[0]).toMatchObject({
      id: "nix-darwin-determinate",
      recommended: true,
    });
  });
});
