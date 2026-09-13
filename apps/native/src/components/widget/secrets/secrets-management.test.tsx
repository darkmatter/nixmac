import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { SecretsVault } from "@/ipc/orpc-bindings";
import { MOCK_VAULT } from "./mock-data";
import { SecretsManagement } from "./secrets-management";

vi.mock("@/lib/orpc", () => ({
  client: {
    secrets: {
      decryptSecret: vi.fn<() => Promise<string>>(),
      refresh: vi.fn<() => Promise<void>>(),
    },
  },
}));

describe("SecretsManagement secret selection", () => {
  it("selects secrets by backend and id when backends contain the same id", () => {
    const sharedEntries: SecretsVault["entries"] = [
      {
        ...MOCK_VAULT.entries[3]!,
        id: "shared-secret",
        name: "shared-secret",
        backend: "sops",
        file: "secrets/shared.yaml",
        sopsKey: "shared_secret",
      },
      {
        ...MOCK_VAULT.entries[0]!,
        id: "shared-secret",
        name: "shared-secret",
        backend: "agenix",
        file: "secrets/shared.age",
        sopsKey: null,
      },
    ];
    const vault: SecretsVault = { ...MOCK_VAULT, entries: sharedEntries };

    render(<SecretsManagement vault={vault} />);

    fireEvent.click(screen.getByRole("button", { name: "Open shared-secret (agenix)" }));

    expect(screen.getByText("secrets/shared.age")).toBeInTheDocument();
    expect(screen.getByText("agenix")).toBeInTheDocument();
    expect(screen.queryByText("secrets/shared.yaml")).not.toBeInTheDocument();
  });
});
