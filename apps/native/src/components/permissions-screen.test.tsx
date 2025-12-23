import { render } from "@testing-library/react";
import { expect, test } from "vitest";
import { defaultPermissions, PermissionsScreen } from "./permissions-screen";

test("default state matches snapshot", () => {
  const { container } = render(
    <PermissionsScreen initialPermissions={defaultPermissions} onComplete={() => {}} />,
  );
  expect(container).toMatchSnapshot();
});

test("all granted matches snapshot", () => {
  const allGranted = defaultPermissions.map((p) => ({
    ...p,
    status: "granted" as const,
  }));
  const { container } = render(
    <PermissionsScreen initialPermissions={allGranted} onComplete={() => {}} />,
  );
  expect(container).toMatchSnapshot();
});
