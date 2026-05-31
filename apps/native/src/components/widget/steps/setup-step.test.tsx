import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SetupStep } from "@/components/widget/steps/setup-step";
import { useWidgetStore } from "@/stores/widget-store";

const mocks = vi.hoisted(() => ({
  saveHost: vi.fn<(host: string) => Promise<void>>(),
}));

vi.mock("@/components/widget/controls/directory-picker", () => ({
  DirectoryPicker: () => <div data-testid="directory-picker" />,
}));

vi.mock("@/components/widget/controls/bootstrap-config", () => ({
  BootstrapConfig: () => <div data-testid="bootstrap-config" />,
}));

vi.mock("@/hooks/use-darwin-config", () => ({
  useDarwinConfig: () => ({
    saveHost: mocks.saveHost,
  }),
}));

function resetStore() {
  const store = useWidgetStore.getState();
  store.setConfigDir("");
  store.setHosts([]);
  store.setHost("");
  store.setError(null);
}

describe("<SetupStep>", () => {
  beforeEach(() => {
    resetStore();
    mocks.saveHost.mockResolvedValue();
  });

  afterEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  it("saves the displayed host when Next is clicked without reselecting it", () => {
    const store = useWidgetStore.getState();
    store.setConfigDir("/Users/me/.config/nix-darwin");
    store.setHosts(["macbook"]);
    store.setHost("macbook");

    render(<SetupStep />);

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(mocks.saveHost).toHaveBeenCalledWith("macbook");
  });
});
