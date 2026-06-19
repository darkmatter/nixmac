// @ts-nocheck - Storybook 10 alpha types have inference issues (resolves to `never`)
import preview from "#storybook/preview";
import { FILES, type FsFile } from "./data";
import { seedForFile } from "./seed-prompt";

/**
 * Reference story — these are pure functions, but having a visible
 * "show me every seed for every file" page lets reviewers eyeball the
 * prompt bias copy without wiring up the full flow.
 */
function SeedTable() {
  const all = Object.values(FILES)
    .flat()
    .filter((file) => file.status !== "candidate");
  return (
    <div className="grid gap-2">
      <div className="font-semibold text-[12px]">seedForFile (per editable file)</div>
      <table className="w-full border-collapse rounded-md border border-border text-[11px]">
        <thead>
          <tr className="border-border border-b bg-card/40">
            <th className="px-3 py-2 text-left font-medium text-[10px] text-muted-foreground uppercase tracking-wider">
              File
            </th>
            <th className="px-3 py-2 text-left font-medium text-[10px] text-muted-foreground uppercase tracking-wider">
              Seed
            </th>
          </tr>
        </thead>
        <tbody>
          {all.map((f: FsFile) => (
            <tr key={f.id} className="border-border/40 border-b last:border-b-0">
              <td className="px-3 py-2 align-top font-mono text-[10.5px] text-muted-foreground">
                {f.path}
              </td>
              <td className="px-3 py-2 align-top">
                <pre className="m-0 whitespace-pre-wrap break-words font-mono text-[10.5px] text-teal-200 leading-[1.5]">
                  {seedForFile(f)}
                </pre>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const meta = preview.meta({
  title: "Widget/Filesystem/SeedPrompt",
  component: SeedTable,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
});

export default meta;

export const PerFileSeeds = meta.story({
  render: () => <SeedTable />,
});
