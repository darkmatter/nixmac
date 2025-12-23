import { useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/dashboard")({
  component: RouteComponent,
  beforeLoad: async () => {
    const session = await authClient.getSession();
    if (!session.data) {
      throw redirect({ to: "/login" });
    }

    const customerStateRes = await authClient.customer.state();
    const customerState = (customerStateRes.data as { activeSubscriptions?: {}[] } | null) ?? null;

    return { session, customerState };
  },
});

function RouteComponent() {
  const { trpc, session, customerState } = Route.useRouteContext();

  const privateData = useQuery(trpc.privateData.queryOptions());

  const hasProSubscription = (customerState?.activeSubscriptions?.length ?? 0) > 0;

  return (
    <div>
      <h1>Dashboard</h1>
      <p>Welcome {session.data?.user.name}</p>
      <p>API: {privateData.data?.message}</p>
      <p>Plan: {hasProSubscription ? "Pro" : "Free"}</p>
      {hasProSubscription ? (
        <Button onClick={async () => await authClient.customer.portal()}>
          Manage Subscription
        </Button>
      ) : (
        <Button onClick={async () => await authClient.checkout({ slug: "pro" })}>
          Upgrade to Pro
        </Button>
      )}
    </div>
  );
}
