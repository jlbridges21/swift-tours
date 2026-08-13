"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type StagingJobStatus =
  | "queued"
  | "processing"
  | "succeeded"
  | "failed"
  | "cancelled";

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
  created_at: string;
  updated_at: string;
};

type Options = {
  /** Stop polling when status is terminal. Default true. */
  stopOnTerminal?: boolean;
  /** Initial delay in ms. Default 800. */
  initialDelayMs?: number;
  /** Max delay in ms. Default 8000. */
  maxDelayMs?: number;
  /** When true, start polling immediately. */
  enabled?: boolean;
};

const TERMINAL = new Set<StagingJobStatus>([
  "succeeded",
  "failed",
  "cancelled",
]);

/**
 * Poll GET /api/staging/jobs/[id] with exponential backoff.
 * Ready for the editor UI — does not create or process jobs itself.
 */
export function useStagingJobPoll(
  jobId: string | null,
  options: Options = {},
) {
  const {
    stopOnTerminal = true,
    initialDelayMs = 800,
    maxDelayMs = 8000,
    enabled = true,
  } = options;

  const [job, setJob] = useState<StagingJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const delayRef = useRef(initialDelayMs);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const fetchOnce = useCallback(async () => {
    if (!jobId) return null;
    const res = await fetch(`/api/staging/jobs/${jobId}`, {
      method: "GET",
      credentials: "same-origin",
    });
    const json = (await res.json()) as { job?: StagingJob; error?: string };
    if (!res.ok) {
      throw new Error(json.error ?? `HTTP ${res.status}`);
    }
    return json.job ?? null;
  }, [jobId]);

  useEffect(() => {
    clearTimer();
    delayRef.current = initialDelayMs;
    setJob(null);
    setError(null);

    if (!jobId || !enabled) {
      setIsPolling(false);
      return;
    }

    let cancelled = false;
    setIsPolling(true);

    const tick = async () => {
      try {
        const next = await fetchOnce();
        if (cancelled) return;
        setJob(next);
        setError(null);

        if (
          next &&
          stopOnTerminal &&
          TERMINAL.has(next.status as StagingJobStatus)
        ) {
          setIsPolling(false);
          return;
        }

        const delay = delayRef.current;
        delayRef.current = Math.min(maxDelayMs, Math.round(delay * 1.6));
        timerRef.current = setTimeout(() => {
          void tick();
        }, delay);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Polling failed.");
        timerRef.current = setTimeout(() => {
          void tick();
        }, delayRef.current);
        delayRef.current = Math.min(maxDelayMs, Math.round(delayRef.current * 1.6));
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
    fetchOnce,
    clearTimer,
  ]);

  return { job, error, isPolling, refresh: fetchOnce };
}
