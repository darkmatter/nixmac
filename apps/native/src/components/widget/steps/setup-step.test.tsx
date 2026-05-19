import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useWidgetStore } from "@/stores/widget-store";
import { SetupStep } from "./setup-step";

const mockSaveHost = vi.fn<(host: string) => Promise<void>>();

vi.mock("@/hooks/use-darwin-config", () => ({
  useDarwinConfig: () => ({
    saveHost: mockSaveHost,
  }),
}));

vi.mock("@/components/widget/controls/directory-picker", () => ({
  DirectoryPicker: () => <div data-testid="directory-picker" />,
}));

vi.mock("@/components/widget/controls/bootstrap-config", () => ({
  BootstrapConfig: () => <div data-testid="bootstrap-config" />,
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
    mockSaveHost.mockReset();
    mockSaveHost.mockResolvedValue();
  });

  it("persists the displayed host when Next is clicked without changing the dropdown", async () => {
    const store = useWidgetStore.getState();
    store.setConfigDir("/Users/me/.nixmac");
    store.setHosts(["mbp"]);
    store.setHost("mbp");

    render(<SetupStep />);

    const next = await screen.findByRole("button", { name: "Next" });
    fireEvent.click(next);

    await waitFor(() => expect(mockSaveHost).toHaveBeenCalledWith("mbp"));
    expect(mockSaveHost).not.toHaveBeenCalledWith("");
  });
});
