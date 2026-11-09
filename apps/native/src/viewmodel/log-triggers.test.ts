import { describe, expect, it } from "vitest";
import { noticesForBuildLogLines } from "./log-triggers";

describe("build log triggers", () => {
  it("emits App Management guidance when darwin-rebuild asks for app update permission", () => {
    const notices = noticesForBuildLogLines(
      [
        "`darwin-rebuild` requires permission to update your apps, please accept the notification",
        "If you did not get a notification, you can navigate to System Settings > Privacy & Security > App Management.",
      ],
      [],
    );

    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      id: "app-management-permission",
      title: "App Management permission required",
      permissionId: "app-management",
    });
  });

  it("deduplicates notices that already fired for a rebuild", () => {
    const [existingNotice] = noticesForBuildLogLines(
      ["error: permission denied when trying to update apps, aborting activation"],
      [],
    );

    const notices = noticesForBuildLogLines(
      ["If you did not get a notification, navigate to System Settings > Privacy & Security > App Management."],
      [existingNotice],
    );

    expect(notices).toEqual([]);
  });
});
