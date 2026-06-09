import { describe, expect, it, vi } from "vitest";
import {
  createVerifiedApiKeyHandler,
  verifyOpenaiApiKey,
  verifyOpenrouterApiKey,
  type ApiKeyStatus,
} from "./api-key-verification";

const okResponse = { ok: true } as Response;
const unauthorizedResponse = { ok: false } as Response;

describe("api key verification", () => {
  it("verifies OpenAI keys against the direct OpenAI models endpoint", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse);

    await expect(verifyOpenaiApiKey("sk-openai", fetchImpl)).resolves.toBe(true);

    expect(fetchImpl).toHaveBeenCalledWith("https://api.openai.com/v1/models", {
      headers: { Authorization: "Bearer sk-openai" },
      method: "GET",
    });
  });

  it("treats non-OK OpenAI verification responses as invalid", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(unauthorizedResponse);

    await expect(verifyOpenaiApiKey("sk-openai", fetchImpl)).resolves.toBe(false);
  });

  it("does not call OpenAI for blank keys", async () => {
    const fetchImpl = vi.fn();

    await expect(verifyOpenaiApiKey("   ", fetchImpl)).resolves.toBe(false);

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("treats OpenAI network errors as invalid", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("offline"));

    await expect(verifyOpenaiApiKey("sk-openai", fetchImpl)).resolves.toBe(false);
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
