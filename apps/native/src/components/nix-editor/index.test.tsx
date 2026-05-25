import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const mockSave = vi.fn<() => void>();
  const mockUseNixEditor = vi.fn();

  return { mockSave, mockUseNixEditor };
});

vi.mock("./use-nix-editor", () => ({
  useNixEditor: h.mockUseNixEditor,
}));

import { NixEditor } from "./index";

function mockEditorState(overrides: Partial<ReturnType<typeof h.mockUseNixEditor>> = {}) {
  h.mockUseNixEditor.mockReturnValue({
    isLoading: false,
    isDirty: false,
    error: null,
    lspStatus: "off",
    save: h.mockSave,
    ...overrides,
  });
}

describe("<NixEditor>", () => {
  beforeEach(() => {
    h.mockSave.mockReset();
    h.mockUseNixEditor.mockReset();
  });

  it("renders a disabled Save button when the editor is clean", () => {
    mockEditorState();

    render(<NixEditor filePath="configuration.nix" />);

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.queryByText("Unsaved")).not.toBeInTheDocument();
  });

  it("enables Save when dirty and invokes save on click", () => {
    mockEditorState({ isDirty: true });

    render(<NixEditor filePath="configuration.nix" />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(h.mockSave).toHaveBeenCalledTimes(1);
  });
});
