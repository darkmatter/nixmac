import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { SecretEntry } from "@/ipc/orpc-bindings";
import { MOCK_VAULT } from "./mock-data";
import { SecretDetailView } from "./secret-detail-view";

const renderDetail = (secret: SecretEntry) =>
  render(
    <SecretDetailView
      vault={MOCK_VAULT}
      secret={secret}
      onRotate={vi.fn<() => void>()}
      onEdit={vi.fn<() => void>()}
      onBack={vi.fn<() => void>()}
    />,
  );

describe("secret edit availability", () => {
  it("hides edit and explains why when agenix recipients are unresolved", () => {
    const secret = {
      ...MOCK_VAULT.entries.find((entry) => entry.id === "github-token")!,
      publicRecipients: [],
      publicRecipientsResolved: false,
    };

    renderDetail(secret);

    expect(screen.queryByRole("button", { name: "Edit value" })).not.toBeInTheDocument();
    expect(
      screen.getByText(/Editing is unavailable because age cannot preserve unknown recipients/),
    ).toBeInTheDocument();
  });

  it("hides edit when agenix recipient metadata resolves to no recipients", () => {
    const secret = {
      ...MOCK_VAULT.entries.find((entry) => entry.id === "github-token")!,
      publicRecipients: [],
      publicRecipientsResolved: true,
    };

    renderDetail(secret);

    expect(screen.queryByRole("button", { name: "Edit value" })).not.toBeInTheDocument();
    expect(
      screen.getByText(/Editing is unavailable until its recipients can be resolved/),
    ).toBeInTheDocument();
  });

  it("keeps edit available for agenix secrets with known recipients", () => {
    const secret = MOCK_VAULT.entries.find((entry) => entry.id === "github-token")!;

    renderDetail(secret);

    expect(screen.getByRole("button", { name: "Edit value" })).toBeInTheDocument();
  });
});
