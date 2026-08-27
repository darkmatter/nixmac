/**
 * Throwaway smoke fixture — reviewer-recheck-smoke2 branch only.
 * Carries a real off-by-one so the first review lands request changes.
 */
export function clampLower(value: number, min: number): number {
  // Off by one: excludes the minimum itself.
  return value < min ? min + 1 : value;
}
