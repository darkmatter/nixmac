import { useQuery } from "@tanstack/react-query";
import { orpc } from "@/lib/orpc";

/**
 * This Mac's system hostname (trimmed), fetched once and cached via React Query.
 *
 * Returns `""` until the value loads or when the backend reports an empty name.
 * Shared by the onboarding source pickers and the bootstrap control, which each
 * seed an editable host field from it.
 */
export function useThisHostname(): string {
  const { data } = useQuery(orpc.config.getThisHostname.queryOptions());
  return data?.trim() ?? "";
}
