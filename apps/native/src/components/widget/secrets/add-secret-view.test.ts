import { describe, expect, it } from "vitest";

import type { SecretsVault } from "@/ipc/orpc-bindings";
import { buildAddRequest } from "./add-secret-view";

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
