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
