import { describe, expect, it } from "vitest";
import {
  APPROVE_IN_LOGIN_ITEMS,
  makeGrantedPermissions,
  makeHelperRow,
} from "@/utils/test-fixtures";
import { computeRepairPlan, type RepairInputs } from "./lib";

function makeInputs(overrides: Partial<RepairInputs> = {}): RepairInputs {
  return {
    completedAt: 1751967600,
    configDir: "/Users/demo/.darwin",
    flakeExists: true,
    nixInstalled: true,
    permissions: makeGrantedPermissions(),
    helperRow: null,
    helperPreference: "unset",
    helperGraceElapsed: false,
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

  it("says nothing about a helper the user never asked for", () => {
    for (const helperPreference of ["unset", "disabled"] as const) {
      const plan = computeRepairPlan(
        makeInputs({
          helperPreference,
          helperRow: makeHelperRow(),
          helperGraceElapsed: true,
        }),
      );
      expect(plan.banners).toEqual([]);
    }
  });

  it("says nothing about a helper that is answering", () => {
    const plan = computeRepairPlan(
      makeInputs({
        helperPreference: "granted",
        helperRow: makeHelperRow({ status: "granted" }),
        helperGraceElapsed: true,
      }),
    );
    expect(plan.banners).toEqual([]);
  });

  it("waits for the grace period before naming the helper", () => {
    const plan = computeRepairPlan(
      makeInputs({
        helperPreference: "granted",
        helperRow: makeHelperRow(),
        helperGraceElapsed: false,
      }),
    );
    expect(plan.banners).toEqual([]);
  });

  it("banners the wanted-but-silent helper with the row's own sentence", () => {
    const plan = computeRepairPlan(
      makeInputs({
        helperPreference: "granted",
        helperRow: makeHelperRow(),
        helperGraceElapsed: true,
      }),
    );
    expect(plan.banners).toEqual([
      { kind: "helper-inactive", instructions: APPROVE_IN_LOGIN_ITEMS },
    ]);
  });

  it("leaves the helper out of the revoked-permissions list", () => {
    const helperRow = makeHelperRow();
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
            helperRow,
          ],
          allRequiredGranted: false,
          checkedAt: 1,
        },
        helperPreference: "granted",
        helperRow,
        helperGraceElapsed: true,
      }),
    );
    expect(plan.banners).toEqual([
      { kind: "permissions-revoked", missing: [{ id: "full-disk", name: "Full Disk Access" }] },
      { kind: "helper-inactive", instructions: APPROVE_IN_LOGIN_ITEMS },
    ]);
  });

  it("produces exactly one banner when only the helper is missing", () => {
    const helperRow = makeHelperRow();
    const plan = computeRepairPlan(
      makeInputs({
        permissions: {
          permissions: [helperRow],
          allRequiredGranted: false,
          checkedAt: 1,
        },
        helperPreference: "granted",
        helperRow,
        helperGraceElapsed: true,
      }),
    );
    expect(plan.banners).toEqual([
      { kind: "helper-inactive", instructions: APPROVE_IN_LOGIN_ITEMS },
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
        helperPreference: "granted",
        helperRow: makeHelperRow(),
        helperGraceElapsed: true,
      }),
    );
    expect(plan).toEqual({ blocking: null, banners: [] });
  });
});
