// @ts-nocheck - Storybook 10 alpha types have inference issues (resolves to `never`)
import preview from "#storybook/preview";
import { CopyButton } from "./copy-button";

const meta = preview.meta({
  title: "UI/CopyButton",
  component: CopyButton,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
});

export default meta;

export const Default = meta.story({
  render: () => <CopyButton value="nix run github:nixmac/nixmac" />,
});

export const WithLabel = meta.story({
  render: () => (
    <CopyButton value="nix build .#default" variant="default" size="default">
      Copy install command
    </CopyButton>
  ),
});

export const Ghost = meta.story({
  render: () => (
    <CopyButton value="ssh-keygen -t ed25519" variant="ghost" size="sm">
      Copy command
    </CopyButton>
  ),
});

export const AllVariants = meta.story({
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <CopyButton value="default" variant="default" size="default">
        Default
      </CopyButton>
      <CopyButton value="secondary" variant="secondary" size="default">
        Secondary
      </CopyButton>
      <CopyButton value="outline" variant="outline" size="default">
        Outline
      </CopyButton>
      <CopyButton value="ghost" variant="ghost" size="default">
        Ghost
      </CopyButton>
      <CopyButton value="destructive" variant="destructive" size="default">
        Destructive
      </CopyButton>
    </div>
  ),
});

export const IconSizes = meta.story({
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <CopyButton value="sm" size="icon-sm" />
      <CopyButton value="default" size="icon" />
      <CopyButton value="lg" size="icon-lg" />
    </div>
  ),
});

export const Disabled = meta.story({
  render: () => (
    <CopyButton value="disabled" variant="default" size="default" disabled>
      Disabled
    </CopyButton>
  ),
});
