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
        }),
      );
      expect(plan.banners).toEqual([]);
    }
  });

  it("says nothing about a helper that is answering", () => {
    const plan = computeRepairPlan(
      makeInputs({
        helperPreference: "granted",
        helperRow: makeHelperRow({ status: "granted", helperPhase: "ready" }),
      }),
    );
    expect(plan.banners).toEqual([]);
  });

  it("banners the wanted helper with the backend's typed phase and copy", () => {
    const plan = computeRepairPlan(
      makeInputs({
        helperPreference: "granted",
        helperRow: makeHelperRow(),
      }),
    );
    expect(plan.banners).toEqual([
      {
        kind: "helper-inactive",
        phase: "approvalRequired",
        instructions: APPROVE_IN_LOGIN_ITEMS,
      },
    ]);
  });

  it("preserves every actionable helper phase", () => {
    for (const phase of [
      "reconciling",
      "waitingForActivation",
      "needsUserAction",
      "failed",
    ] as const) {
      const plan = computeRepairPlan(
        makeInputs({
          helperPreference: "granted",
          helperRow: makeHelperRow({
            helperPhase: phase,
            canRequestProgrammatically: true,
            instructions: `copy for ${phase}`,
          }),
        }),
      );
      expect(plan.banners).toEqual([
        { kind: "helper-inactive", phase, instructions: `copy for ${phase}` },
      ]);
    }
  });

  it("does not treat a crossed disabled row as an intentional opt-out", () => {
    const plan = computeRepairPlan(
      makeInputs({
        helperPreference: "granted",
        helperRow: makeHelperRow({ helperPhase: "disabled" }),
      }),
    );
    expect(plan.banners[0]).toMatchObject({ kind: "helper-inactive", phase: "failed" });
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
      }),
    );
    expect(plan.banners).toEqual([
      { kind: "permissions-revoked", missing: [{ id: "full-disk", name: "Full Disk Access" }] },
      {
        kind: "helper-inactive",
        phase: "approvalRequired",
        instructions: APPROVE_IN_LOGIN_ITEMS,
      },
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
      }),
    );
    expect(plan.banners).toEqual([
      {
        kind: "helper-inactive",
        phase: "approvalRequired",
        instructions: APPROVE_IN_LOGIN_ITEMS,
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
        helperPreference: "granted",
        helperRow: makeHelperRow(),
      }),
    );
    expect(plan).toEqual({ blocking: null, banners: [] });
  });
});
