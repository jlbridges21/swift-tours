"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  applyNadirFillCandidate,
  discardNadirFillCandidate,
  revertSceneCleaned,
  getTourStagingSpendCents,
} from "@/app/dashboard/tours/[id]/actions";
import { Button } from "@/components/ui/button";
import { fetchWithTimeout } from "@/lib/staging/client-fetch";
import { publicUrl } from "@/lib/storage";
import {
  stagingJobStatusLabel,
  useStagingJobPoll,
} from "@/hooks/use-staging-job-poll";
import type { Scene } from "@/types";

type NadirAiCleanProps = {
  tourId: string;
  scenes: Scene[];
  activeSceneId: string | null;
  onScenesChange: (scenes: Scene[]) => void;
};

type FillMode = "ai" | "texture";

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

async function createAndKickJob(
  tourId: string,
  sceneId: string,
  mode: FillMode,
): Promise<{ jobId?: string; error?: string }> {
  const provider = mode === "texture" ? "texture_fill" : undefined;
  const create = await fetchWithTimeout("/api/staging/jobs", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tourId,
      sceneId,
      kind: "nadir_fill",
      params: provider ? { provider } : {},
    }),
    timeoutMs: 20_000,
  });

  if (!create.ok) {
    return { error: create.error };
  }

  const createJson = (await create.res.json()) as {
    job?: { id: string };
    error?: string;
    code?: string;
  };
  if (!create.res.ok || !createJson.job) {
    const code = createJson.code ? ` [${createJson.code}]` : "";
    return {
      error: `${createJson.error ?? `HTTP ${create.res.status}`}${code}`,
    };
  }

  // Fire-and-forget — never await the heavy /process work.
  void fetchWithTimeout(`/api/staging/jobs/${createJson.job.id}/process`, {
    method: "POST",
    credentials: "same-origin",
    timeoutMs: 25_000,
  }).then((r) => {
    if (!r.ok && !r.timedOut) {
      console.warn("[nadir-ai-clean] process kick soft-fail", r.error);
    }
  });

  return { jobId: createJson.job.id };
}

