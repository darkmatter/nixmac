import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { SecretsVaultState } from "@/ipc/orpc-bindings";
import { MOCK_VAULT } from "./mock-data";
import { SecretsManagementRoute } from "./secrets-management";

const mocks = vi.hoisted(() => ({
  state: { current: null as SecretsVaultState | null },
}));

vi.mock("@nixmac/state", () => ({
  selectSecretsVaultState: vi.fn<(state: unknown) => unknown>(),
  useViewModel: vi.fn<(_selector: unknown) => SecretsVaultState | null>(
    () => mocks.state.current,
  ),
}));

vi.mock("@/viewmodel/secrets-vault", () => ({
  startSecretsVaultSync: vi.fn<() => Promise<() => void>>(async () => () => {}),
}));

vi.mock("@/lib/orpc", () => ({
  client: { secrets: { refresh: vi.fn<() => Promise<void>>() } },
}));

describe("SecretsManagementRoute", () => {
  it("keeps the current screen mounted while the vault refreshes", () => {
    mocks.state.current = {
      vault: MOCK_VAULT,
      activated: true,
      loading: false,
      error: null,
    };
    const { rerender } = render(<SecretsManagementRoute />);

    fireEvent.click(screen.getByRole("button", { name: "Add secret" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "demo2" } });

    mocks.state.current = {
      vault: null,
      activated: true,
      loading: true,
      error: null,
    };
    rerender(<SecretsManagementRoute />);

    expect(screen.getByLabelText("Name")).toHaveValue("demo2");
    expect(screen.queryByText("Loading secrets…")).not.toBeInTheDocument();
  });
});
