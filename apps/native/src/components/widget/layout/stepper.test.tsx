import { Stepper } from "@/components/widget/layout/stepper";
import type { EvolveState, GitStatus } from "@/ipc/types";
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

// A git status carrying one change, so the stepper sees a real diff (without it
// the stepper collapses progress to "begin" — there's nothing to review/save).
function gitWithChanges(): GitStatus {
  return {
    files: [],
    branch: "main",
    diff: "",
    additions: 1,
    deletions: 0,
    headCommitHash: null,
    cleanHead: false,
    changes: [
      { id: 1, hash: "h1", filename: "configuration.nix", diff: "", lineCount: 1, createdAt: 0, ownSummaryId: 0 },
    ],
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
    viewModelActions.setState({
      evolve: makeEvolveState({ step: "commit" }),
      git: gitWithChanges(),
    });

    render(<Stepper />);

    fireEvent.click(screen.getByRole("button", { name: "Go to Review step" }));

    expect(uiActions.getState().activeStepOverride).toBe("evolve");
  });

  it("clears the override when clicking the live backend step", () => {
    viewModelActions.setState({
      evolve: makeEvolveState({ step: "commit" }),
      git: gitWithChanges(),
    });

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

  it("shows Review as the active destination when saved updates need a build", () => {
    viewModelActions.setState({
      evolve: makeEvolveState({ step: "begin" }),
      git: { ...gitWithChanges(), changes: [], cleanHead: true },
      build: {
        externalBuildDetected: false,
        upstreamUpdateAvailable: false,
        rebuildNeeded: true,
      },
    });

    render(<Stepper />);

    expect(screen.getByRole("list", { name: /step 2 of 3, Review/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Go to Review step" })).toHaveAttribute(
      "aria-current",
      "step",
    );
  });

  it("stays visible while generating, with navigation locked", () => {
    viewModelActions.setState({
      evolve: makeEvolveState({ step: "commit" }),
      git: gitWithChanges(),
    });
    act(() => {
      uiActions.setState({ isGenerating: true });
    });

    render(<Stepper />);

    // Visible as context above the evolve overlay...
    expect(screen.getByRole("list", { name: /Progress/ })).toBeInTheDocument();
    // ...but no step can be selected while the run is active.
    expect(screen.getByRole("button", { name: "Go to Describe step" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Go to Review step" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Go to Save step" })).toBeDisabled();
  });

  it("animates the connector out of the current step while generating", () => {
    viewModelActions.setState({
      evolve: makeEvolveState({ step: "begin" }),
    });

    const { rerender } = render(<Stepper />);
    expect(screen.queryByTestId("stepper-transition")).toBeNull();

    act(() => {
      uiActions.setState({ isGenerating: true });
    });
    rerender(<Stepper />);

    expect(screen.getByTestId("stepper-transition")).toBeInTheDocument();
  });

  it("collapses progress to the prompt step when there is no diff", () => {
    // An active, committable session but an empty working tree: there is nothing
    // to review or save, so Review and Save must stay locked.
    viewModelActions.setState({
      evolve: makeEvolveState({ step: "commit", committable: true }),
      git: null,
    });

    render(<Stepper />);

    expect(screen.getByRole("button", { name: "Go to Save step" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Go to Review step" })).toBeDisabled();
  });
});
