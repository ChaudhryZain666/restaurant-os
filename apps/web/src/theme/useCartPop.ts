import { useEffect, useRef, useState } from "react";

/** True for a brief moment right after the cart's item count increases — every theme's Header
 *  uses this to trigger its own "pop" animation on the cart badge, without owning cart state
 *  itself (the count is passed in, not read from CartContext). */
export function useCartPop(itemCount: number): boolean {
  const [popping, setPopping] = useState(false);
  const prevCount = useRef(itemCount);

  useEffect(() => {
    if (itemCount > prevCount.current) {
      setPopping(true);
      const t = setTimeout(() => setPopping(false), 320);
      prevCount.current = itemCount;
      return () => clearTimeout(t);
    }
    prevCount.current = itemCount;
  }, [itemCount]);

  return popping;
}
