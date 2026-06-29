import type { ChangeWithRichType } from "@/components/widget/utils";
import type { ChangeWithSummary, SemanticChangeGroup, SemanticChangeMap } from "@/ipc/types";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SummaryItems } from "./summary-items";

vi.mock("@/components/ui/collapsible", () => ({
  Collapsible: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="collapsible">{children}</div>
  ),
  CollapsibleContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CollapsibleTrigger: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
}));

vi.mock("@/components/ui/separator", () => ({
  Separator: () => <hr />,
}));

vi.mock("@/components/widget/summaries/unsummarized-changes-section", () => ({
  UnsummarizedChangesSection: ({ changes }: { changes: ChangeWithRichType[] }) =>
    changes.length > 0 ? <div data-testid="unsummarized">{changes.length} unsummarized</div> : null,
}));

vi.mock("@/components/widget/utils", () => ({
  getCategoryStyle: () => ({ text: "text-foo", border: "border-foo" }),
  getShortFilename: (f: string) => f.split("/").pop() ?? f,
}));

function makeSingle(id: number): ChangeWithSummary {
  return {
    id,
    hash: `hash-${id}`,
    filename: `file${id}.nix`,
    diff: "",
    lineCount: 1,
    createdAt: 0,
    ownSummaryId: 1,
    title: `Change ${id}`,
    description: `Desc ${id}`,
  };
}

function makeGroup(id: number, changeCount: number): SemanticChangeGroup {
  const changes = Array.from({ length: changeCount }, (_, i) => makeSingle(id * 100 + i));
  return {
    summary: {
      id,
      title: `Group ${id}`,
      description: `Group desc ${id}`,
      status: "DONE",
      createdAt: 0,
    },
    changes,
  };
}

describe("SummaryItems", () => {
  it("renders all groups and all singles when singles fit under MAX_ITEMS", () => {
    const map: SemanticChangeMap = {
      groups: [makeGroup(1, 2)],
      singles: [makeSingle(10), makeSingle(11), makeSingle(12)],
      unsummarizedHashes: [],
    };
    render(<SummaryItems map={map} unsummarized={[]} />);
    expect(screen.getByText("Group 1")).toBeInTheDocument();
    expect(screen.getByText("Change 10")).toBeInTheDocument();
    expect(screen.getByText("Change 11")).toBeInTheDocument();
    expect(screen.getByText("Change 12")).toBeInTheDocument();
  });

  it("renders all groups regardless of count and truncates singles to MAX_ITEMS", () => {
    const map: SemanticChangeMap = {
      groups: [makeGroup(1, 2), makeGroup(2, 3)],
      singles: Array.from({ length: 8 }, (_, i) => makeSingle(i + 10)),
      unsummarizedHashes: [],
    };
    render(<SummaryItems map={map} unsummarized={[]} />);
    expect(screen.getByText("Group 1")).toBeInTheDocument();
    expect(screen.getByText("Group 2")).toBeInTheDocument();
    for (let i = 10; i < 15; i += 1) {
      expect(screen.getByText(`Change ${i}`)).toBeInTheDocument();
    }
    for (let i = 15; i < 18; i += 1) {
      expect(screen.queryByText(`Change ${i}`)).not.toBeInTheDocument();
    }
  });

  it("drops singles past MAX_ITEMS when there are no groups", () => {
    const singles = Array.from({ length: 10 }, (_, i) => makeSingle(i + 1));
    const map: SemanticChangeMap = {
      groups: [],
      singles,
      unsummarizedHashes: [],
    };
    render(<SummaryItems map={map} unsummarized={[]} />);
    for (let i = 1; i <= 5; i += 1) {
      expect(screen.getByText(`Change ${i}`)).toBeInTheDocument();
    }
    for (let i = 6; i <= 10; i += 1) {
      expect(screen.queryByText(`Change ${i}`)).not.toBeInTheDocument();
    }
  });

  it("still shows unsummarized section after truncating singles", () => {
    const map: SemanticChangeMap = {
      groups: [],
      singles: Array.from({ length: 8 }, (_, i) => makeSingle(i + 1)),
      unsummarizedHashes: [],
    };
    const unsummarized: ChangeWithRichType[] = [
      {
        id: 99,
        hash: "h99",
        filename: "u.nix",
        diff: "",
        lineCount: 1,
        createdAt: 0,
        ownSummaryId: 2,
        changeType: "edited",
        shortFilename: "u.nix",
      },
    ];
    render(<SummaryItems map={map} unsummarized={unsummarized} />);
    expect(screen.getByTestId("unsummarized")).toBeInTheDocument();
    for (let i = 1; i <= 5; i += 1) {
      expect(screen.getByText(`Change ${i}`)).toBeInTheDocument();
    }
    for (let i = 6; i <= 8; i += 1) {
      expect(screen.queryByText(`Change ${i}`)).not.toBeInTheDocument();
    }
  });
});
