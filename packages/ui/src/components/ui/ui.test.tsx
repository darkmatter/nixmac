import { render } from "@testing-library/react";
import { expect, test } from "vitest";

import { Badge } from "./badge";
import { Button } from "./button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./card";
import { CopyButton } from "./copy-button";
import { Input } from "./input";
import { Skeleton } from "./skeleton";
import { Textarea } from "./textarea";

// Button
test("Button default matches snapshot", () => {
  const { container } = render(<Button>Click me</Button>);
  expect(container).toMatchSnapshot();
});

test("Button variants match snapshot", () => {
  const { container } = render(
    <div>
      <Button variant="default">Default</Button>
      <Button variant="destructive">Destructive</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="link">Link</Button>
    </div>,
  );
  expect(container).toMatchSnapshot();
});

test("Button sizes match snapshot", () => {
  const { container } = render(
    <div>
      <Button size="default">Default</Button>
      <Button size="sm">Small</Button>
      <Button size="lg">Large</Button>
      <Button size="icon">I</Button>
    </div>,
  );
  expect(container).toMatchSnapshot();
});

test("Button disabled matches snapshot", () => {
  const { container } = render(<Button disabled>Disabled</Button>);
  expect(container).toMatchSnapshot();
});

// Badge
test("Badge default matches snapshot", () => {
  const { container } = render(<Badge>Badge</Badge>);
  expect(container).toMatchSnapshot();
});

test("Badge variants match snapshot", () => {
  const { container } = render(
    <div>
      <Badge variant="default">Default</Badge>
      <Badge variant="secondary">Secondary</Badge>
      <Badge variant="destructive">Destructive</Badge>
      <Badge variant="outline">Outline</Badge>
    </div>,
  );
  expect(container).toMatchSnapshot();
});

// Card
test("Card matches snapshot", () => {
  const { container } = render(
    <Card>
      <CardHeader>
        <CardTitle>Card Title</CardTitle>
        <CardDescription>Card description text</CardDescription>
        <CardAction>Action</CardAction>
      </CardHeader>
      <CardContent>Card content goes here</CardContent>
      <CardFooter>Card footer</CardFooter>
    </Card>,
  );
  expect(container).toMatchSnapshot();
});

// Input
test("Input default matches snapshot", () => {
  const { container } = render(<Input placeholder="Enter text..." />);
  expect(container).toMatchSnapshot();
});

test("Input disabled matches snapshot", () => {
  const { container } = render(<Input disabled placeholder="Disabled" />);
  expect(container).toMatchSnapshot();
});

test("Input types match snapshot", () => {
  const { container } = render(
    <div>
      <Input placeholder="Text" type="text" />
      <Input placeholder="Email" type="email" />
      <Input placeholder="Password" type="password" />
      <Input placeholder="Number" type="number" />
    </div>,
  );
  expect(container).toMatchSnapshot();
});

// Textarea
test("Textarea matches snapshot", () => {
  const { container } = render(<Textarea placeholder="Enter message..." />);
  expect(container).toMatchSnapshot();
});

test("Textarea disabled matches snapshot", () => {
  const { container } = render(<Textarea disabled placeholder="Disabled" />);
  expect(container).toMatchSnapshot();
});

// Skeleton
test("Skeleton matches snapshot", () => {
  const { container } = render(<Skeleton className="h-4 w-[200px]" />);
  expect(container).toMatchSnapshot();
});

// CopyButton
test("CopyButton default matches snapshot", () => {
  const { container } = render(<CopyButton value="hello world" />);
  expect(container).toMatchSnapshot();
});

test("CopyButton variants match snapshot", () => {
  const { container } = render(
    <div>
      <CopyButton value="a" variant="default" size="default">
        Default
      </CopyButton>
      <CopyButton value="b" variant="secondary" size="default">
        Secondary
      </CopyButton>
      <CopyButton value="c" variant="ghost" size="default">
        Ghost
      </CopyButton>
      <CopyButton value="d" variant="outline" size="default">
        Outline
      </CopyButton>
      <CopyButton value="e" variant="destructive" size="default">
        Destructive
      </CopyButton>
    </div>,
  );
  expect(container).toMatchSnapshot();
});

test("CopyButton icon sizes match snapshot", () => {
  const { container } = render(
    <div>
      <CopyButton value="a" size="icon-sm" />
      <CopyButton value="b" size="icon" />
      <CopyButton value="c" size="icon-lg" />
    </div>,
  );
  expect(container).toMatchSnapshot();
});

test("CopyButton disabled matches snapshot", () => {
  const { container } = render(
    <CopyButton value="secret" disabled>
      Copy
    </CopyButton>,
  );
  expect(container).toMatchSnapshot();
});
