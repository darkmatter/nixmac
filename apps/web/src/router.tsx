import type { AppRouter } from "@nixmac/api/routers/index";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import SuperJSON from "superjson";

import { makeTRPCClient } from "@/lib/trpc";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  const queryClient = new QueryClient({
    defaultOptions: {
      dehydrate: { serializeData: SuperJSON.serialize },
      hydrate: { deserializeData: SuperJSON.deserialize },
    },
  });

  const trpcClient = makeTRPCClient();
  const trpc = createTRPCOptionsProxy<AppRouter>({
    client: trpcClient,
    queryClient,
  });

  const router = createRouter({
    routeTree,
    context: { queryClient, trpc },
    defaultPreload: "intent",
    defaultNotFoundComponent: NotFound,
    Wrap: ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });

  setupRouterSsrQueryIntegration({
    router,
    queryClient,
  });

  return router;
}

export type Router = ReturnType<typeof getRouter>;

declare module "@tanstack/react-router" {
  // biome-ignore lint: TanStack Router requires interface augmentation for Register.
  interface Register {
    router: Router;
  }
}

function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-950 text-zinc-100">
      <div className="text-center">
        <h1 className="mb-4 font-bold text-6xl text-zinc-400">404</h1>
        <h2 className="mb-6 text-2xl">Page Not Found</h2>
        <p className="mb-8 text-zinc-400">
          The page you're looking for doesn't exist yet.
        </p>
        <Button asChild>
          <a href="/">Go Home</a>
        </Button>
      </div>
    </div>
  );
}

