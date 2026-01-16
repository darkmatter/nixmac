"use client";

import { ArrowRightIcon } from "lucide-react";
import * as React from "react";
import {
  type BundledLanguage,
  CodeBlock,
  CodeBlockBody,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockFilename,
  CodeBlockHeader,
  CodeBlockItem,
} from "@/components/kibo-ui/code-block";
import {
  TreeExpander,
  TreeIcon,
  TreeLabel,
  TreeNode,
  TreeNodeContent,
  TreeNodeTrigger,
  TreeProvider,
  TreeView,
} from "@/components/kibo-ui/tree";
import { Button } from "@/components/ui/button";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

// Type definitions
interface FileNode {
  id: string;
  name: string;
  type: "file" | "folder";
  language?: string;
  code?: string;
  children?: FileNode[];
}

// Payload CMS file structure data
const fileStructure: FileNode[] = [
  {
    id: "src",
    name: "src",
    type: "folder",
    children: [
      {
        id: "components",
        name: "components",
        type: "folder",
        children: [
          {
            id: "ui",
            name: "ui",
            type: "folder",
            children: [
              {
                id: "button.tsx",
                name: "button.tsx",
                type: "file",
                language: "typescript",
                code: `import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-xs hover:bg-primary/90",
        destructive:
          "bg-destructive text-white shadow-xs hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
        outline:
          "border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80",
        ghost:
          "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    / className={cn("", className)}>
  )
}

export { Button, buttonVariants }`,
              },
            ],
          },
        ],
      },
    ],
  },
  {
    id: "tsconfig.json",
    name: "tsconfig.json",
    type: "file",
    language: "json",
    code: `{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [
      {
        "name": "next"
      }
    ],
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}`,
  },
];

// Helper function to find file by ID
const findFileById = (files: FileNode[], id: string): FileNode | null => {
  for (const file of files) {
    if (file.id === id) {
      return file;
    }
    if (file.children) {
      const found = findFileById(file.children, id);
      if (found) return found;
    }
  }
  return null;
};

// Render tree nodes recursively
const renderTreeNodes = (nodes: FileNode[], level = 0) =>
  nodes.map((node, index) => {
    const isLast = index === nodes.length - 1;
    const hasChildren = node.children && node.children.length > 0;

    return (
      <TreeNode isLast={isLast} key={node.id} level={level} nodeId={node.id}>
        <TreeNodeTrigger>
          <TreeExpander hasChildren={hasChildren} />
          <TreeIcon hasChildren={hasChildren} />
          <TreeLabel>{node.name}</TreeLabel>
        </TreeNodeTrigger>
        {hasChildren && node.children && (
          <TreeNodeContent hasChildren>
            {renderTreeNodes(node.children, level + 1)}
          </TreeNodeContent>
        )}
      </TreeNode>
    );
  });

interface CodeExample4Props {
  className?: string;
}

const CodeExample4 = ({ className }: CodeExample4Props) => {
  const [selectedFileId, setSelectedFileId] =
    React.useState<string>("button.tsx");
  const [selectedFile, setSelectedFile] = React.useState<FileNode | null>(() =>
    findFileById(fileStructure, "button.tsx")
  );

  const handleFileSelection = React.useCallback((fileIds: string[]) => {
    if (fileIds.length > 0) {
      const fileId = fileIds[0];
      const file = findFileById(fileStructure, fileId);
      if (file && file.type === "file") {
        setSelectedFileId(fileId);
        setSelectedFile(file);
      }
    }
  }, []);

  const codeData = React.useMemo(() => {
    if (!selectedFile) return [];
    return [
      {
        language: selectedFile.language || "typescript",
        filename: selectedFile.name,
        code: selectedFile.code || "// No content available",
      },
    ];
  }, [selectedFile]);

  return (
    <section className={cn("py-32", className)}>
      <div className="container">
        <div className="mb-12 text-center">
          <span className="mb-6 text-muted-foreground text-xs uppercase">
            Component Library
          </span>
          <h2 className="mb-4 text-4xl">Rich, reusable components</h2>
          <p className="mx-auto max-w-3xl text-lg text-muted-foreground">
            Discover our comprehensive collection of production-ready
            components. Browse through the file tree to explore different
            implementations, patterns, and best practices for building modern
            web applications.
          </p>
        </div>

        <div className="grid lg:grid-cols-[300px_1fr]">
          {/* File Tree */}
          <div className="rounded-t-lg border border-b-0 bg-muted/20 p-4 lg:rounded-l-lg lg:rounded-tr-none lg:border-r-0 lg:border-b">
            <TreeProvider
              className="w-full"
              defaultExpandedIds={["src", "components", "ui"]}
              onSelectionChange={handleFileSelection}
              selectedIds={[selectedFileId]}
            >
              <TreeView>{renderTreeNodes(fileStructure)}</TreeView>
            </TreeProvider>
          </div>

          {/* Code Block */}
          <div className="min-h-0 min-w-0 overflow-hidden">
            <CodeBlock
              className="h-full w-full rounded-t-none rounded-b-lg lg:rounded-r-lg lg:rounded-l-none lg:rounded-bl-none"
              data={codeData}
              value={selectedFile?.language || "typescript"}
            >
              <CodeBlockHeader className="justify-between">
                <CodeBlockFilename
                  value={selectedFile?.language || "typescript"}
                >
                  {selectedFile?.name || "Select a file"}
                </CodeBlockFilename>
                <CodeBlockCopyButton />
              </CodeBlockHeader>
              <ScrollArea className="h-[600px] w-full">
                <CodeBlockBody>
                  {(item) => (
                    <CodeBlockItem
                      className="min-h-full w-max min-w-full"
                      key={item.language}
                      value={item.language}
                    >
                      <CodeBlockContent
                        language={item.language as BundledLanguage}
                      >
                        {item.code}
                      </CodeBlockContent>
                    </CodeBlockItem>
                  )}
                </CodeBlockBody>
                <ScrollBar orientation="horizontal" />
              </ScrollArea>
            </CodeBlock>
          </div>
        </div>

        <div className="mt-8 text-center">
          <Button variant="outline">
            View full documentation <ArrowRightIcon className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </section>
  );
};

export { CodeExample4 };
