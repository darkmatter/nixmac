// @ts-nocheck - Storybook 10 alpha types have inference issues (resolves to `never`)
import preview from "#storybook/preview";
import { FILES, type FsFile } from "./data";
import { FileRow } from "./file-row";
import { SeedDisplay } from "./seed-display";
import { seedForFile } from "./seed-prompt";

const meta = preview.meta({
  title: "Widget/Filesystem/FileRow",
  component: FileRow,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
});

export default meta;

const findFile = (id: string): FsFile => {
  for (const list of Object.values(FILES)) {
    const hit = list.find((f) => f.id === id);
    if (hit) return hit;
  }
  throw new Error(`fixture not found: ${id}`);
};

export const Managed = meta.story({
  render: () => (
    <SeedDisplay>
      {(push) => (
        <FileRow file={findFile("packages")} onEditWithPrompt={(f) => push(`change ${f.path}`)} />
      )}
    </SeedDisplay>
  ),
});

export const Changed = meta.story({
  render: () => (
    <SeedDisplay>
      {(push) => (
        <FileRow file={findFile("homebrew")} onEditWithPrompt={(f) => push(`change ${f.path}`)} />
      )}
    </SeedDisplay>
  ),
});

export const Readonly = meta.story({
  render: () => (
    <SeedDisplay>
      {(push) => (
        <FileRow file={findFile("lock")} onEditWithPrompt={(f) => push(`change ${f.path}`)} />
      )}
    </SeedDisplay>
  ),
});

/**
 * Demonstrates the `{ }` peek affordance — click the brace icon on the
 * row to inline-expand the nix source. The button toggles open/close.
 */
export const PeekableNixSource = meta.story({
  render: () => (
    <SeedDisplay>
      {(push) => (
        <FileRow file={findFile("flake")} onEditWithPrompt={(f) => push(`change ${f.path}`)} />
      )}
    </SeedDisplay>
  ),
});

/**
 * Real seed-generation: click "Edit with a prompt" — the right-hand
 * panel shows the actual seed that would land in the prompt textarea.
 */
export const RealSeedGeneration = meta.story({
  render: () => {
    const file = findFile("homebrew");
    return (
      <SeedDisplay title="Seed pushed to PromptInput">
        {(push) => <FileRow file={file} onEditWithPrompt={(f) => push(seedForFile(f))} />}
      </SeedDisplay>
    );
  },
});
