import type { Meta, StoryObj } from "@storybook/react-vite";
import { Console } from "./console";

const meta: Meta<typeof Console> = {
  component: Console,
  title: "Components/Console",
};

export default meta;

export const Default: StoryObj<typeof Console> = {
  args: {},
};
