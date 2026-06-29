import { useQuery } from "@tanstack/react-query";
import { orpc } from "@/lib/orpc";

/**
 * Whether `dir` already contains a `flake.nix`, fetched via React Query.
 *
 * - `false` when `dir` is empty (nothing to probe).
 * - `null` while the probe for a non-empty `dir` is in flight.
 * - the backend result (defaulting to `false` on error) once resolved.
 */
export function useFlakeExists(dir: string): boolean | null {
  const { data, isLoading } = useQuery(
    orpc.flake.existsAt.queryOptions({
      input: { dir },
      enabled: dir.length > 0,
    }),
  );
  if (!dir) return false;
  if (isLoading) return null;
  return data ?? false;
}
