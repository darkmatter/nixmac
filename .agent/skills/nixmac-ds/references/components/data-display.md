# Data display

Source: `assets/starter/components/nixmac/display/`.

## Card

Surface container — rounded 12px (`--radius-xl`) card with border + subtle shadow on `--card`. The app's review panels, settings groups, and proof tiles are all Cards. Compose with the subparts.

```tsx
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, Button } from "@/components/nixmac";

<Card>
  <CardHeader>
    <CardTitle>Proposed changes</CardTitle>
    <CardDescription>3 files will be modified</CardDescription>
  </CardHeader>
  <CardContent>
    {/* body */}
  </CardContent>
  <CardFooter>
    <Button variant="ghost">Discard</Button>
    <Button>Apply</Button>
  </CardFooter>
</Card>
```

- `Card` is a vertical flex with 24px gaps and `24px 0` padding; the subparts supply the horizontal `0 24px` padding. Keep content inside `CardHeader`/`CardContent`/`CardFooter` so padding lines up — don't put bare children directly in `Card`.
- `CardTitle` is 16px/600; `CardDescription` is 14px muted.

## Badge

Small status/label pill. Full variant set:

```tsx
<Badge>default</Badge>
<Badge variant="secondary">secondary</Badge>
<Badge variant="outline">outline</Badge>
<Badge variant="destructive">Failed</Badge>
<Badge variant="success">Applied</Badge>
<Badge variant="warning">Pending</Badge>
<Badge variant="brand">Pro</Badge>
```

- `variant`: `default` | `secondary` | `outline` | `destructive` | `success` | `warning` | `brand`.
- `brand` is a lime-outline treatment — use it for brand/plan tags, sparingly.
- Used for change counts ("3 changes"), states, and file kinds.

## Kbd

Keyboard-key cap for shortcuts.

```tsx
import { Kbd } from "@/components/nixmac";
<Kbd>⌘K</Kbd> <Kbd>Esc</Kbd> <Kbd>↵</Kbd>
```

## FileBadge — mono path chip

Monospace `<code>` pill for file paths, store paths, commands, and hashes. This is how nixmac names files inline.

```tsx
import { FileBadge } from "@/components/nixmac";
import { FileCode } from "lucide-react";

<FileBadge icon={<FileCode size={12} />}>modules/home/programs/direnv.nix</FileBadge>
<FileBadge>/nix/store/abc123…-hello-2.12</FileBadge>
```

- `icon`: optional 12px leading node. Content renders in `var(--font-mono)`. Use this (not a raw `<code>`) for any path/hash in UI.

## Separator

Hairline divider on `--border`.

```tsx
import { Separator } from "@/components/nixmac";
<Separator />                          {/* horizontal */}
<Separator orientation="vertical" />   {/* needs a height from its parent */}
```

- `orientation`: `horizontal` (default) | `vertical`. `role="separator"` set. For vertical, give the parent a fixed height (e.g. a flex row).
