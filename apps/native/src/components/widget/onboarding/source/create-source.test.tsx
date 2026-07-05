import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CreateSource } from "@/components/widget/onboarding/source/create-source";
import { uiActions } from "@nixmac/state";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

type SetDirResult = { dir: string; changed: boolean };

const mockNormalize = vi.fn<(input: string) => Promise<string>>();
const mockPrepareNewDir = vi.fn<(dir: string) => Promise<SetDirResult>>();
const mockBootstrapDefault =
  vi.fn<(hostname: string, templateId: string | null) => Promise<void>>();
const mockCreateFromTemplate =
  vi.fn<(templateRef: string, hostname: string, dirName: string | null) => Promise<SetDirResult>>();
const mockSetHostAttr = vi.fn<(host: string) => Promise<void>>();
const mockGetThisHostname = vi.fn<() => Promise<string>>();

vi.mock("@/lib/orpc", async () => {
  const { createTanstackQueryUtils } = await import("@orpc/tanstack-query");
  const client = {
    path: {
      normalize: ({ input }: { input: string }) => mockNormalize(input),
    },
    config: {
      prepareNewDir: ({ dir }: { dir: string }) => mockPrepareNewDir(dir),
      createFromTemplate: ({
        templateRef,
        hostname,
        dirName,
      }: {
        templateRef: string;
        hostname: string;
        dirName: string | null;
      }) => mockCreateFromTemplate(templateRef, hostname, dirName),
      setHostAttr: ({ host }: { host: string }) => mockSetHostAttr(host),
      getThisHostname: () => mockGetThisHostname(),
    },
    flake: {
      bootstrapDefault: ({
        hostname,
        templateId,
      }: {
        hostname: string;
        templateId: string | null;
      }) => mockBootstrapDefault(hostname, templateId),
    },
  };
  return { client, orpc: createTanstackQueryUtils(client) };
});

function renderCreateSource(onCreated?: () => void) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <CreateSource onCreated={onCreated} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  uiActions.setError(null);
  mockNormalize.mockImplementation(async (input) => input);
  mockPrepareNewDir.mockResolvedValue({ dir: "/etc/nix-darwin", changed: true });
  mockBootstrapDefault.mockResolvedValue();
  mockCreateFromTemplate.mockResolvedValue({ dir: "/etc/nix-darwin", changed: true });
  mockSetHostAttr.mockResolvedValue();
  mockGetThisHostname.mockResolvedValue("demo-mac");
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("CreateSource", () => {
  it("scaffolds the default bundled template", async () => {
    const onCreated = vi.fn<() => void>();
    renderCreateSource(onCreated);

    await act(async () => {
      fireEvent.click(screen.getByTestId("create-default-config-button"));
    });

    await waitFor(() =>
      expect(mockBootstrapDefault).toHaveBeenCalledWith(
        expect.any(String),
        "nix-darwin-determinate",
      ),
    );
    expect(mockPrepareNewDir).toHaveBeenCalled();
    expect(mockCreateFromTemplate).not.toHaveBeenCalled();
    expect(onCreated).toHaveBeenCalled();
  });

  it("blocks custom-template creation until the ref is valid", async () => {
    renderCreateSource();

    fireEvent.click(screen.getByTestId("create-custom-template-card"));
    const createButton = screen.getByTestId("create-default-config-button");
    expect(createButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Template repository"), {
      target: { value: "github:owner/repo/branch" },
    });
    expect(createButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Template repository"), {
      target: { value: "github:owner/repo?dir=templates/mac" },
    });
    expect(createButton).toBeEnabled();
  });

  it("creates from a custom template atomically", async () => {
    const onCreated = vi.fn<() => void>();
    renderCreateSource(onCreated);

    fireEvent.click(screen.getByTestId("create-custom-template-card"));
    fireEvent.change(screen.getByLabelText("Template repository"), {
      target: { value: "github:owner/repo?dir=templates/mac" },
    });
    fireEvent.change(screen.getByLabelText("Name this Mac"), {
      target: { value: "my-mac" },
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("create-default-config-button"));
    });

    await waitFor(() =>
      expect(mockCreateFromTemplate).toHaveBeenCalledWith(
        "github:owner/repo?dir=templates/mac",
        "my-mac",
        "/etc/nix-darwin",
      ),
    );
    // The atomic command owns target preparation and the host attribute;
    // neither prepareNewDir nor a client-side hostAttr reset may run.
    expect(mockPrepareNewDir).not.toHaveBeenCalled();
    expect(mockBootstrapDefault).not.toHaveBeenCalled();
    expect(mockSetHostAttr).not.toHaveBeenCalled();
    expect(onCreated).toHaveBeenCalled();
  });

  it("surfaces custom-template errors inline", async () => {
    const onCreated = vi.fn<() => void>();
    mockCreateFromTemplate.mockRejectedValue(
      new Error("No flake.nix found in the template repository."),
    );
    renderCreateSource(onCreated);

    fireEvent.click(screen.getByTestId("create-custom-template-card"));
    fireEvent.change(screen.getByLabelText("Template repository"), {
      target: { value: "owner/repo" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("create-default-config-button"));
    });

    await waitFor(() =>
      expect(screen.getByText(/No flake.nix found/i)).toBeInTheDocument(),
    );
    expect(onCreated).not.toHaveBeenCalled();
  });
});
