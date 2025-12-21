import { createFileRoute } from "@tanstack/react-router";
import LandingPage from "@/components/landing-page.alt";

export const Route = createFileRoute("/lp2")({
  component: LandingPage,
});
