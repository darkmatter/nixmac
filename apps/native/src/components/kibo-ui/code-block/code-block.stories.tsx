// @ts-nocheck - Storybook 10 alpha types have inference issues (resolves to `never`)
import preview from "#storybook/preview";
import {
  type BundledLanguage,
  CodeBlock,
  CodeBlockBody,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockFiles,
  CodeBlockFilename,
  CodeBlockHeader,
  CodeBlockItem,
  CodeBlockSelect,
  CodeBlockSelectContent,
  CodeBlockSelectItem,
  CodeBlockSelectTrigger,
  CodeBlockSelectValue,
} from "./index";

const meta = preview.meta({
  title: "Kibo UI/CodeBlock",
  component: CodeBlock,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
});

export default meta;

const files = [
  {
    language: "nix",
    filename: "flake.nix",
    code: `{\n  description = \"nixmac demo\";\n\n  outputs = { self, nixpkgs }: {\n    darwinConfigurations.demo = nixpkgs.lib.darwinSystem {\n      modules = [ ./darwin-configuration.nix ];\n    };\n  };\n}`,
  },
  {
    language: "typescript",
    filename: "settings.ts",
    code: `export const provider = \"codex\";\nexport const maxIterations = 25;\n\nexport function ready() {\n  return provider.length > 0;\n}`,
  },
];

export const MultiFile = meta.story({
  render: () => (
    <CodeBlock className="h-[360px] w-[720px]" data={files} defaultValue="nix">
      <CodeBlockHeader>
        <CodeBlockFiles>
          {(item) => (
            <CodeBlockFilename key={item.filename} value={item.language}>
              {item.filename}
            </CodeBlockFilename>
          )}
        </CodeBlockFiles>
        <CodeBlockSelect>
          <CodeBlockSelectTrigger>
            <CodeBlockSelectValue placeholder="Select file" />
          </CodeBlockSelectTrigger>
          <CodeBlockSelectContent>
            {(item) => (
              <CodeBlockSelectItem key={item.filename} value={item.language}>
                {item.filename}
              </CodeBlockSelectItem>
            )}
          </CodeBlockSelectContent>
        </CodeBlockSelect>
        <CodeBlockCopyButton />
      </CodeBlockHeader>
      <CodeBlockBody>
        {(item) => (
          <CodeBlockItem key={item.filename} value={item.language}>
            <CodeBlockContent language={item.language as BundledLanguage}>
              {item.code}
            </CodeBlockContent>
          </CodeBlockItem>
        )}
      </CodeBlockBody>
    </CodeBlock>
  ),
});
