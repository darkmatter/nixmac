import { createContext } from "@nixmac/api/context";
import type { AppRouter } from "@nixmac/api/routers/index";
import { appRouter } from "@nixmac/api/routers/index";
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import {
  createTRPCClient,
  httpBatchStreamLink,
  loggerLink,
  unstable_localLink,
} from "@trpc/client";
import { createTRPCContext } from "@trpc/tanstack-react-query";
import SuperJSON from "superjson";

export const makeTRPCClient = createIsomorphicFn()
  .server(() =>
    createTRPCClient<AppRouter>({
      links: [
        unstable_localLink({
          router: appRouter,
          transformer: SuperJSON,
          createContext: () => {
            const headers = new Headers(getRequestHeaders());
            headers.set("x-trpc-source", "tanstack-start-server");
            return createContext({ headers });
          },
        }),
      ],
    }),
  )
  .client(() =>
    createTRPCClient<AppRouter>({
      links: [
        loggerLink({
          enabled: (op) =>
            import.meta.env.DEV || (op.direction === "down" && op.result instanceof Error),
        }),
        httpBatchStreamLink({
          transformer: SuperJSON,
          url: "/trpc",
          headers() {
            const headers = new Headers();
            headers.set("x-trpc-source", "tanstack-start-client");
            return headers;
          },
        }),
      ],
    }),
  );

export const { useTRPC, TRPCProvider } = createTRPCContext<typeof appRouter>();
