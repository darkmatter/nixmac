const providerEnvKeyPattern = /((?:OPENROUTER|OPENAI|ANTHROPIC|GROQ|XAI|MISTRAL|COHERE)_API_KEY)=[^\s"'<>]+/gi;

export function redact(value) {
  return String(value)
    .replace(providerEnvKeyPattern, '$1=[REDACTED]')
    .replace(/sk-or-[A-Za-z0-9_-]+/g, '[REDACTED_OPENROUTER_KEY]')
    .replace(/sk-[A-Za-z0-9_-]+/g, '[REDACTED_API_KEY]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer [REDACTED]');
}

export function containsUnmaskedSecret(text) {
  return /(?:sk-[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._-]{16,}|(?:OPENROUTER|OPENAI|ANTHROPIC|GROQ|XAI|MISTRAL|COHERE)_API_KEY=(?!\[REDACTED\])[^\s"'<>]+)/i.test(text || '');
}
