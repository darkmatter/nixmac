import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { InferenceSetup } from "@/components/widget/onboarding/inference/inference-setup";

type AuthStatus = {
  signedIn: boolean;
  account: { email: string };
  credentialId: string;
};

type AccountStatus = {
  signedIn: boolean;
  account: { id: string; email: string } | null;
  keyId: string | null;
  serverUrl: string;
  githubReady: boolean;
  webAccount: { id: string; email: string } | null;
};

const mocks = vi.hoisted(() => ({
  status: vi.fn<() => Promise<AccountStatus>>(),
  sendOtp: vi.fn<(email: string) => Promise<void>>(),
  verifyOtp: vi.fn<(email: string, otp: string, name: string) => Promise<AuthStatus>>(),
  captureEvent: vi.fn<(event: unknown) => void>(),
  identify: vi.fn<(id: string, properties: Record<string, unknown>) => void>(),
  fetch: vi.fn<typeof fetch>(),
}));

vi.mock("@/ipc/api", () => ({
  tauriAPI: {
    account: {
      status: () => mocks.status(),
      sendOtp: (email: string) => mocks.sendOtp(email),
      verifyOtp: (email: string, otp: string, name: string) => mocks.verifyOtp(email, otp, name),
    },
  },
}));

vi.mock("@/lib/telemetry/instance", () => ({
  getTelemetry: () => ({
    captureEvent: mocks.captureEvent,
  }),
}));

vi.mock("posthog-js", () => ({
  default: {
    identify: mocks.identify,
  },
}));

describe("InferenceSetup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.status.mockResolvedValue({
      signedIn: false,
      account: null,
      keyId: null,
      serverUrl: "https://sync.nixmac.app",
      githubReady: false,
      webAccount: null,
    });
    mocks.sendOtp.mockResolvedValue(undefined);
    mocks.verifyOtp.mockResolvedValue({
      signedIn: true,
      account: { email: "ada@example.com" },
      credentialId: "credential-1",
    });
    mocks.fetch.mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            paygProduct: {
              currency: "usd",
              maximumAmountUsd: 500,
              minimumAmountUsd: 5,
              name: "Hosted inference credits",
              productId: "prod_payg",
              slug: "payg-tokens",
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
  });

  it("signs in to hosted inference with an email one-time code", async () => {
    render(<InferenceSetup onConfigured={vi.fn<(config: unknown) => void>()} />);

    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "ada@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send sign-in code/i }));

    await waitFor(() => expect(mocks.sendOtp).toHaveBeenCalledWith("ada@example.com"));

    fireEvent.change(screen.getByLabelText(/verification code/i), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: /verify code and continue/i }));

    await waitFor(() =>
      expect(mocks.verifyOtp).toHaveBeenCalledWith("ada@example.com", "123456", "ada"),
    );
    expect(mocks.identify).toHaveBeenCalledWith("ada@example.com", { email: "ada@example.com" });
    expect(screen.getByText(/signed in as/i)).toBeInTheDocument();
  });

  it("loads the Polar PAYG product and collects a custom top-up amount", async () => {
    render(<InferenceSetup onConfigured={vi.fn<(config: unknown) => void>()} />);

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "ada@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send sign-in code/i }));
    await screen.findByLabelText(/verification code/i);
    fireEvent.change(screen.getByLabelText(/verification code/i), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: /verify code and continue/i }));

    const amount = await screen.findByLabelText(/credit amount/i);
    expect(amount).toHaveValue(25);
    expect(screen.queryByRole("button", { name: /\$25 credit/i })).not.toBeInTheDocument();
    expect(screen.getByText(/hosted inference credits/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/zip code/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/country/i)).toHaveValue("US");
    expect(screen.getByText(/device syncing/i)).toBeInTheDocument();
  });

  it("resumes at payment when a web account is already persisted", async () => {
    mocks.status.mockResolvedValue({
      signedIn: false,
      account: null,
      keyId: null,
      serverUrl: "https://sync.nixmac.app",
      githubReady: true,
      webAccount: { id: "acct_1", email: "ada@example.com" },
    });

    render(<InferenceSetup onConfigured={vi.fn<(config: unknown) => void>()} />);

    expect(await screen.findByText(/signed in as/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /send sign-in code/i })).not.toBeInTheDocument();
    expect(screen.getByText("ada@example.com")).toBeInTheDocument();
  });
});
