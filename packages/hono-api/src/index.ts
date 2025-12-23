import { trpcServer } from "@hono/trpc-server";
import { createContext } from "@nixmac/api/context";
import { appRouter } from "@nixmac/api/routers/index";
import { auth } from "@nixmac/auth";
import { Hono } from "hono";

export const apiApp = new Hono();

// Auth (better-auth)
apiApp.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

// tRPC
apiApp.use(
  "/trpc/*",
  trpcServer({
    router: appRouter,
    createContext: (_opts, context) => createContext({ context }),
  }),
);
