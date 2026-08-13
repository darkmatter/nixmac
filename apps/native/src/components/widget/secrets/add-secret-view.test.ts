import { describe, expect, it } from "vitest";

import type { SecretEntry, SecretsVault } from "@/ipc/orpc-bindings";
import { buildAddRequest, buildEditRequest } from "./add-secret-view";

const vault = (declarationFile: string, encryptedDirectory: string): SecretsVault =>
  ({
    agenixRulesFile: "secrets/secrets.nix",
    agenixDeclarationFile: declarationFile,
    agenixEncryptedDirectoryFromDeclaration: encryptedDirectory,
  }) as SecretsVault;

describe("agenix add preview", () => {
  it("matches the standard declaration module path", () => {
    const request = buildAddRequest(
      "api-token",
      "agenix",
      vault("modules/darwin/agenix-secrets.nix", "../../secrets"),
    );

    expect(request.diffFile).toBe("modules/darwin/agenix-secrets.nix");
    expect(request.diff).toContainEqual({
      kind: "added",
      text: '+ age.secrets."api-token".file = builtins.path { path = ../../secrets/api-token.age; };',
    });
  });

  it("derives the path from a non-standard declaration module", () => {
    const request = buildAddRequest(
      "api-token",
      "agenix",
      vault("hosts/workstation/modules/security.nix", "../../../secrets"),
    );

    expect(request.diffFile).toBe("hosts/workstation/modules/security.nix");
    expect(request.diff).toContainEqual({
      kind: "added",
      text: '+ age.secrets."api-token".file = builtins.path { path = ../../../secrets/api-token.age; };',
    });
  });

  it("uses an explicit backend-provided path for a declaration at the repository root", () => {
    const request = buildAddRequest("api-token", "agenix", vault("agenix.nix", "./secrets"));
    expect(request.diff).toContainEqual({
      kind: "added",
      text: '+ age.secrets."api-token".file = builtins.path { path = ./secrets/api-token.age; };',
    });
  });
});

describe("secret edit preview", () => {
  it("touches only the existing encrypted file", () => {
    const request = buildEditRequest({
      id: "github-token",
      name: "github-token",
      backend: "sops",
      file: "secrets/team.yaml",
      sopsKey: "github/token",
    } as SecretEntry);

    expect(request.origin).toBe("edit");
    expect(request.files).toEqual([
      { path: "secrets/team.yaml", note: "· encrypted update", mark: "~" },
    ]);
    expect(request.commitMsg).toBe("secrets: edit github-token (sops)");
  });

  it("reviews an agenix edit as an update to only its existing encrypted file", () => {
    const request = buildEditRequest({
      id: "api-token",
      name: "api-token",
      backend: "agenix",
      file: "secrets/api-token.age",
    } as SecretEntry);

    expect(request).toMatchObject({
      origin: "edit",
      backend: "agenix",
      diffFile: "secrets/api-token.age",
      files: [{ path: "secrets/api-token.age", note: "· encrypted update", mark: "~" }],
      commitMsg: "secrets: edit api-token (agenix)",
    });
    expect(request.diff.some((line) => line.text.includes("agenix"))).toBe(true);
  });
});
