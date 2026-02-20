import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/privacy-policy")({
  component: PrivacyPolicyPage,
});

function PrivacyPolicyPage() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-6">
      <div className="text-center">
        <h1 className="mb-4 font-bold text-4xl">Privacy Policy</h1>
        <p className="text-muted-foreground text-lg">Coming soon</p>
      </div>
    </div>
  );
}
