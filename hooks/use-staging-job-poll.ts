"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { fetchWithTimeout } from "@/lib/staging/client-fetch";

export type StagingJobStatus =
  | "queued"
  | "processing"
  | "succeeded"
  | "failed"
  | "cancelled"
  | string;

export type StagingJob = {
  id: string;
  tour_id: string;
  scene_id: string | null;
  kind: string;
  status: StagingJobStatus;
  params: Record<string, unknown>;
  result_path: string | null;
  error: string | null;
  cost_cents: number | null;
  provider?: string | null;
  provider_job_id?: string | null;
  step?: number | null;
  total_steps?: number | null;
  view_results?: unknown;
  created_at: string;
  updated_at: string;
};

type Options = {
  stopOnTerminal?: boolean;
  initialDelayMs?: number;
  maxDelayMs?: number;
  /** Stop polling after this many ms even if still processing. Default 10 min. */
  maxPollMs?: number;
  enabled?: boolean;
};

const TERMINAL = new Set<string>(["succeeded", "failed", "cancelled"]);

/**
 * Poll GET /api/staging/jobs/[id] with exponential backoff and a hard deadline.
 */
export function useStagingJobPoll(
  jobId: string | null,
  options: Options = {},
) {
  const {
    stopOnTerminal = true,
    initialDelayMs = 1000,
    maxDelayMs = 12_000,
    maxPollMs = 10 * 60 * 1000,
    enabled = true,
  } = options;

  const [job, setJob] = useState<StagingJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const delayRef = useRef(initialDelayMs);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAtRef = useRef(0);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const fetchOnce = useCallback(async () => {
    if (!jobId) return null;
    const result = await fetchWithTimeout(`/api/staging/jobs/${jobId}`, {
      method: "GET",
      credentials: "same-origin",
      timeoutMs: 15_000,
    });
    if (!result.ok) {
      if (result.timedOut) {
        throw Object.assign(new Error(result.error), { soft: true });
      }
      throw new Error(result.error);
    }
    const json = (await result.res.json()) as {
      job?: StagingJob;
      error?: string;
    };
    if (!result.res.ok) {
      throw new Error(json.error ?? `HTTP ${result.res.status}`);
    }
    return json.job ?? null;
  }, [jobId]);

  useEffect(() => {
    clearTimer();
    delayRef.current = initialDelayMs;
    setJob(null);
    setError(null);
    startedAtRef.current = Date.now();

    if (!jobId || !enabled) {
      setIsPolling(false);
      return;
    }

    let cancelled = false;
    setIsPolling(true);

    const tick = async () => {
      if (Date.now() - startedAtRef.current > maxPollMs) {
        setIsPolling(false);
        setError(
          "Still processing — check back in a moment. Polling paused after 10 minutes.",
        );
        return;
      }

      try {
        const next = await fetchOnce();
        if (cancelled) return;
        setJob(next);
        setError(null);

        if (next && stopOnTerminal && TERMINAL.has(next.status)) {
          setIsPolling(false);
          return;
        }

        const delay = delayRef.current;
        delayRef.current = Math.min(maxDelayMs, Math.round(delay * 1.5));
        timerRef.current = setTimeout(() => {
          void tick();
        }, delay);
      } catch (err) {
        if (cancelled) return;
        const soft =
          err instanceof Error &&
          (err as Error & { soft?: boolean }).soft === true;
        const message =
          err instanceof Error ? err.message : "Polling failed.";
        // Soft errors (timeout / Failed to fetch) are informational — keep polling.
        setError(message);
        if (!soft && /unauthorized|forbidden|not found/i.test(message)) {
          setIsPolling(false);
          return;
        }
        timerRef.current = setTimeout(() => {
          void tick();
        }, delayRef.current);
        delayRef.current = Math.min(
          maxDelayMs,
          Math.round(delayRef.current * 1.5),
        );
      }
    };

    void tick();

    return () => {
      cancelled = true;
      clearTimer();
      setIsPolling(false);
    };
  }, [
    jobId,
    enabled,
    stopOnTerminal,
    initialDelayMs,
    maxDelayMs,
    maxPollMs,
    fetchOnce,
    clearTimer,
  ]);

  return { job, error, isPolling, refresh: fetchOnce };
}

export function stagingJobStatusLabel(
  status: StagingJobStatus | null | undefined,
  error?: string | null,
): string {
  switch (status) {
    case null:
    case undefined:
      return "Idle";
    case "queued":
      return "Queued…";
    case "processing":
      return "Processing…";
    case "succeeded":
      return "Ready to review";
    case "failed":
      return `Failed: ${error ?? "unknown"}`;
    case "cancelled":
      return "Discarded";
    default:
      return `Status: ${status}`;
  }
}