export function NadirAiClean({
  tourId,
  scenes,
  activeSceneId,
  onScenesChange,
}: NadirAiCleanProps) {
  const [pending, startTransition] = useTransition();
  const [jobId, setJobId] = useState<string | null>(null);
  const [spendCents, setSpendCents] = useState(0);
  const [mode, setMode] = useState<FillMode>("ai");
  const [candidateIndex, setCandidateIndex] = useState(0);
  const { job, error: pollError, isPolling } = useStagingJobPoll(jobId, {
    enabled: Boolean(jobId),
  });

  const active =
    scenes.find((s) => s.id === activeSceneId) ?? scenes[0] ?? null;

  useEffect(() => {
    void getTourStagingSpendCents(tourId).then((result) => {
      if (typeof result.cents === "number") setSpendCents(result.cents);
    });
  }, [tourId, job?.status]);

  // Kick /process periodically while queued/processing — never await.
  useEffect(() => {
    if (!jobId || !job) return;
    if (job.status !== "queued" && job.status !== "processing") return;

    const timer = setInterval(() => {
      void fetchWithTimeout(`/api/staging/jobs/${jobId}/process`, {
        method: "POST",
        credentials: "same-origin",
        timeoutMs: 25_000,
      }).then((r) => {
        if (!r.ok && !r.timedOut) {
          console.warn("[nadir-ai-clean] process tick soft-fail", r.error);
        }
      });
    }, 4000);

    return () => clearInterval(timer);
  }, [jobId, job?.status]);

  useEffect(() => {
    if (!job || job.status !== "failed") return;
    toast.error(job.error ?? "Nadir fill failed.");
  }, [job?.status, job?.id, job?.error]);

  const candidateUrls = Array.isArray(job?.params?.candidateUrls)
    ? (job.params.candidateUrls as string[])
    : job?.result_path
      ? [publicUrl(job.result_path)]
      : [];

  const awaitingReview =
    job?.status === "succeeded" &&
    (job.params?.awaitingReview === true || candidateUrls.length > 0);

  function handleCleanScene() {
    if (!active) return;
    startTransition(async () => {
      const result = await createAndKickJob(tourId, active.id, mode);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setCandidateIndex(0);
      setJobId(result.jobId ?? null);
    });
  }

  function handleApply() {
    if (!jobId) return;
    startTransition(async () => {
      const result = await applyNadirFillCandidate(jobId, candidateIndex);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      if (job?.scene_id) {
        onScenesChange(
          scenes.map((scene) =>
            scene.id === job.scene_id
              ? {
                  ...scene,
                  cleaned_path: result.cleanedPath ?? scene.cleaned_path,
                  cleaned_enabled: true,
                }
              : scene,
          ),
        );
      }
      toast.success("Applied cleaned floor.");
      setJobId(null);
    });
  }

  function handleDiscard() {
    if (!jobId) return;
    startTransition(async () => {
      const result = await discardNadirFillCandidate(jobId);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.message("Candidate discarded — original unchanged.");
      setJobId(null);
    });
  }

  function handleRevert() {
    if (!active) return;
    startTransition(async () => {
      const result = await revertSceneCleaned(active.id);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      onScenesChange(
        scenes.map((scene) =>
          scene.id === active.id
            ? {
                ...scene,
                cleaned_path: null,
                cleaned_compat_path: null,
                cleaned_enabled: false,
              }
            : scene,
        ),
      );
      toast.success("Reverted to original panorama.");
    });
  }

  function handleRetry(nextMode: FillMode = mode) {
    setMode(nextMode);
    setJobId(null);
    if (!active) return;
    startTransition(async () => {
      const result = await createAndKickJob(tourId, active.id, nextMode);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setJobId(result.jobId ?? null);
    });
  }

  const busy = pending || Boolean(jobId && isPolling && !awaitingReview);

  return (
    <div className="space-y-3 rounded-md border border-foreground/10 p-3">
      <div>
        <p className="text-xs font-medium text-foreground">Remove tripod</p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Produces a candidate you review before applying. Failed or discarded
          jobs leave the scene unchanged.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="flex items-center gap-2 text-[11px]">
          <input
            type="radio"
            name="nadir-mode"
            checked={mode === "ai"}
            onChange={() => setMode("ai")}
            disabled={busy}
          />
          AI fill (~$0.04–$0.15)
        </label>
        <label className="flex items-center gap-2 text-[11px]">
          <input
            type="radio"
            name="nadir-mode"
            checked={mode === "texture"}
            onChange={() => setMode("texture")}
            disabled={busy}
          />
          Texture fill — free, instant
        </label>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Tour spend so far:{" "}
        <span className="font-medium text-foreground">
          {formatCents(spendCents)}
        </span>
      </p>

      {active?.cleaned_enabled && active.cleaned_path ? (
        <p className="text-[11px] text-foreground">
          This scene has an applied cleaned floor. Look straight down to review.
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <Button
          type="button"
          size="sm"
          disabled={busy || !active}
          onClick={handleCleanScene}
        >
          {mode === "texture" ? "Texture-fill this scene" : "Clean this scene"}
        </Button>
        {active?.cleaned_enabled ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={handleRevert}
          >
            Revert to original
          </Button>
        ) : null}
      </div>

      {jobId ? (
        <div className="space-y-2 text-[11px] text-muted-foreground">
          <p>
            Status:{" "}
            {stagingJobStatusLabel(
              job?.status ?? (isPolling ? "processing" : null),
              job?.error,
            )}
          </p>
          {pollError ? (
            <p className="text-amber-700 dark:text-amber-400">{pollError}</p>
          ) : null}

          {awaitingReview && candidateUrls[candidateIndex] ? (
            <div className="space-y-2 rounded border border-foreground/10 p-2">
              <p className="font-medium text-foreground">Review candidate</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={candidateUrls[candidateIndex]}
                alt="Nadir fill candidate"
                className="max-h-40 w-full rounded object-cover"
              />
              {candidateUrls.length > 1 ? (
                <div className="flex gap-1">
                  {candidateUrls.map((_, i) => (
                    <Button
                      key={i}
                      type="button"
                      size="sm"
                      variant={i === candidateIndex ? "default" : "outline"}
                      onClick={() => setCandidateIndex(i)}
                    >
                      {i + 1}
                    </Button>
                  ))}
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" onClick={handleApply}>
                  Apply
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleDiscard}
                >
                  Discard
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => handleRetry("ai")}
                >
                  Try again
                </Button>
              </div>
            </div>
          ) : null}

          {job?.status === "failed" ? (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => handleRetry(mode)}
              >
                Retry
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => handleRetry("texture")}
              >
                Fallback: texture fill
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
