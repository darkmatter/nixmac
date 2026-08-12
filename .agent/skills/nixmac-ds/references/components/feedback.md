# Feedback

Source: `assets/starter/components/nixmac/display/`.

## Alert

Contextual message block on a card surface with an optional icon and title/description grid.

```tsx
import { Alert } from "@/components/nixmac";
import { Info, AlertTriangle } from "lucide-react";

<Alert icon={<Info size={16} />} title="Dry run only">
  No changes were applied to your system.
</Alert>

<Alert variant="destructive" icon={<AlertTriangle size={16} />} title="Build failed">
  attribute 'programs.direnv' does not exist
</Alert>
```

- `variant`: `default` | `destructive`.
- `destructive` renders on a faint red-tinted panel with a red-tinted border and **white title/body text**, with the red reserved for the icon — so errors stay legible. (Do not force red body text.)
- `icon`: optional 16px node; `title`: short heading; `children`: description.
- `role="alert"` is set.

## Spinner

Spinning loader icon.

```tsx
import { Spinner } from "@/components/nixmac";

<Spinner />              {/* 16px */}
<Spinner size={24} />
```

- `size` in px (default 16). Inherits `currentColor` — set `style={{ color: "var(--muted-foreground)" }}` to tint. `role="status"` + `aria-label="Loading"`.

## Badge (status use)

`Badge` doubles as a status indicator via its semantic variants — see full API in `data-display.md`.

```tsx
import { Badge } from "@/components/nixmac";

<Badge variant="success">Applied</Badge>
<Badge variant="warning">Pending</Badge>
<Badge variant="destructive">Failed</Badge>
```

Use `success`/`warning`/`destructive` for outcome states; these map to the semantic tokens (emerald/amber/red).
