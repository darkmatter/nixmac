import { useEffect, useState } from "react";

export function useThrottle<T>(value: T, delay: number): T {
  const [throttledValue, setThrottledValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setThrottledValue(value);
    }, delay);

    // Cleanup the timeout if the effect runs again before the delay completes
    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return throttledValue;
}
