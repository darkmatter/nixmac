// @ts-nocheck - Storybook 10 alpha types have inference issues (resolves to `never`)
import preview from "#storybook/preview";
import { FILES } from "./data";
import { FileList } from "./file-list";
import { SeedDisplay } from "./seed-display";
import { seedForFile } from "./seed-prompt";

const meta = preview.meta({
  title: "Widget/Filesystem/FileList",
  component: FileList,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
});

export default meta;

export const SystemSection = meta.story({
  render: () => (
    <SeedDisplay>
      {(push) => (
        <div className="h-[520px] w-[640px]">
          <FileList
            files={FILES.darwin}
            onEditWithPrompt={(f) => push(seedForFile(f))}
            onTrack={push}
          />
        </div>
      )}
    </SeedDisplay>
  ),
});

export const PersonalSection = meta.story({
  render: () => (
    <SeedDisplay>
      {(push) => (
        <div className="h-[520px] w-[640px]">
          <FileList
            files={FILES.home}
            onEditWithPrompt={(f) => push(seedForFile(f))}
            onTrack={push}
          />
        </div>
      )}
    </SeedDisplay>
  ),
});

export const UntrackedSection = meta.story({
  render: () => (
    <SeedDisplay>
      {(push) => (
        <div className="h-[520px] w-[640px]">
          <FileList
            files={FILES.manage}
            onEditWithPrompt={(f) => push(seedForFile(f))}
            onTrack={push}
          />
        </div>
      )}
    </SeedDisplay>
  ),
});

export const SetupSection = meta.story({
  render: () => (
    <SeedDisplay>
      {(push) => (
        <div className="h-[520px] w-[640px]">
          <FileList
            files={FILES.entry}
            onEditWithPrompt={(f) => push(seedForFile(f))}
            onTrack={push}
          />
        </div>
      )}
    </SeedDisplay>
  ),
});
