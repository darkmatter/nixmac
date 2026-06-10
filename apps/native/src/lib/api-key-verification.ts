import { invoke } from "@tauri-apps/api/core";

export type ApiKeyStatus = "idle" | "verifying" | "valid" | "invalid";

type FetchLike = (input: string, init?: RequestInit) => Promise<Pick<Response, "ok">>;
type VerifyKeyLike = (key: string) => Promise<boolean>;

const OPENROUTER_VERIFY_URL = "https://openrouter.ai/api/v1/auth/key";

async function verifyOpenaiKeyInTauri(key: string): Promise<boolean> {
  return invoke<boolean>("verify_openai_api_key", { apiKey: key });
}

async function verifyBearerKey(
  url: string,
  key: string,
  fetchImpl: FetchLike = fetch,
): Promise<boolean> {
  const trimmedKey = key.trim();
  if (!trimmedKey) return false;

  try {
    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${trimmedKey}` },
      method: "GET",
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function verifyOpenaiApiKey(
  key: string,
  verifyImpl: VerifyKeyLike = verifyOpenaiKeyInTauri,
): Promise<boolean> {
  const trimmedKey = key.trim();
  if (!trimmedKey) return false;

  try {
    return await verifyImpl(trimmedKey);
  } catch {
    return false;
  }
}

export function verifyOpenrouterApiKey(key: string, fetchImpl?: FetchLike): Promise<boolean> {
  return verifyBearerKey(OPENROUTER_VERIFY_URL, key, fetchImpl);
}

export function createVerifiedApiKeyHandler({
  saveKey,
  setStatus,
  verifyKey,
}: {
  saveKey: (key: string) => Promise<void>;
  setStatus: (status: ApiKeyStatus) => void;
  verifyKey: (key: string) => Promise<boolean>;
}): (key: string) => Promise<void> {
  let requestId = 0;
  let saveQueue = Promise.resolve();

  type SaveResult = "saved" | "stale" | "failed";

  const saveIfCurrent = async (currentRequestId: number, key: string) => {
    const queuedSave = saveQueue.then(async () => {
      if (currentRequestId !== requestId) return "stale" satisfies SaveResult;
      try {
        await saveKey(key);
      } catch {
        return currentRequestId === requestId
          ? "failed"
          : ("stale" satisfies SaveResult);
      }
      return currentRequestId === requestId
        ? "saved"
        : ("stale" satisfies SaveResult);
    });
    saveQueue = queuedSave.then(
      () => undefined,
      () => undefined,
    );
    return queuedSave;
  };

  return async (key: string) => {
    const currentRequestId = (requestId += 1);
    const trimmedKey = key.trim();
    if (!trimmedKey) {
      setStatus("idle");
      const saveResult = await saveIfCurrent(currentRequestId, "");
      if (saveResult === "failed") setStatus("invalid");
      return;
    }

    setStatus("verifying");
    const valid = await verifyKey(trimmedKey);
    if (currentRequestId !== requestId) return;

    if (valid) {
      const saveResult = await saveIfCurrent(currentRequestId, trimmedKey);
      if (saveResult === "stale") return;
      if (saveResult === "failed") {
        setStatus("invalid");
        return;
      }
      setStatus("valid");
      return;
    }

    setStatus("invalid");
  };
}
