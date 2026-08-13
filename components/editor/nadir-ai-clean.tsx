"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  revertSceneCleaned,
  getTourStagingSpendCents,
} from "@/app/dashboard/tours/[id]/actions";
import { Button } from "@/components/ui/button";
import {
  useStagingJobPoll,
  type StagingJob,
} from "@/hooks/use-staging-job-poll";
import type { Scene } from "@/types";

type NadirAiCleanProps = {
  tourId: string;
  scenes: Scene[];
  activeSceneId: string | null;
  onScenesChange: (scenes: Scene[]) => void;
};

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

async function createAndKickJob(
  tourId: string,
  sceneId: string,
): Promise<{ jobId?: string; error?: string }> {
  const createRes = await fetch("/api/staging/jobs", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tourId, sceneId, kind: "nadir_fill", params: {} }),
  });
  const createJson = (await createRes.json()) as {
    job?: { id: string };
    error?: string;
    code?: string;
  };
  if (!createRes.ok || !createJson.job) {
    const code = createJson.code ? ` [${createJson.code}]` : "";
    return {
      error: `${createJson.error ?? `HTTP ${createRes.status}`}${code}`,
    };
  }

  // Kick the worker (submit to fal). Further polls call process again.
  void fetch(`/api/staging/jobs/${createJson.job.id}/process`, {
    method: "POST",
    credentials: "same-origin",
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
  const [batchRemaining, setBatchRemaining] = useState<string[]>([]);
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

  // While processing, keep calling /process so fal is polled without holding
  // a single long request.
  useEffect(() => {
    if (!jobId || !job) return;
    if (job.status !== "queued" && job.status !== "processing") return;

    const timer = setInterval(() => {
      void fetch(`/api/staging/jobs/${jobId}/process`, {
        method: "POST",
        credentials: "same-origin",
      });
    }, 2500);

    return () => clearInterval(timer);
  }, [jobId, job?.status]);

  useEffect(() => {
    if (!job || job.status !== "succeeded" || !job.scene_id) return;

    onScenesChange(
      scenes.map((scene) =>
        scene.id === job.scene_id
          ? {
              ...scene,
              cleaned_path:
                (job.result_path as string | null) ?? scene.cleaned_path,
              cleaned_enabled: true,
            }
          : scene,
      ),
    );
    toast.success("Tripod removed — look down to check the floor.");
    setJobId(null);

    // Continue batch if any.
    setBatchRemaining((prev) => {
      const next = prev.filter((id) => id !== job.scene_id);
      if (next[0]) {
        void createAndKickJob(tourId, next[0]).then((r) => {
          if (r.jobId) setJobId(r.jobId);
          else if (r.error) toast.error(r.error);
        });
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scenes snapshot on success only
  }, [job?.status, job?.id]);

  useEffect(() => {
    if (!job || job.status !== "failed") return;
    toast.error(job.error ?? "Nadir fill failed.");
    setBatchRemaining([]);
  }, [job?.status, job?.id, job?.error]);

  function statusLabel(j: StagingJob | null): string {
    if (!j) return isPolling ? "Starting…" : "Idle";
    if (j.status === "queued") return "Queued…";
    if (j.status === "processing") return "Processing (up to ~1 min)…";
    if (j.status === "succeeded") return "Ready";
    if (j.status === "failed") return `Failed: ${j.error ?? "unknown"}`;
    return j.status;
  }

  function handleCleanScene() {
    if (!active) return;
    startTransition(async () => {
      const result = await createAndKickJob(tourId, active.id);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setJobId(result.jobId ?? null);
    });
  }

  function handleCleanAll() {
    const count = scenes.length;
    if (count === 0) return;
    // fal rounds UP to whole MP: 1024² = 1.05MP → 2MP → $0.10/scene.
    const estCents = count * 10;
    const ok = window.confirm(
      `Clean all ${count} scenes in this tour?\n\nEstimated cost about ${formatCents(estCents)} (fal bills $0.05/MP rounded up; 1024² fill = $0.10). Each scene can take up to a minute.`,
    );
    if (!ok) return;

    const ids = scenes.map((s) => s.id);
    setBatchRemaining(ids.slice(1));
    startTransition(async () => {
      const result = await createAndKickJob(tourId, ids[0]!);
      if (result.error) {
        toast.error(result.error);
        setBatchRemaining([]);
        return;
      }
      setJobId(result.jobId ?? null);
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

  function handleRetry() {
    setJobId(null);
    handleCleanScene();
  }

  const busy = pending || Boolean(jobId && isPolling);

  return (
    <div className="space-y-3 rounded-md border border-foreground/10 p-3">
      <div>
        <p className="text-xs font-medium text-foreground">Remove tripod (AI)</p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Costs money per use (~{formatCents(5)} per scene) and can take up to a
          minute. Fills only the centre of the floor; the rest of the panorama
          stays untouched.
        </p>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Tour spend so far:{" "}
        <span className="font-medium text-foreground">
          {formatCents(spendCents)}
        </span>
      </p>

      {active?.cleaned_enabled && active.cleaned_path ? (
        <p className="text-[11px] text-foreground">
          This scene has a cleaned floor. Look straight down to review.
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <Button
          type="button"
          size="sm"
          disabled={busy || !active}
          onClick={handleCleanScene}
        >
          Clean this scene
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy || scenes.length === 0}
          onClick={handleCleanAll}
        >
          Clean all scenes in this tour
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
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <p>Status: {statusLabel(job)}</p>
          {batchRemaining.length > 0 ? (
            <p>{batchRemaining.length} scene(s) left in batch.</p>
          ) : null}
          {pollError ? <p className="text-destructive">{pollError}</p> : null}
          {job?.status === "failed" ? (
            <Button type="button" size="sm" variant="outline" onClick={handleRetry}>
              Retry
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
