/**
 * Client fetch helper with timeout — soft failures for in-flight staging jobs.
 */

export type TimedFetchResult =
  | { ok: true; res: Response }
  | { ok: false; timedOut: true; error: string }
  | { ok: false; timedOut: false; error: string };

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<TimedFetchResult> {
  const { timeoutMs = 20_000, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const external = rest.signal;
  const onExternalAbort = () => controller.abort();
  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener("abort", onExternalAbort, { once: true });
  }

  try {
    const res = await fetch(input, { ...rest, signal: controller.signal });
    return { ok: true, res };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const timedOut =
      (err instanceof Error && err.name === "AbortError") ||
      /aborted|timeout/i.test(message);
    if (timedOut || /failed to fetch|networkerror|load failed/i.test(message)) {
      return {
        ok: false,
        timedOut: true,
        error: "Still processing — check back in a moment.",
      };
    }
    return { ok: false, timedOut: false, error: message };
  } finally {
    clearTimeout(timer);
    if (external) external.removeEventListener("abort", onExternalAbort);
  }
}
