import { describe, expect, it } from "vitest";
import { makeGrantedPermissions } from "@/utils/test-fixtures";
import { computeRepairPlan, type RepairInputs } from "./lib";

function makeInputs(overrides: Partial<RepairInputs> = {}): RepairInputs {
  return {
    completedAt: 1751967600,
    configDir: "/Users/demo/.darwin",
    flakeExists: true,
    nixInstalled: true,
    permissions: makeGrantedPermissions(),
    skipPermissions: false,
    nixInstalledOverride: false,
    ...overrides,
  };
}

describe("computeRepairPlan", () => {
  it("reports nothing for a healthy completed profile", () => {
    expect(computeRepairPlan(makeInputs())).toEqual({ blocking: null, banners: [] });
  });

  it("reports nothing before onboarding completed, whatever the facts", () => {
    const inputs = makeInputs({
      completedAt: null,
      flakeExists: false,
      nixInstalled: false,
    });
    expect(computeRepairPlan(inputs)).toEqual({ blocking: null, banners: [] });
  });

  it("blocks when the configured flake is gone", () => {
    const plan = computeRepairPlan(makeInputs({ flakeExists: false }));
    expect(plan.blocking).toEqual({
      kind: "config-missing",
      configDir: "/Users/demo/.darwin",
    });
  });

  it("does not block when the probe was unavailable", () => {
    expect(computeRepairPlan(makeInputs({ flakeExists: null })).blocking).toBeNull();
  });

  it("banners a missing nix install without blocking", () => {
    const plan = computeRepairPlan(makeInputs({ nixInstalled: false }));
    expect(plan.blocking).toBeNull();
    expect(plan.banners).toEqual([{ kind: "nix-missing" }]);
  });

  it("banners revoked required permissions with their names", () => {
    const plan = computeRepairPlan(
      makeInputs({
        permissions: {
          permissions: [
            {
              id: "full-disk",
              name: "Full Disk Access",
              description: "",
              required: true,
              canRequestProgrammatically: true,
              status: "denied",
            },
            {
              id: "app-management",
              name: "App Management",
              description: "",
              required: false,
              canRequestProgrammatically: false,
              status: "denied",
            },
          ],
          allRequiredGranted: false,
          checkedAt: 1,
        },
      }),
    );
    expect(plan.banners).toEqual([
      {
        kind: "permissions-revoked",
        missing: [{ id: "full-disk", name: "Full Disk Access" }],
      },
    ]);
  });

  it("honors the dev-profile skip overrides", () => {
    const plan = computeRepairPlan(
      makeInputs({
        nixInstalled: false,
        nixInstalledOverride: true,
        skipPermissions: true,
        permissions: {
          permissions: [],
          allRequiredGranted: false,
          checkedAt: 1,
        },
      }),
    );
    expect(plan).toEqual({ blocking: null, banners: [] });
  });
});
