# Example — agent diff-review screen

The canonical nixmac surface: a prompt composer beside a review/diff panel. This pattern is adapted from the validated starter (`assets/starter/components/site/showcase.tsx`); it compiles against the public barrel. Self-contained with inline token styles so it drops into any client page.

Key patterns to copy: `ButtonGlow` as the single build action, `FileBadge` (mono) for paths, `Tabs` for review/diff, the **diff palette** for `+`/`-` lines, `Badge variant="success"` for build status, and mono `+N` change counts.

```tsx
"use client";

import { useState } from "react";
import { Check, FileCode, Sparkles } from "lucide-react";
import {
  Badge, BadgeButton, Button, ButtonGlow,
  Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter,
  FileBadge, Tabs, TabsList, TabsTrigger, TabsContent, Textarea,
} from "@/components/nixmac";

type Line = { t: "add" | "rem" | "ctx"; s: string };

const DIFF: Line[] = [
  { t: "ctx", s: "  system.defaults.dock = {" },
  { t: "rem", s: "-   autohide = false;" },
  { t: "add", s: "+   autohide = true;" },
  { t: "add", s: "+   autohide-delay = 0.0;" },
  { t: "ctx", s: "  };" },
];

function diffColor(t: Line["t"]) {
  return t === "add" ? "var(--diff-added)" : t === "rem" ? "var(--diff-removed)" : "var(--muted-foreground)";
}
function diffBg(t: Line["t"]) {
  if (t === "add") return "color-mix(in oklch, var(--diff-added) 10%, transparent)";
  if (t === "rem") return "color-mix(in oklch, var(--diff-removed) 10%, transparent)";
  return "transparent";
}

export function DiffReview() {
  const [prompt, setPrompt] = useState("Autohide the Dock and enable Touch ID for sudo");

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
        gap: "var(--space-6)",
        maxWidth: 1000,
        margin: "0 auto",
        padding: "var(--space-6)",
      }}
    >
      {/* Prompt composer */}
      <Card>
        <CardHeader>
          <CardTitle>Describe a change</CardTitle>
          <CardDescription>Plain English in, a checked diff out.</CardDescription>
        </CardHeader>
        <CardContent>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            <Textarea rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
            <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}>
              <BadgeButton icon={<Sparkles size={12} />}>Autohide the Dock</BadgeButton>
              <BadgeButton badgeVariant="teal" icon={<Sparkles size={12} />}>Touch ID for sudo</BadgeButton>
            </div>
          </div>
        </CardContent>
        <CardFooter>
          <ButtonGlow>
            <Sparkles size={14} /> Build &amp; test
          </ButtonGlow>
          <Button variant="ghost">Discard</Button>
        </CardFooter>
      </Card>

      {/* Review + diff */}
      <Card style={{ gap: 0, padding: 0, overflow: "hidden" }}>
        <Tabs defaultValue="review">
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "14px 16px",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <TabsList>
              <TabsTrigger value="review">Review</TabsTrigger>
              <TabsTrigger value="diff">Diff</TabsTrigger>
            </TabsList>
            <Badge variant="success">
              <Check size={12} /> build passed
            </Badge>
          </div>

          <TabsContent value="review" style={{ margin: 0, padding: 16 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontSize: "var(--text-sm)", fontWeight: 500 }}>Enable Dock autohide</div>
                  <div style={{ fontSize: "var(--text-xs)", color: "var(--muted-foreground)", marginTop: 3 }}>
                    Hides the Dock until you reach for it.
                  </div>
                </div>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--muted-foreground)" }}>
                  +3
                </span>
              </div>
              <FileBadge icon={<FileCode size={12} />}>modules/darwin/dock.nix</FileBadge>
            </div>
          </TabsContent>

          <TabsContent value="diff" style={{ margin: 0, padding: 16 }}>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "var(--text-xs)",
                borderRadius: "var(--radius-md)",
                overflow: "hidden",
                border: "1px solid var(--border)",
              }}
            >
              {DIFF.map((l, i) => (
                <div key={i} style={{ padding: "2px 10px", whiteSpace: "pre", color: diffColor(l.t), background: diffBg(l.t) }}>
                  {l.s}
                </div>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </Card>
    </div>
  );
}
```

Notes:
- The container uses `repeat(auto-fit, minmax(320px, 1fr))` so the two cards sit side-by-side on desktop and stack on narrow screens — the token-driven responsiveness pattern from `foundations/spacing-layout.md`.
- Diff line backgrounds are a 10% mix of the diff token over transparent; the glyph/text is the full-strength token. Never use plain green/red here.
- `ButtonGlow` is the only glow on the screen — the build action.
