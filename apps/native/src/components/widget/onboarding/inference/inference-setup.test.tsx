import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { InferenceSetup } from "@/components/widget/onboarding/inference/inference-setup";
import type { AccountBilling } from "@/ipc/types";

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

const emptyBilling: AccountBilling = {
  usage: { currency: "USD", remainingUsd: 0, spentUsd: 0, totalUsd: 0 },
  subscriptions: [],
  hasPaymentMethod: false,
  canUseHostedInference: false,
  canUseDeviceSync: false,
};

const mocks = vi.hoisted(() => ({
  status: vi.fn<() => Promise<AccountStatus>>(),
  sendOtp: vi.fn<(email: string) => Promise<void>>(),
  verifyOtp: vi.fn<(email: string, otp: string, name: string) => Promise<AuthStatus>>(),
  billing: vi.fn<() => Promise<AccountBilling>>(),
  createSubscriptionCheckout: vi.fn<(slug: "payg-tokens" | "pro") => Promise<string>>(),
  captureEvent: vi.fn<(event: unknown) => void>(),
  identify: vi.fn<(id: string, properties: Record<string, unknown>) => void>(),
}));

vi.mock("@/ipc/api", () => ({
  tauriAPI: {
    account: {
      status: () => mocks.status(),
      sendOtp: (email: string) => mocks.sendOtp(email),
      verifyOtp: (email: string, otp: string, name: string) => mocks.verifyOtp(email, otp, name),
      billing: () => mocks.billing(),
      createSubscriptionCheckout: (slug: "payg-tokens" | "pro") =>
        mocks.createSubscriptionCheckout(slug),
    },
    ui: {
      setPrefs: vi.fn<() => Promise<{ ok: boolean }>>().mockResolvedValue({ ok: true }),
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
    mocks.billing.mockResolvedValue(emptyBilling);
    mocks.createSubscriptionCheckout.mockResolvedValue("https://polar.sh/demo-checkout");
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

  it("shows subscription plan selection after sign in", async () => {
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

    expect(await screen.findByText(/choose a plan/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /subscribe to pay as you go/i })).toBeInTheDocument();
    expect(screen.getByText(/device sync across macs/i)).toBeInTheDocument();
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

  it("skips checkout when the account already has an active subscription", async () => {
    mocks.status.mockResolvedValue({
      signedIn: false,
      account: null,
      keyId: null,
      serverUrl: "https://sync.nixmac.app",
      githubReady: true,
      webAccount: { id: "acct_1", email: "ada@example.com" },
    });
    mocks.billing.mockResolvedValue({
      ...emptyBilling,
      subscriptions: [
        {
          id: "sub_1",
          slug: "payg-tokens",
          productId: "prod_payg",
          status: "active",
        },
      ],
      hasPaymentMethod: true,
      canUseHostedInference: true,
    });

    render(<InferenceSetup onConfigured={vi.fn<(config: unknown) => void>()} />);

    expect(
      await screen.findByRole("button", { name: /continue with active subscription/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/choose a plan/i)).not.toBeInTheDocument();
  });
});
