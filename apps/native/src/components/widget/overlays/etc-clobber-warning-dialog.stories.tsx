// @ts-nocheck - Storybook 10 factory types resolve story args too narrowly here
import preview from "#storybook/preview";
import { Button } from "@/components/ui/button";
import { EtcClobberWarningDialog } from "@/components/widget/overlays/etc-clobber-warning-dialog";
import type {
  EtcClobberCheckResult,
  EtcClobberConflict,
  EtcClobberConflictKind,
} from "@/ipc/types";
import { uiActions } from "@nixmac/state";
import { useEffect } from "react";

interface DialogStoryArgs {
  open: boolean;
  result: EtcClobberCheckResult | null;
}

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
  Array.from({ length: 8 }, (_, index) =>
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

function EtcClobberWarningDialogStory({ open, result }: DialogStoryArgs) {
  useEffect(() => {
    uiActions.setState({
      etcClobber: result,
      etcClobberDialogOpen: open,
    });

    return () => {
      uiActions.setState({
        etcClobber: null,
        etcClobberDialogOpen: false,
      });
    };
  }, [open, result]);

  return (
    <div className="flex h-[420px] w-[720px] items-center justify-center rounded-xl border border-border bg-background p-8">
      <Button variant="outline">Apply</Button>
      <EtcClobberWarningDialog />
    </div>
  );
}

const meta = preview.meta({
  title: "Widget/Overlays/EtcClobberWarningDialog",
  component: EtcClobberWarningDialogStory,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  argTypes: {
    open: {
      control: "boolean",
      description: "Seeds `uiState.etcClobberDialogOpen` for the story harness.",
      table: { category: "Dialog state" },
    },
    result: {
      control: "object",
      description: "Seeds `uiState.etcClobber`; `null` exercises the no-render guard.",
      table: { category: "Dialog state" },
    },
  },
  args: {
    open: true,
    result: allKindsResult,
  },
});

export default meta;

/** Interactive baseline — Controls can toggle the dialog and edit conflict payloads. */
export const Playground = meta.story({});

/** Pre-apply warning with every conflict kind represented. */
export const OpenWithAllConflictKinds = meta.story({
  args: {
    open: true,
    result: allKindsResult,
  },
});

/** Dialog copy and singular conflict count. */
export const SingleConflict = meta.story({
  args: {
    open: true,
    result: makeResult([
      makeConflict("unrecognized_content", {
        path: "/etc/nix/nix.conf",
        target: "nix/nix.conf",
      }),
    ]),
  },
});

/** Non-blocking Home Manager backup warning while apply continues. */
export const OpenWithXdgBackupWarning = meta.story({
  args: {
    open: true,
    result: xdgBackupWarningResult,
  },
});

/** Long conflict lists stay contained inside the dialog body. */
export const ManyConflicts = meta.story({
  args: {
    open: true,
    result: manyConflictsResult,
  },
});

/** The closed state keeps the trigger surface visible but no dialog content mounted. */
export const Closed = meta.story({
  args: {
    open: false,
    result: allKindsResult,
  },
});

/** Missing preflight data returns null, even if the open flag is true. */
export const NoPreflightResult = meta.story({
  args: {
    open: true,
    result: null,
  },
});
