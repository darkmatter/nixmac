"use client";

import {
  trendingFeed,
  type TrendingItem,
  type TrendingKind,
} from "@/components/widget/promptinput/trending-feed-data";
import { cn } from "@/lib/utils";
import {
  ArrowUpRight,
  Beer,
  Bookmark,
  BookmarkCheck,
  Flame,
  Lightbulb,
  MoreHorizontal,
  Package,
  Plus,
  Snowflake,
  Sparkles,
  TrendingUp,
  Wand2,
  X,
} from "lucide-react";
import { useState } from "react";

type Filter = "all" | TrendingKind | "saved";

const filters: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "package", label: "Packages" },
  { id: "prompt", label: "Prompts" },
  { id: "idea", label: "Ideas" },
  { id: "saved", label: "Saved" },
];

const kindMeta: Record<TrendingKind, { label: string; Icon: typeof Package }> = {
  package: { label: "Package", Icon: Package },
  prompt: { label: "Prompt", Icon: Wand2 },
  idea: { label: "Idea", Icon: Lightbulb },
};

const itemKey = (item: TrendingItem) => `${item.kind}-${item.title}`;

function LeadIcon({ item }: { item: TrendingItem }) {
  if (item.kind === "package") {
    return item.source === "nixpkgs" ? (
      <Snowflake className="size-4" aria-hidden />
    ) : (
      <Beer className="size-4" aria-hidden />
    );
  }
  const { Icon } = kindMeta[item.kind];
  return <Icon className="size-4" aria-hidden />;
}

function ItemBadge({ item }: { item: TrendingItem }) {
  if (item.badge === "new") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-foreground px-1.5 py-0.5 font-semibold text-[10px] text-background uppercase tracking-wide">
        <Sparkles className="size-2.5" aria-hidden />
        New
      </span>
    );
  }
  if (item.badge === "trending") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-1.5 py-0.5 font-semibold text-[10px] text-secondary-foreground uppercase tracking-wide">
        <TrendingUp className="size-2.5" aria-hidden />
        Trending
      </span>
    );
  }
  return null;
}

/**
 * Mixed trending feed of packages, prompts, and ideas. Sits under the prompt
 * input. Per-row 3-dot menu to use / save / dismiss, plus filter tabs and a
 * Saved view. Calls `onSelect` with a ready-to-run prompt.
 */
export function TrendingFeed({
  onSelect,
  pageSize = 6,
}: {
  onSelect: (prompt: string) => void;
  pageSize?: number;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [bookmarked, setBookmarked] = useState<Set<string>>(new Set());
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  const toggle = (set: Set<string>, key: string) => {
    const copy = new Set(set);
    if (copy.has(key)) {
      copy.delete(key);
    } else {
      copy.add(key);
    }
    return copy;
  };

  const items = trendingFeed
    .filter((i) => !dismissed.has(itemKey(i)))
    .filter((i) => {
      if (filter === "all") return true;
      if (filter === "saved") return bookmarked.has(itemKey(i));
      return i.kind === filter;
    })
    .slice(0, pageSize);

  return (
    <section aria-label="Trending on nixmac">
      <div className="mb-2.5 flex items-center justify-between">
        <div className="flex items-center gap-1.5 font-medium text-foreground text-sm">
          <Flame className="size-4 text-foreground" aria-hidden />
          Trending on nixmac
        </div>
        <div className="flex items-center gap-1" role="tablist" aria-label="Filter trending feed">
          {filters.map((f) => {
            const count = f.id === "saved" ? bookmarked.size : 0;
            return (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={cn(
                  "flex items-center gap-1 rounded-full px-2.5 py-1 text-xs transition-colors",
                  filter === f.id
                    ? "bg-secondary font-medium text-secondary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {f.id === "saved" ? <Bookmark className="size-3" aria-hidden /> : null}
                {f.label}
                {f.id === "saved" && count > 0 ? (
                  <span className="text-muted-foreground">{count}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      {items.length === 0 ? (
        <div className="rounded-lg border border-border border-dashed bg-card/20 px-4 py-8 text-center text-muted-foreground text-sm">
          {filter === "saved"
            ? "Nothing saved yet. Tap the bookmark on any item to keep it here."
            : "Nothing left here. Try another filter."}
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {items.map((item) => {
            const key = itemKey(item);
            const saved = bookmarked.has(key);
            return (
              <li
                key={key}
                className="group relative flex items-center gap-3 rounded-lg border border-border bg-card/40 pr-2 pl-3 transition-colors hover:border-foreground/30 hover:bg-card"
              >
                <button
                  type="button"
                  onClick={() => onSelect(item.prompt)}
                  className="flex min-w-0 flex-1 items-center gap-3 py-2.5 text-left"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground">
                    <LeadIcon item={item} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span
                        className={cn(
                          "truncate font-medium text-foreground text-sm",
                          item.kind === "package" && "font-mono",
                        )}
                      >
                        {item.title}
                      </span>
                      <ItemBadge item={item} />
                    </span>
                    <span className="mt-0.5 block truncate text-muted-foreground text-xs leading-relaxed">
                      {item.desc}
                    </span>
                  </span>
                </button>

                <span className="relative flex shrink-0 items-center">
                  {saved ? (
                    <BookmarkCheck
                      className="mr-1 size-4 text-foreground"
                      aria-label={`${item.title} is saved`}
                    />
                  ) : null}
                  <button
                    type="button"
                    aria-label={`Actions for ${item.title}`}
                    aria-haspopup="menu"
                    aria-expanded={openMenu === key}
                    onClick={() => setOpenMenu((k) => (k === key ? null : key))}
                    className={cn(
                      "flex size-7 items-center justify-center rounded-md transition-colors",
                      openMenu === key
                        ? "bg-secondary text-foreground"
                        : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                    )}
                  >
                    <MoreHorizontal className="size-4" aria-hidden />
                  </button>

                  {openMenu === key ? (
                    <>
                      <button
                        type="button"
                        aria-label="Close menu"
                        tabIndex={-1}
                        onClick={() => setOpenMenu(null)}
                        className="fixed inset-0 z-10 cursor-default"
                      />
                      <div
                        role="menu"
                        className="absolute top-9 right-0 z-20 w-40 overflow-hidden rounded-lg border border-border bg-popover py-1 shadow-black/40 shadow-xl"
                      >
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            onSelect(item.prompt);
                            setOpenMenu(null);
                          }}
                          className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-popover-foreground text-sm transition-colors hover:bg-accent"
                        >
                          <Plus className="size-4 text-muted-foreground" aria-hidden />
                          Use
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setBookmarked((s) => toggle(s, key));
                            setOpenMenu(null);
                          }}
                          className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-popover-foreground text-sm transition-colors hover:bg-accent"
                        >
                          {saved ? (
                            <BookmarkCheck className="size-4 text-muted-foreground" aria-hidden />
                          ) : (
                            <Bookmark className="size-4 text-muted-foreground" aria-hidden />
                          )}
                          {saved ? "Saved" : "Save"}
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setDismissed((s) => toggle(s, key));
                            setOpenMenu(null);
                          }}
                          className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-popover-foreground text-sm transition-colors hover:bg-accent"
                        >
                          <X className="size-4 text-muted-foreground" aria-hidden />
                          Dismiss
                        </button>
                      </div>
                    </>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <button
        type="button"
        onClick={() => {}}
        className="mt-3 inline-flex items-center gap-1 text-muted-foreground text-xs transition-colors hover:text-foreground"
      >
        Browse everything trending
        <ArrowUpRight className="size-3.5" aria-hidden />
      </button>
    </section>
  );
}
