import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useWidgetStore } from "@/stores/widget-store";
import { SetupStep } from "./setup-step";

const mockSaveHost = vi.hoisted(() => vi.fn<(host: string) => Promise<void>>());

vi.mock("@/lib/env", () => ({
  settings: {
    NIX_INSTALLED_OVERRIDE: false,
  },
}));

vi.mock("@/hooks/use-darwin-config", () => ({
  useDarwinConfig: () => ({
    saveHost: mockSaveHost,
  }),
}));

vi.mock("@/components/widget/controls/directory-picker", () => ({
  DirectoryPicker: ({ label }: { label: string }) => (
    <div data-testid="directory-picker">{label}</div>
  ),
}));

vi.mock("@/components/widget/controls/bootstrap-config", () => ({
  BootstrapConfig: ({ label }: { label: string }) => (
    <div data-testid="bootstrap-config">{label}</div>
  ),
}));

function resetStore() {
  const store = useWidgetStore.getState();
  store.setConfigDir("");
  store.setHosts([]);
  store.setHost("");
  store.setError(null);
  store.setBootstrapping(false);
}

describe("<SetupStep>", () => {
  beforeEach(() => {
    mockSaveHost.mockReset();
    resetStore();
  });

  it("persists the displayed host when Next is clicked without changing the dropdown", async () => {
    const store = useWidgetStore.getState();
    store.setConfigDir("/Users/me/.darwin");
    store.setHosts(["mbp"]);
    store.setHost("mbp");

    render(<SetupStep />);

    fireEvent.click(await screen.findByRole("button", { name: "Next" }));

    expect(mockSaveHost).toHaveBeenCalledWith("mbp");
    expect(mockSaveHost).not.toHaveBeenCalledWith("");
  });

  it("does not allow Next to persist an empty host", async () => {
    const store = useWidgetStore.getState();
    store.setConfigDir("/Users/me/.darwin");
    store.setHosts(["mbp"]);

    render(<SetupStep />);

    expect(await screen.findByRole("button", { name: "Next" })).toBeDisabled();
  });
});
