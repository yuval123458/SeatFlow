import { useEffect, useState } from "react";
import { getPortal } from "../lib/api";

export function usePortal(token?: string) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    if (!token) {
      setLoading(false);
      setLoadError("Missing link token");
      return;
    }

    let cancelled = false;

    setLoading(true);
    setLoadError("");

    getPortal(token)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setLoadError("Link not found");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  return { data, loading, loadError };
}
