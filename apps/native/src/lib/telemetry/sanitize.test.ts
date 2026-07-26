import { describe, expect, it } from "vitest";
import {
  sanitizeDiagnosticText,
  sanitizeTelemetryAttributes,
} from "./sanitize";

describe("sanitizeDiagnosticText", () => {
  it.each([
    [
      "email",
      "contact alice@example.com now",
      "alice@example.com",
      "[REDACTED]",
    ],
    [
      "bearer token",
      "Authorization: Bearer abc.def-123_~+/=",
      "Bearer abc.def-123_~+/=",
      "[REDACTED]",
    ],
    [
      "GitHub token",
      "token ghp_abcdefghijklmnopqrstuvwxyz123456",
      "ghp_abcdefghijklmnopqrstuvwxyz123456",
      "[REDACTED]",
    ],
    [
      "OpenAI token",
      "token sk-abcdefghijklmnopqrstuvwxyz123456",
      "sk-abcdefghijklmnopqrstuvwxyz123456",
      "[REDACTED]",
    ],
    [
      "Anthropic token",
      "token sk-ant-abcdefghijklmnopqrstuvwxyz123456",
      "sk-ant-abcdefghijklmnopqrstuvwxyz123456",
      "[REDACTED]",
    ],
    [
      "private key",
      "-----BEGIN PRIVATE KEY-----\nsecret-material\n-----END PRIVATE KEY-----",
      "secret-material",
      "[REDACTED]",
    ],
    [
      "home path",
      "open /Users/farhan/Documents/nixmac",
      "/Users/farhan",
      "/Users/[REDACTED_USER]",
    ],
    [
      "Nix secret assignment",
      'apiKey = "super-secret-value";',
      "super-secret-value",
      "apiKey = [REDACTED]",
    ],
  ])("redacts %s", (_label, input, sensitiveFragment, replacement) => {
    const sanitized = sanitizeDiagnosticText(input);

    expect(sanitized).not.toContain(sensitiveFragment);
    expect(sanitized).toContain(replacement);
  });
});

describe("sanitizeTelemetryAttributes", () => {
  it("sanitizes nested values and removes top-level identity attributes", () => {
    const sanitized = sanitizeTelemetryAttributes({
      user: { email: "owner@example.com" },
      server_name: "farhans-mac",
      nested: {
        note: "email alice@example.com",
        values: ["Bearer nested.secret-token"],
        apiToken: "raw-api-token",
        prompt: "private app prompt",
        safe: 42,
      },
    });

    expect(sanitized).toEqual({
      nested: {
        note: "email [REDACTED]",
        values: ["[REDACTED]"],
        apiToken: "[REDACTED]",
        prompt: "[REDACTED_APP_CONTENT]",
        safe: 42,
      },
    });
    expect(JSON.stringify(sanitized)).not.toContain("owner@example.com");
    expect(JSON.stringify(sanitized)).not.toContain("farhans-mac");
    expect(JSON.stringify(sanitized)).not.toContain("raw-api-token");
    expect(JSON.stringify(sanitized)).not.toContain("private app prompt");
    expect(JSON.stringify(sanitized)).not.toContain("nested.secret-token");
  });
});
