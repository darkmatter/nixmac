import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AddSecretView } from "./add-secret-view";
import { MOCK_VAULT } from "./mock-data";

describe("secret edit recipients", () => {
  it("shows the recipients preserved when an agenix value is updated", () => {
    const secret = MOCK_VAULT.entries.find((entry) => entry.id === "github-token");
    expect(secret).toBeDefined();

    render(
      <AddSecretView
        vault={MOCK_VAULT}
        secret={secret}
        onSubmit={vi.fn<() => void>()}
        onBack={vi.fn<() => void>()}
      />,
    );

    expect(
      screen.getByText("The updated value keeps the recipients recorded for this secret."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Recipient Demo-MacBook-Pro")).toBeInTheDocument();
    expect(screen.getByLabelText("Recipient work-mac-mini")).toBeInTheDocument();
    expect(screen.queryByLabelText("Recipient yubikey-personal")).not.toBeInTheDocument();
  });

  it("shows the current SOPS rule recipients when a SOPS value is updated", () => {
    const secret = MOCK_VAULT.entries.find((entry) => entry.id === "cachix-signing-key");
    expect(secret).toBeDefined();

    render(
      <AddSecretView
        vault={MOCK_VAULT}
        secret={secret}
        onSubmit={vi.fn<() => void>()}
        onBack={vi.fn<() => void>()}
      />,
    );

    expect(
      screen.getByText(/The updated value uses the recipients registered/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Recipient Demo-MacBook-Pro")).toBeInTheDocument();
    expect(screen.getByLabelText("Recipient work-mac-mini")).toBeInTheDocument();
    expect(screen.queryByLabelText("Recipient yubikey-personal")).not.toBeInTheDocument();
  });

  it("shows an unregistered agenix recipient by its public key", () => {
    const existingSecret = MOCK_VAULT.entries.find((entry) => entry.id === "github-token");
    expect(existingSecret).toBeDefined();
    if (!existingSecret) throw new Error("Missing github-token fixture");
    const secret = {
      ...existingSecret,
      publicRecipients: ["age1unregistered"],
    };

    render(
      <AddSecretView
        vault={MOCK_VAULT}
        secret={secret}
        onSubmit={vi.fn<() => void>()}
        onBack={vi.fn<() => void>()}
      />,
    );

    expect(screen.getByLabelText("Recipient age1unregistered")).toBeInTheDocument();
    expect(screen.getByText("Unclassified recipient")).toBeInTheDocument();
  });
});
