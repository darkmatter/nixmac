import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createVerifiedApiKeyHandler,
  verifyOpenaiApiKey,
  verifyOpenrouterApiKey,
  type ApiKeyStatus,
} from "./api-key-verification";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));

const okResponse = { ok: true } as Response;

describe("api key verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("verifies OpenAI keys through the Tauri backend", async () => {
    mocks.invoke.mockResolvedValueOnce(true);

    await expect(verifyOpenaiApiKey(" sk-openai ")).resolves.toBe(true);

    expect(mocks.invoke).toHaveBeenCalledWith("verify_openai_api_key", {
      apiKey: "sk-openai",
    });
  });

  it("treats rejected OpenAI verification commands as invalid", async () => {
    mocks.invoke.mockRejectedValueOnce(new Error("offline"));

    await expect(verifyOpenaiApiKey("sk-openai")).resolves.toBe(false);
  });

  it("does not call OpenAI for blank keys", async () => {
    await expect(verifyOpenaiApiKey("   ")).resolves.toBe(false);

    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("preserves OpenRouter endpoint and authorization behavior", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse);

    await expect(verifyOpenrouterApiKey("sk-or", fetchImpl)).resolves.toBe(true);

    expect(fetchImpl).toHaveBeenCalledWith("https://openrouter.ai/api/v1/auth/key", {
      headers: { Authorization: "Bearer sk-or" },
      method: "GET",
    });
  });
});

describe("verified API key save flow", () => {
  it("clears stored key and resets to idle for blank keys", async () => {
    const statuses: ApiKeyStatus[] = [];
    const saveKey = vi.fn();
    const verifyKey = vi.fn();
    const handleKey = createVerifiedApiKeyHandler({
      saveKey,
      setStatus: (status) => statuses.push(status),
      verifyKey,
    });

    await handleKey("   ");

    expect(statuses).toEqual(["idle"]);
    expect(saveKey).toHaveBeenCalledWith("");
    expect(verifyKey).not.toHaveBeenCalled();
  });

  it("saves trimmed keys only after successful verification", async () => {
    const events: string[] = [];
    const saveKey = vi.fn(async (key: string) => {
      events.push(`save:${key}`);
    });
    const verifyKey = vi.fn().mockResolvedValue(true);
    const handleKey = createVerifiedApiKeyHandler({
      saveKey,
      setStatus: (status) => events.push(`status:${status}`),
      verifyKey,
    });

    await handleKey("  sk-openai  ");

    expect(events).toEqual(["status:verifying", "save:sk-openai", "status:valid"]);
    expect(verifyKey).toHaveBeenCalledWith("sk-openai");
    expect(saveKey).toHaveBeenCalledWith("sk-openai");
  });

  it("marks invalid keys without saving them", async () => {
    const statuses: ApiKeyStatus[] = [];
    const saveKey = vi.fn();
    const verifyKey = vi.fn().mockResolvedValue(false);
    const handleKey = createVerifiedApiKeyHandler({
      saveKey,
      setStatus: (status) => statuses.push(status),
      verifyKey,
    });

    await handleKey("sk-bad");

    expect(statuses).toEqual(["verifying", "invalid"]);
    expect(saveKey).not.toHaveBeenCalled();
  });

  it("ignores stale verification results after a newer edit", async () => {
    const events: string[] = [];
    const saveKey = vi.fn(async (key: string) => {
      events.push(`save:${key}`);
    });
    let resolveVerification: (valid: boolean) => void = () => {};
    const verifyKey = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveVerification = resolve;
        }),
    );
    const handleKey = createVerifiedApiKeyHandler({
      saveKey,
      setStatus: (status) => events.push(`status:${status}`),
      verifyKey,
    });

    const inFlightVerification = handleKey("sk-old");
    await Promise.resolve();
    await handleKey("");
    resolveVerification(true);
    await inFlightVerification;

    expect(events).toEqual(["status:verifying", "status:idle", "save:"]);
    expect(saveKey).toHaveBeenCalledTimes(1);
    expect(saveKey).toHaveBeenCalledWith("");
  });
});
