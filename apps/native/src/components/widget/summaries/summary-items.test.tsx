import type { ChangeWithRichType } from "@/components/widget/utils";
import type { ChangeWithSummary, SemanticChangeGroup, SemanticChangeMap } from "@/types/shared";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SummaryItems } from "./summary-items";

vi.mock("@/components/ui/collapsible", () => ({
  Collapsible: ({ children }: { children: React.ReactNode }) => <div data-testid="collapsible">{children}</div>,
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
    ownSummaryId: null,
    title: `Change ${id}`,
    description: `Desc ${id}`,
  };
}

function makeGroup(id: number, changeCount: number): SemanticChangeGroup {
  const changes = Array.from({ length: changeCount }, (_, i) => makeSingle(id * 100 + i));
  return {
    summary: { id, title: `Group ${id}`, description: `Group desc ${id}`, status: "DONE", createdAt: 0 },
    changes,
  };
}

describe("SummaryItems", () => {
  it("shows all items when 5 or fewer", () => {
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
    expect(screen.queryByText(/more file/)).not.toBeInTheDocument();
  });

  it("truncates after 5 items and shows remaining count", () => {
    const map: SemanticChangeMap = {
      groups: [makeGroup(1, 2), makeGroup(2, 3)],
      singles: [makeSingle(10), makeSingle(11), makeSingle(12), makeSingle(13)],
      unsummarizedHashes: [],
    };
    render(<SummaryItems map={map} unsummarized={[]} />);
    expect(screen.getByText("Group 1")).toBeInTheDocument();
    expect(screen.getByText("Group 2")).toBeInTheDocument();
    expect(screen.getByText("Change 10")).toBeInTheDocument();
    expect(screen.getByText("Change 11")).toBeInTheDocument();
    expect(screen.getByText("Change 12")).toBeInTheDocument();
    expect(screen.queryByText("Change 13")).not.toBeInTheDocument();
    expect(screen.getByText("…and 1 more file")).toBeInTheDocument();
  });

  it("uses plural for multiple remaining", () => {
    const singles = Array.from({ length: 10 }, (_, i) => makeSingle(i + 1));
    const map: SemanticChangeMap = {
      groups: [],
      singles,
      unsummarizedHashes: [],
    };
    render(<SummaryItems map={map} unsummarized={[]} />);
    expect(screen.getByText("…and 5 more files")).toBeInTheDocument();
  });

  it("still shows unsummarized section after truncation", () => {
    const map: SemanticChangeMap = {
      groups: [],
      singles: Array.from({ length: 8 }, (_, i) => makeSingle(i + 1)),
      unsummarizedHashes: [],
    };
    const unsummarized: ChangeWithRichType[] = [
      { id: 99, hash: "h99", filename: "u.nix", diff: "", lineCount: 1, createdAt: 0, ownSummaryId: null, changeType: "edited", shortFilename: "u.nix" },
    ];
    render(<SummaryItems map={map} unsummarized={unsummarized} />);
    expect(screen.getByTestId("unsummarized")).toBeInTheDocument();
    expect(screen.getByText("…and 3 more files")).toBeInTheDocument();
  });
});
