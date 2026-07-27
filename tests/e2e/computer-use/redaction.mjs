const providerEnvKeyPattern =
  /((?:OPENROUTER|OPENAI|ANTHROPIC|GROQ|XAI|MISTRAL|COHERE)_API_KEY)\s*=\s*[^\s"'<>]+/gi;
const sensitiveHeaderPattern =
  /((?:["']?(?:Authorization|Proxy-Authorization|X-Webhook-Secret|X-Api-Key)["']?\s*[:=]\s*["']?))(?:Bearer\s+)?[A-Za-z0-9._/-]{8,}/gi;
const githubTokenPattern = /\b(?:gh[pousr]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{16,})\b/gi;

export function redact(value) {
  return String(value)
    .replace(providerEnvKeyPattern, "$1=[REDACTED]")
    .replace(sensitiveHeaderPattern, "$1[REDACTED]")
    .replace(githubTokenPattern, "[REDACTED_GITHUB_TOKEN]")
    .replace(/sk-or-[A-Za-z0-9_-]+/g, "[REDACTED_OPENROUTER_KEY]")
    .replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED_API_KEY]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [REDACTED]");
}

export function containsUnmaskedSecret(text) {
  const value = text || "";
  return (
    /(?:sk-[A-Za-z0-9_-]{16,}|\bgh[pousr]_[A-Za-z0-9_]{16,}\b|\bgithub_pat_[A-Za-z0-9_]{16,}\b|Bearer\s+(?!\[REDACTED\])[A-Za-z0-9._-]{16,}|(?:OPENROUTER|OPENAI|ANTHROPIC|GROQ|XAI|MISTRAL|COHERE)_API_KEY\s*=\s*(?!\[REDACTED\])[^\s"'<>]+)/i.test(
      value,
    ) ||
    /["']?(?:Authorization|Proxy-Authorization|X-Webhook-Secret|X-Api-Key)["']?\s*[:=]\s*["']?(?!\[REDACTED\])(?:Bearer\s+)?[A-Za-z0-9._/-]{8,}/i.test(
      value,
    )
  );
}
