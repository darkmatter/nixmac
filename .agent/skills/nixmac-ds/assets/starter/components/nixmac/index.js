"use client";

// nixmac design system — barrel export.
// Copy-in React components styled with inline styles over the CSS-variable
// tokens in ./tokens. Link ./styles.css once (see app/globals.css), then
// import components from "@/components/nixmac".

export { NixmacMark } from "./brand/NixmacMark.jsx";

export { Button } from "./buttons/Button.jsx";
export { ButtonGlow } from "./buttons/ButtonGlow.jsx";
export { BadgeButton } from "./buttons/BadgeButton.jsx";

export {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "./display/Card.jsx";
export { Badge } from "./display/Badge.jsx";
export { Alert } from "./display/Alert.jsx";
export { Kbd } from "./display/Kbd.jsx";
export { Spinner } from "./display/Spinner.jsx";
export { FileBadge } from "./display/FileBadge.jsx";
export { Separator } from "./display/Separator.jsx";

export { Input } from "./forms/Input.jsx";
export { Textarea } from "./forms/Textarea.jsx";
export { Switch } from "./forms/Switch.jsx";
export { Checkbox } from "./forms/Checkbox.jsx";
export { Label } from "./forms/Label.jsx";

export { Tabs, TabsList, TabsTrigger, TabsContent } from "./navigation/Tabs.jsx";
