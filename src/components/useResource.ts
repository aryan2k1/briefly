import { useEffect, useState } from "react";
import { errorMessage, request, unauthorized } from "./api";

export function useResource<T>(
  path: string | null,
  revision: number | string,
  onExpired: () => void,
  parser: (value: unknown) => T,
) {
  const [result, setResult] = useState<{
    key: string;
    value?: T;
    error?: string;
  } | null>(null);
  const key = `${revision}:${path}`;
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    request<T>(path, parser, { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setResult({ key, value });
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          if (unauthorized(error)) onExpired();
          else setResult({ key, error: errorMessage(error) });
        }
      });
    return () => controller.abort();
  }, [key, path, onExpired, parser]);
  return {
    value: result?.key === key ? result.value : undefined,
    error: result?.key === key ? result.error : undefined,
    loading: Boolean(path) && result?.key !== key,
  };
}
