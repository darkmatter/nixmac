import { Stepper } from "@/components/widget/layout/stepper";
import type { EvolveState } from "@/ipc/types";
import {
  makeGlobalPreferences,
  makeGrantedPermissions,
  makeNixInstallState,
} from "@/utils/test-fixtures";
import { initialUiState, uiActions, viewModelActions } from "@nixmac/state";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

function makeEvolveState(overrides: Partial<EvolveState> = {}): EvolveState {
  return {
    evolutionId: null,
    currentChangesetId: null,
    committable: false,
    backupBranch: null,
    rollbackBranch: null,
    rollbackStorePath: null,
    rollbackChangesetId: null,
    step: "begin",
    lastEvolutionState: null,
    ...overrides,
  };
}

describe("Stepper", () => {
  beforeEach(() => {
    act(() => {
      uiActions.setState({ ...initialUiState });
      viewModelActions.setState({
        preferences: makeGlobalPreferences({
          configDir: "/Users/test/nixmac",
          hostAttr: "Test-MacBook",
        }),
        hosts: ["Test-MacBook"],
        permissions: makeGrantedPermissions(),
        permissionsHydrated: true,
        nixInstall: makeNixInstallState(),
        rebuildStatus: null,
      });
    });
  });

  it("lets the user click back to a previous step, setting an override", () => {
    viewModelActions.setState({ evolve: makeEvolveState({ step: "commit" }) });

    render(<Stepper />);

    fireEvent.click(screen.getByRole("button", { name: "Go to Review step" }));

    expect(uiActions.getState().activeStepOverride).toBe("evolve");
  });

  it("clears the override when clicking the live backend step", () => {
    viewModelActions.setState({ evolve: makeEvolveState({ step: "commit" }) });

    render(<Stepper />);

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Go to Review step" }));
    });
    expect(uiActions.getState().activeStepOverride).toBe("evolve");

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Go to Save step" }));
    });

    expect(uiActions.getState().activeStepOverride).toBeNull();
  });

  it("does not allow selecting a step ahead of the backend", () => {
    viewModelActions.setState({ evolve: makeEvolveState({ step: "begin" }) });

    render(<Stepper />);

    expect(screen.getByRole("button", { name: "Go to Save step" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Go to Review step" })).toBeDisabled();
  });
});
