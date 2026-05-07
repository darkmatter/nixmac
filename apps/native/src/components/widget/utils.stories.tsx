// @ts-nocheck - Storybook 10 alpha types have inference issues (resolves to `never`)
import preview from "#storybook/preview";
import { getCategoryStyle, getDirectory, getShortFilename } from "./utils";

function UtilsDemo() {
  const paths = [
    "/Users/demo/.darwin/flake.nix",
    "/Users/demo/.darwin/modules/homebrew.nix",
    "secrets/example.age",
  ];
  const categories = ["System defaults", "Packages", "Theme"];

  return (
    <div className="w-[520px] space-y-6 rounded-lg border bg-background p-6">
      <section className="space-y-3">
        <h3 className="font-medium text-sm">Path helpers</h3>
        <div className="grid gap-2">
          {paths.map((file) => (
            <div className="rounded-md border p-3" key={file}>
              <div className="font-mono text-sm">{getShortFilename(file)}</div>
              <div className="text-muted-foreground text-xs">{getDirectory(file) || "root"}</div>
            </div>
          ))}
        </div>
      </section>
      <section className="space-y-3">
        <h3 className="font-medium text-sm">Category styles</h3>
        <div className="flex flex-wrap gap-2">
          {categories.map((label) => {
            const style = getCategoryStyle(label);
            return (
              <span className={`rounded-md border px-2 py-1 text-xs ${style.bg} ${style.border} ${style.text}`} key={label}>
                {label}
              </span>
            );
          })}
        </div>
      </section>
    </div>
  );
}

const meta = preview.meta({
  title: "Widget/Utils",
  component: UtilsDemo,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
});

export default meta;

export const FormattingHelpers = meta.story({
  render: () => <UtilsDemo />,
});
