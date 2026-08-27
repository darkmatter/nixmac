/**
 * Throwaway smoke fixture — reviewer-recheck-smoke2 branch only. The bug was
 * real and is fixed: the minimum is now inclusive.
 */
export function clampLower(value: number, min: number): number {
  return value < min ? min : value;
}
