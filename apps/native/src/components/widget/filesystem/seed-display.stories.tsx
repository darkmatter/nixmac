// @ts-nocheck - Storybook 10 alpha types have inference issues (resolves to `never`)
//
// SeedDisplay is a story-only helper used by every other Filesystem
// story to make the seed-prompt UX testable in isolation. The stories
// in this file document its surface so reviewers can see what wiring
// it expects when adopting it for new components.
import preview from "#storybook/preview";
import { Button } from "@/components/ui/button";
import { SeedDisplay } from "./seed-display";

const meta = preview.meta({
  title: "Widget/Filesystem/SeedDisplay (helper)",
  component: SeedDisplay,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
});

export default meta;

/**
 * Empty state. The helper renders a sibling panel that lists every
 * seed pushed via the render-prop callback. With no clicks, the panel
 * shows an empty hint.
 */
export const Empty = meta.story({
  render: () => (
    <SeedDisplay>
      {() => (
        <div className="p-6 text-center text-muted-foreground text-xs">
          (Component under test would render here.)
        </div>
      )}
    </SeedDisplay>
  ),
});

/**
 * Single push. Click the button — the seed appears in the side panel
 * and persists for the lifetime of the story.
 */
export const SinglePush = meta.story({
  render: () => (
    <SeedDisplay>
      {(push) => (
        <div className="flex h-32 items-center justify-center">
          <Button size="sm" onClick={() => push("Change modules/darwin/homebrew.nix: install Slack")}>
            Push a seed
          </Button>
        </div>
      )}
    </SeedDisplay>
  ),
});

/**
 * Multiple pushes — the panel keeps the latest 5, newest first.
 */
export const HistoryRollover = meta.story({
  render: () => {
    const seeds = [
      "Change modules/darwin/homebrew.nix: install Slack",
      "Change modules/darwin/defaults.nix: auto-hide the Dock",
      "Add these items to my nix config by adding them to modules/darwin/homebrew.nix:\n- docker\n- obs\n- iterm2",
      "Change modules/home/dotfiles.nix: switch from neovim to helix",
      'Add "Rectangle" to my nix config by adding it to modules/darwin/services.nix.',
      "Change modules/darwin/security.nix: enable Touch ID for sudo",
    ];
    return (
      <SeedDisplay title="Latest 5">
        {(push) => (
          <div className="grid gap-2 p-4">
            {seeds.map((s) => (
              <Button
                key={s}
                size="sm"
                variant="outline"
                className="justify-start text-[11px]"
                onClick={() => push(s)}
              >
                push: {s.split("\n")[0].slice(0, 60)}
              </Button>
            ))}
          </div>
        )}
      </SeedDisplay>
    );
  },
});
