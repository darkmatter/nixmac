import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createVerifiedApiKeyHandler,
  verifyOpenaiApiKey,
  verifyOpenrouterApiKey,
  type ApiKeyStatus,
} from "./api-key-verification";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: unknown) => Promise<boolean>>(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));

const okResponse = { ok: true } as Response;
type FetchLike = (input: string, init?: RequestInit) => Promise<Pick<Response, "ok">>;
type SaveKey = (key: string) => Promise<void>;
type VerifyKey = (key: string) => Promise<boolean>;

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
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(okResponse);

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
    const saveKey = vi.fn<SaveKey>();
    const verifyKey = vi.fn<VerifyKey>();
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
    const saveKey = vi.fn<SaveKey>(async (key) => {
      events.push(`save:${key}`);
    });
    const verifyKey = vi.fn<VerifyKey>().mockResolvedValue(true);
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
    const saveKey = vi.fn<SaveKey>();
    const verifyKey = vi.fn<VerifyKey>().mockResolvedValue(false);
    const handleKey = createVerifiedApiKeyHandler({
      saveKey,
      setStatus: (status) => statuses.push(status),
      verifyKey,
    });

    await handleKey("sk-bad");

    expect(statuses).toEqual(["verifying", "invalid"]);
    expect(saveKey).not.toHaveBeenCalled();
  });

  it("marks verified keys invalid when saving fails", async () => {
    const statuses: ApiKeyStatus[] = [];
    const saveKey = vi.fn<SaveKey>().mockRejectedValue(new Error("keychain denied"));
    const verifyKey = vi.fn<VerifyKey>().mockResolvedValue(true);
    const handleKey = createVerifiedApiKeyHandler({
      saveKey,
      setStatus: (status) => statuses.push(status),
      verifyKey,
    });

    await handleKey("sk-openai");

    expect(statuses).toEqual(["verifying", "invalid"]);
    expect(saveKey).toHaveBeenCalledWith("sk-openai");
  });

  it("marks blank keys invalid when clearing storage fails", async () => {
    const statuses: ApiKeyStatus[] = [];
    const saveKey = vi.fn<SaveKey>().mockRejectedValue(new Error("keychain denied"));
    const verifyKey = vi.fn<VerifyKey>();
    const handleKey = createVerifiedApiKeyHandler({
      saveKey,
      setStatus: (status) => statuses.push(status),
      verifyKey,
    });

    await handleKey("");

    expect(statuses).toEqual(["idle", "invalid"]);
    expect(saveKey).toHaveBeenCalledWith("");
    expect(verifyKey).not.toHaveBeenCalled();
  });

  it("ignores stale verification results after a newer edit", async () => {
    const events: string[] = [];
    const saveKey = vi.fn<SaveKey>(async (key) => {
      events.push(`save:${key}`);
    });
    let resolveVerification: (valid: boolean) => void = () => {};
    const verifyKey = vi.fn<VerifyKey>(
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

  it("replays a newer clear after an older verified save has already started", async () => {
    const events: string[] = [];
    let resolveFirstSave: () => void = () => {};
    const saveKey = vi.fn<SaveKey>(async (key) => {
      events.push(`save:start:${key}`);
      if (key === "sk-old") {
        await new Promise<void>((resolve) => {
          resolveFirstSave = resolve;
        });
      }
      events.push(`save:end:${key}`);
    });
    const verifyKey = vi.fn<VerifyKey>().mockResolvedValue(true);
    const handleKey = createVerifiedApiKeyHandler({
      saveKey,
      setStatus: (status) => events.push(`status:${status}`),
      verifyKey,
    });

    const oldSave = handleKey("sk-old");
    await Promise.resolve();
    await Promise.resolve();
    expect(saveKey).toHaveBeenCalledWith("sk-old");

    const clearSave = handleKey("");
    await Promise.resolve();
    expect(saveKey).toHaveBeenCalledTimes(1);

    resolveFirstSave();
    await Promise.all([oldSave, clearSave]);

    expect(saveKey.mock.calls.map(([key]) => key)).toEqual(["sk-old", ""]);
    expect(events).toEqual([
      "status:verifying",
      "save:start:sk-old",
      "status:idle",
      "save:end:sk-old",
      "save:start:",
      "save:end:",
    ]);
  });
});
