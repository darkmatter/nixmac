import { auth } from "@nixmac/auth";
import type { Context as HonoContext } from "hono";

export type CreateContextOptions = {
  context?: HonoContext;
  headers?: Headers;
};

export async function createContext({ context, headers }: CreateContextOptions) {
  const requestHeaders = headers ?? context?.req.raw.headers;
  if (!requestHeaders) {
    throw new Error("createContext requires either `headers` or a Hono `context`");
  }
  const session = await auth.api.getSession({
    headers: requestHeaders,
  });
  return {
    session,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
