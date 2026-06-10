export type OpenrouterKeyVerification =
  | { ok: true; reason: null }
  | { ok: false; reason: "invalid" | "unavailable" };

export async function verifyOpenrouterApiKey(key: string): Promise<OpenrouterKeyVerification> {
  try {
    const response = await fetch("https://openrouter.ai/api/v1/auth/key", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${key}`,
      },
    });

    if (response.ok) {
      return { ok: true, reason: null };
    }

    return response.status === 401 || response.status === 403
      ? { ok: false, reason: "invalid" }
      : { ok: false, reason: "unavailable" };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}
