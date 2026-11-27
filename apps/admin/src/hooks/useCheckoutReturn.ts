import { useEffect, useRef, useState } from "react";

/**
 * Back on Billing after paying on garnishtable.com/checkout (the API's checkout hand-off returns to
 * `?checkout=complete`). Paddle's signed webhook activates the plan a few seconds later, so the page
 * shows a notice and re-reads the subscription every 4 seconds until `done` (or about a minute),
 * then removes the marker from the address bar. It never marks anything paid itself.
 */
export function useCheckoutReturn(reload: () => Promise<unknown> | void, done: boolean): boolean {
  const [waiting, setWaiting] = useState(() => new URLSearchParams(window.location.search).get("checkout") === "complete");
  const [tries, setTries] = useState(0);
  const reloadRef = useRef(reload);
  reloadRef.current = reload;

  useEffect(() => {
    if (!waiting) return;
    if (done || tries >= 15) {
      setWaiting(false);
      const url = new URL(window.location.href);
      url.searchParams.delete("checkout");
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
      return;
    }
    const t = window.setTimeout(() => {
      void Promise.resolve(reloadRef.current()).finally(() => setTries((n) => n + 1));
    }, 4000);
    return () => window.clearTimeout(t);
  }, [waiting, done, tries]);

  return waiting;
}
