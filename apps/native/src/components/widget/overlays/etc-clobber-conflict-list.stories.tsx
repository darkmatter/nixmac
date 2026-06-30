// @ts-nocheck - Storybook 10 factory types resolve story args too narrowly here
import preview from "#storybook/preview";
import { EtcClobberConflictList } from "@/components/widget/overlays/etc-clobber-conflict-list";
import type {
  EtcClobberCheckResult,
  EtcClobberConflict,
  EtcClobberConflictKind,
} from "@/ipc/types";

const conflictKinds = ["unrecognized_content", "non_regular_target", "unreadable"] as const;

function makeConflict(
  kind: EtcClobberConflictKind,
  overrides: Partial<EtcClobberConflict> = {},
): EtcClobberConflict {
  const filename = overrides.target ?? `${kind.replaceAll("_", "-")}.conf`;
  return {
    path: `/etc/${filename}`,
    target: filename,
    expectedStaticPath: `/etc/static/${filename}`,
    currentLinkTarget: null,
    knownSha256Hashes: [],
    kind,
    ...overrides,
  };
}

function makeResult(conflicts: EtcClobberConflict[], checked = 12): EtcClobberCheckResult {
  return {
    ok: conflicts.length === 0,
    checked,
    conflicts,
    warnings: [],
  };
}

const allKindsResult = makeResult([
  makeConflict("unrecognized_content", {
    path: "/etc/nix/github-token.conf",
    target: "nix/github-token.conf",
    knownSha256Hashes: ["sha256-demo-safe-hash"],
  }),
  makeConflict("non_regular_target", {
    path: "/etc/synthetic.conf",
    target: "synthetic.conf",
    currentLinkTarget: "/private/etc/synthetic.conf",
  }),
  makeConflict("unreadable", {
    path: "/etc/pam.d/sudo_local",
    target: "pam.d/sudo_local",
  }),
]);

const manyConflictsResult = makeResult(
  Array.from({ length: 9 }, (_, index) =>
    makeConflict(conflictKinds[index % conflictKinds.length], {
      path: `/etc/demo/path-${index + 1}.conf`,
      target: `demo/path-${index + 1}.conf`,
      currentLinkTarget: index % 3 === 1 ? `/legacy/demo/path-${index + 1}.conf` : null,
    }),
  ),
  42,
);

const xdgBackupWarningResult: EtcClobberCheckResult = {
  ok: true,
  checked: 8,
  conflicts: [],
  warnings: [
    {
      path: "/Users/alice/.config/git/message",
      target: "git/message",
      managedRoot: "xdg_config",
      user: "alice",
      currentLinkTarget: null,
      expectedLinkTarget: "/nix/store/example-home-files/git/message",
      backupExtension: "backup",
    },
  ],
};

function StorySurface({ children }: { children: React.ReactNode }) {
  return <div className="w-[620px] rounded-xl bg-background p-6">{children}</div>;
}

const meta = preview.meta({
  title: "Widget/Overlays/EtcClobberConflictList",
  component: EtcClobberConflictList,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  render: (args) => (
    <StorySurface>
      <EtcClobberConflictList {...args} />
    </StorySurface>
  ),
  argTypes: {
    result: {
      control: "object",
      description: "Structured `/etc` preflight result returned by the backend.",
      table: { category: "Data" },
    },
    className: {
      control: "text",
      description: "Additional classes applied to the conflict-list container.",
      table: { category: "Layout" },
    },
  },
  args: {
    result: allKindsResult,
    className: "",
  },
});

export default meta;

/** Interactive baseline — edit the result object to try arbitrary conflict payloads. */
export const Playground = meta.story({});

/** All conflict labels and descriptions visible together. */
export const AllConflictKinds = meta.story({
  args: {
    result: allKindsResult,
  },
});

/** Singular copy: one `/etc` file needs review. */
export const SingleConflict = meta.story({
  args: {
    result: makeResult([
      makeConflict("unrecognized_content", {
        path: "/etc/nix/nix.conf",
        target: "nix/nix.conf",
      }),
    ]),
  },
});

/** Shows the optional current symlink target row. */
export const WithCurrentLinkTarget = meta.story({
  args: {
    result: makeResult([
      makeConflict("non_regular_target", {
        path: "/etc/ssh/ssh_config",
        target: "ssh/ssh_config",
        currentLinkTarget: "/usr/local/etc/ssh/ssh_config",
      }),
    ]),
  },
});

/** Non-blocking Home Manager xdg.configFile backup warning. */
export const XdgBackupWarning = meta.story({
  args: {
    result: xdgBackupWarningResult,
  },
});

/** Stress state for scrolling and repeated mixed conflict kinds. */
export const ManyConflicts = meta.story({
  args: {
    result: manyConflictsResult,
  },
});

/** Empty results intentionally render nothing. */
export const NoConflicts = meta.story({
  args: {
    result: makeResult([], 18),
  },
});
