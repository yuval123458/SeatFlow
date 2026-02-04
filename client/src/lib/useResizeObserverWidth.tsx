import { useEffect, useState } from "react";

export function useResizeObserverWidth<T extends HTMLElement>() {
  const [el, setEl] = useState<T | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    if (!el) return;

    const update = () => setWidth(el.clientWidth);
    update();

    const ro = new ResizeObserver(update);
    ro.observe(el);

    return () => ro.disconnect();
  }, [el]);

  return { ref: setEl, width };
}
