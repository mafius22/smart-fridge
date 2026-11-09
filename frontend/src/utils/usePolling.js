import { useEffect, useRef } from 'react';

// Wywoluje fn od razu i co intervalMs, gdy karta przegladarki jest widoczna
export default function usePolling(fn, intervalMs, deps = []) {
  const fnRef = useRef(fn);
  useEffect(() => { fnRef.current = fn; });

  useEffect(() => {
    fnRef.current();
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') fnRef.current();
    }, intervalMs);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, ...deps]);
}
