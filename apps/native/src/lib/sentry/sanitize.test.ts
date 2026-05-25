import { describe, expect, test } from "vitest";
import { sanitizeDiagnosticText, sanitizeSentryEvent } from "./sanitize";

describe("sanitizeSentryEvent — string redaction", () => {
  test("redacts emails inside message strings", () => {
    const result = sanitizeSentryEvent({
      message: "Failed for user@example.com during boot",
    }) as { message: string };
    expect(result.message).not.toMatch(/user@example/);
    expect(result.message).toContain("[REDACTED]");
  });

  test("rewrites home-directory paths but keeps the remainder of the path", () => {
    const result = sanitizeSentryEvent({
      message: "Crashed in /Users/cas/projects/nixmac/apps/native/src/main.tsx",
    }) as { message: string };
    expect(result.message).not.toContain("/Users/cas/");
    expect(result.message).toContain("/Users/[REDACTED_USER]/projects/nixmac/apps/native/src/main.tsx");
  });

  test("redacts Anthropic-shaped tokens", () => {
    const result = sanitizeSentryEvent({
      message: "Header had sk-ant-abcdefghijklmnopqrstuvwxyz at request time",
    }) as { message: string };
    expect(result.message).not.toMatch(/sk-ant-[a-z]{20}/);
    expect(result.message).toContain("[REDACTED]");
  });

  test("redacts OpenAI-shaped tokens, GitHub tokens, and Bearer headers", () => {
    const result = sanitizeSentryEvent({
      message:
        "openai=sk-abcdefghijklmnopqrstuvwxyz0123 gh=ghp_abcdefghijklmnopqrstuvwxyz auth=Bearer abc.def-ghi/jkl+mno=",
    }) as { message: string };
    expect(result.message).not.toMatch(/sk-[a-z0-9]{20}/);
    expect(result.message).not.toMatch(/ghp_[a-z0-9]{20}/i);
    expect(result.message).not.toMatch(/Bearer [a-z0-9]/i);
  });

  test("strips query strings from http(s) URLs but leaves non-URL strings unchanged", () => {
    const result = sanitizeSentryEvent({
      message: "https://example.com/path?token=abc&user=cas",
    }) as { message: string };
    expect(result.message).not.toContain("token=abc");
    expect(result.message).not.toContain("user=cas");
    expect(result.message).toContain("https://example.com/path");
  });

  test("redacts the value half of nix-style secret assignments", () => {
    const result = sanitizeSentryEvent({
      message: 'config had password = "hunter2" inside',
    }) as { message: string };
    expect(result.message).not.toContain("hunter2");
    expect(result.message).toContain("password = [REDACTED]");
  });
});

describe("sanitizeSentryEvent — key-based wholesale redaction", () => {
  test("redacts wholesale on keys matching APP_CONTENT_KEY_PATTERN", () => {
    const result = sanitizeSentryEvent({
      extra: {
        diff: "+ password = 'hunter2'",
        stdout: "running...",
        cwd: "/Users/cas/projects",
      },
    }) as { extra: { diff: string; stdout: string; cwd: string } };
    expect(result.extra.diff).toBe("[REDACTED_APP_CONTENT]");
    expect(result.extra.stdout).toBe("[REDACTED_APP_CONTENT]");
    expect(result.extra.cwd).toBe("[REDACTED_APP_CONTENT]");
  });

  test("redacts sensitive-keyed values (email, token) to [REDACTED] regardless of contents", () => {
    const result = sanitizeSentryEvent({
      contexts: {
        anything: {
          email: "not-an-email-but-keyed-as-one",
          token: "x",
        },
      },
    }) as { contexts: { anything: { email: string; token: string } } };
    expect(result.contexts.anything.email).toBe("[REDACTED]");
    expect(result.contexts.anything.token).toBe("[REDACTED]");
  });

  test("leaves an empty app-content string alone (falls through to string sanitizer)", () => {
    const result = sanitizeSentryEvent({
      extra: { diff: "" },
    }) as { extra: { diff: string } };
    expect(result.extra.diff).toBe("");
  });
});

describe("sanitizeSentryEvent — top-level scrubs", () => {
  test("removes user and server_name from the top level", () => {
    const result = sanitizeSentryEvent({
      message: "ok",
      user: { id: "abc", email: "a@b.c" },
      server_name: "host.local",
    }) as Record<string, unknown>;
    expect(result.user).toBeUndefined();
    expect(result.server_name).toBeUndefined();
    expect(result.message).toBe("ok");
  });

  test("returns primitives untouched (no top-level scrub when non-object)", () => {
    expect(sanitizeSentryEvent("plain string")).toBe("plain string");
    expect(sanitizeSentryEvent(null)).toBe(null);
    expect(sanitizeSentryEvent(42)).toBe(42);
  });
});

describe("sanitizeDiagnosticText", () => {
  test("applies the same regex pipeline as Sentry strings", () => {
    expect(sanitizeDiagnosticText("hi user@example.com")).toBe("hi [REDACTED]");
  });

  test("strips non-printables (control chars) while preserving tab and printable ASCII", () => {
    expect(sanitizeDiagnosticText("hi\x07\x08there\tworld")).toBe("hithere\tworld");
  });

  test("rewrites home paths and strips non-printables in one pass", () => {
    expect(sanitizeDiagnosticText("at \x01/Users/cas/x\x02")).toBe("at /Users/[REDACTED_USER]/x");
  });
});
