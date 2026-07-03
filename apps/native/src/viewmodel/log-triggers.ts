import type { RebuildNotice } from "@/types/rebuild";

type BuildLogTrigger = {
  matches: (line: string) => boolean;
  notice: RebuildNotice;
};

const appManagementNotice: RebuildNotice = {
  id: "app-management-permission",
  title: "App Management permission required",
  body: "macOS blocked activation while darwin-rebuild was updating managed app bundles. Accept the App Management notification if it appears. If it does not, open System Settings → Privacy & Security → App Management and enable nixmac, then retry the rebuild.",
  permissionId: "app-management",
  actionLabel: "Open App Management",
};

const buildLogTriggers: BuildLogTrigger[] = [
  {
    matches: (line) => {
      const normalized = line.toLowerCase();
      return (
        normalized.includes("requires permission to update your apps") ||
        normalized.includes("permission denied when trying to update apps") ||
        normalized.includes("privacy & security > app management")
      );
    },
    notice: appManagementNotice,
  },
];

export function noticesForBuildLogLines(
  lines: string[],
  existingNotices: RebuildNotice[],
): RebuildNotice[] {
  const seen = new Set(existingNotices.map((notice) => notice.id));
  const nextNotices: RebuildNotice[] = [];

  for (const line of lines) {
    for (const trigger of buildLogTriggers) {
      if (seen.has(trigger.notice.id) || !trigger.matches(line)) {
        continue;
      }

      seen.add(trigger.notice.id);
      nextNotices.push(trigger.notice);
    }
  }

  return nextNotices;
}
