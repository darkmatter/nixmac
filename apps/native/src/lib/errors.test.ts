import { describe, expect, it } from "vitest";
import { isAiFixableRebuildError, REBUILD_ERROR_CODES } from "./errors";

describe("isAiFixableRebuildError", () => {
  it("allows Nix-code failures the evolve agent can fix", () => {
    expect(isAiFixableRebuildError(REBUILD_ERROR_CODES.EVALUATION_ERROR)).toBe(true);
    expect(isAiFixableRebuildError(REBUILD_ERROR_CODES.BUILD_ERROR)).toBe(true);
    expect(isAiFixableRebuildError(REBUILD_ERROR_CODES.INFINITE_RECURSION)).toBe(true);
    expect(isAiFixableRebuildError(REBUILD_ERROR_CODES.GENERIC_ERROR)).toBe(true);
  });

  it("suppresses the button for permission/authorization/cancellation/etc-clobber classes", () => {
    expect(isAiFixableRebuildError(REBUILD_ERROR_CODES.FULL_DISK_ACCESS)).toBe(false);
    expect(isAiFixableRebuildError(REBUILD_ERROR_CODES.APP_MANAGEMENT)).toBe(false);
    expect(isAiFixableRebuildError(REBUILD_ERROR_CODES.USER_CANCELLED)).toBe(false);
    expect(isAiFixableRebuildError(REBUILD_ERROR_CODES.AUTHORIZATION_DENIED)).toBe(false);
    expect(isAiFixableRebuildError(REBUILD_ERROR_CODES.ETC_CLOBBER)).toBe(false);
  });

  it("attempts a fix for unknown/unclassified failures", () => {
    expect(isAiFixableRebuildError(null)).toBe(true);
    expect(isAiFixableRebuildError(undefined)).toBe(true);
    expect(isAiFixableRebuildError("some_future_error_code")).toBe(true);
  });
});
