import preview from "#storybook/preview";
import { FlakeDirChooser } from "@/components/widget/controls/flake-dir-chooser";

const meta = preview.meta({
  title: "Widget/Controls/FlakeDirChooser",
  component: FlakeDirChooser,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <div className="w-[480px]">
        <Story />
      </div>
    ),
  ],
});

export default meta;

export const MultipleCandidates = meta.story({
  args: {
    flakeDirs: ["nix/os", "machines/laptop", "machines/desktop"],
    onChoose: () => {},
    onCancel: () => {},
  },
});

export const Applying = meta.story({
  args: {
    flakeDirs: ["nix/os", "machines/laptop"],
    onChoose: () => {},
    onCancel: () => {},
    busy: true,
  },
});
