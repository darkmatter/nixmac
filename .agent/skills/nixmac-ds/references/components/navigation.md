# Navigation

Source: `assets/starter/components/nixmac/navigation/Tabs.jsx`.

## Tabs

Segmented tabs — a muted pill track (`TabsList`) of triggers; the active trigger lifts onto `--background` with a soft shadow. Used for the "review vs. diff" switch and settings sections.

```tsx
"use client";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/nixmac";

<Tabs defaultValue="review">
  <TabsList>
    <TabsTrigger value="review">Review</TabsTrigger>
    <TabsTrigger value="diff">Diff</TabsTrigger>
    <TabsTrigger value="log">Build log</TabsTrigger>
  </TabsList>
  <TabsContent value="review">{/* … */}</TabsContent>
  <TabsContent value="diff">{/* … */}</TabsContent>
  <TabsContent value="log">{/* … */}</TabsContent>
</Tabs>
```

- `Tabs`: controlled (`value` + `onValueChange`) or uncontrolled (`defaultValue`).
- `TabsList` holds `TabsTrigger`s; each `TabsTrigger`/`TabsContent` is keyed by `value`.
- `TabsContent` renders only when its `value` is active (unmounts otherwise).
- Accessible roles (`tablist`/`tab`/`tabpanel`, `aria-selected`) are wired.
- `TabsTrigger` accepts children including icons — keep the label short.

**Common mistakes**: `TabsTrigger` and `TabsContent` must share the exact same `value`; a mismatch renders an empty panel. Keep `Tabs` inside a `"use client"` tree (it uses context + state).
