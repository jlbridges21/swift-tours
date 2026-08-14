"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  discardStageRoomCandidate,
  applyStageRoomCandidate,
  getTourStagingSpendCents,
  revertSceneStaged,
  saveTourStagingPlan,
  updateSceneRoomStaging,
} from "@/app/dashboard/tours/[id]/actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { fetchWithTimeout } from "@/lib/staging/client-fetch";
import {
  ROOM_TYPES,
  STAGING_DENSITIES,
  STAGING_INCLUDES,
  STAGING_MARKETS,
  STAGING_PALETTES,
  STAGING_STYLES,
  composeRoomStagingPrompt,
  type RoomType,
  type StagingIntensity,
  type StagingPlan,
  type StagingQuestionnaire,
} from "@/lib/staging/staging-plan-shared";
import {
  estimateStrategyCostCents,
  estimateStrategySeconds,
  getViewStrategy,
  type ViewStrategyId,
} from "@/lib/staging/view-strategies";
import { publicUrl } from "@/lib/storage";
import {
  stagingJobStatusLabel,
  useStagingJobPoll,
} from "@/hooks/use-staging-job-poll";
import type { Scene } from "@/types";

type VirtualStagingPanelProps = {
  tourId: string;
  scenes: Scene[];
  activeSceneId: string | null;
  onScenesChange: (scenes: Scene[]) => void;
  stagingPlan: StagingPlan | null;
  stagingStyle: string | null;
  stagingSeed: number | null;
  onPlanSaved: (plan: StagingPlan) => void;
};

const STRATEGY_IDS: ViewStrategyId[] = ["A", "B", "C", "D"];

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatSeconds(sec: number): string {
  if (sec < 60) return `~${sec}s`;
  const m = Math.round(sec / 60);
  return `~${m} min`;
}

function roomTypeLabel(type: RoomType): string {
  return type.replace(/_/g, " ");
}

function isStagingPlan(value: unknown): value is StagingPlan {
  if (!value || typeof value !== "object") return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.style === "string" &&
    typeof p.palette === "string" &&
    typeof p.global_descriptors === "string" &&
    typeof p.rooms === "object" &&
    p.rooms !== null
  );
}

function isOneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

async function createAndKickStageJob(
  tourId: string,
  sceneId: string,
  params: {
    strategy: ViewStrategyId;
    roomType: RoomType;
    intensity: StagingIntensity;
    note: string;
  },
): Promise<{ jobId?: string; error?: string }> {
  const create = await fetchWithTimeout("/api/staging/jobs", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tourId,
      sceneId,
      kind: "stage_room",
      params,
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

  void fetchWithTimeout(`/api/staging/jobs/${createJson.job.id}/process`, {
    method: "POST",
    credentials: "same-origin",
    timeoutMs: 25_000,
  }).then((r) => {
    if (!r.ok && !r.timedOut) {
      console.warn("[virtual-staging] process kick soft-fail", r.error);
    }
  });

  return { jobId: createJson.job.id };
}

export function VirtualStagingPanel({
  tourId,
  scenes,
  activeSceneId,
  onScenesChange,
  stagingPlan,
  stagingStyle,
  stagingSeed,
  onPlanSaved,
}: VirtualStagingPanelProps) {
  const [pending, startTransition] = useTransition();
  const [editingPlan, setEditingPlan] = useState(!stagingPlan);
  const [jobId, setJobId] = useState<string | null>(null);
  const [spendCents, setSpendCents] = useState(0);
  const [strategy, setStrategy] = useState<ViewStrategyId>("A");
  const [intensity, setIntensity] = useState<StagingIntensity>("fully");
  const [note, setNote] = useState("");
  const [questionnaire, setQuestionnaire] = useState<StagingQuestionnaire>({
    style: STAGING_STYLES[0],
    palette: STAGING_PALETTES[0],
    density: STAGING_DENSITIES[1],
    market: STAGING_MARKETS[1],
    includes: ["Wall art", "Area rugs", "Plants"],
    notes: "",
  });

  const { job, error: pollError, isPolling } = useStagingJobPoll(jobId, {
    enabled: Boolean(jobId),
  });

  const active =
    scenes.find((s) => s.id === activeSceneId) ?? scenes[0] ?? null;

  const plan = stagingPlan && isStagingPlan(stagingPlan) ? stagingPlan : null;

  const roomType = useMemo<RoomType>(() => {
    const rt = active?.room_type;
    if (rt && (ROOM_TYPES as readonly string[]).includes(rt)) {
      return rt as RoomType;
    }
    return "living_room";
  }, [active?.room_type]);

  const examplePrompt = useMemo(() => {
    if (!plan) return null;
    return composeRoomStagingPrompt({
      roomType: "living_room",
      plan,
      intensity: "fully",
    });
  }, [plan]);

  const costCents = estimateStrategyCostCents(strategy);
  const seconds = estimateStrategySeconds(strategy);
  const strategyMeta = getViewStrategy(strategy);

  useEffect(() => {
    void getTourStagingSpendCents(tourId).then((result) => {
      if (typeof result.cents === "number") setSpendCents(result.cents);
    });
  }, [tourId, job?.status]);

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
          console.warn("[virtual-staging] process tick soft-fail", r.error);
        }
      });
    }, 4000);

    return () => clearInterval(timer);
  }, [jobId, job?.status]);

  useEffect(() => {
    if (!job || job.status !== "failed") return;
    toast.error(job.error ?? "Virtual staging failed.");
  }, [job?.status, job?.id, job?.error]);

  useEffect(() => {
    setEditingPlan(!plan);
  }, [plan]);

  useEffect(() => {
    if (!plan) return;
    setQuestionnaire({
      style: isOneOf(plan.style, STAGING_STYLES) ? plan.style : STAGING_STYLES[0],
      palette: isOneOf(plan.palette, STAGING_PALETTES)
        ? plan.palette
        : STAGING_PALETTES[0],
      density: isOneOf(plan.density, STAGING_DENSITIES)
        ? plan.density
        : STAGING_DENSITIES[1],
      market: isOneOf(plan.market, STAGING_MARKETS)
        ? plan.market
        : STAGING_MARKETS[1],
      includes: Array.isArray(plan.includes)
        ? plan.includes.filter((item): item is (typeof STAGING_INCLUDES)[number] =>
            isOneOf(item, STAGING_INCLUDES),
          )
        : [],
      notes: plan.notes ?? "",
    });
  }, [plan]);

  const candidateUrl =
    typeof job?.params?.candidateUrl === "string"
      ? (job.params.candidateUrl as string)
      : job?.result_path
        ? publicUrl(job.result_path)
        : null;

  const awaitingReview =
    job?.status === "succeeded" &&
    (job.params?.awaitingReview === true || Boolean(candidateUrl));

  const originalUrl = active?.storage_path
    ? publicUrl(active.storage_path)
    : null;

  const busy = pending || Boolean(jobId && isPolling && !awaitingReview);

  const progressLabel = (() => {
    if (!job || (job.status !== "processing" && job.status !== "queued")) {
      return null;
    }
    const step = typeof job.step === "number" ? job.step : 0;
    const total =
      typeof job.total_steps === "number" && job.total_steps > 1
        ? job.total_steps - 1
        : null;
    if (total && step > 0) {
      return `Staging view ${Math.min(step, total)} of ${total}`;
    }
    return null;
  })();

  function handleSavePlan() {
    startTransition(async () => {
      const result = await saveTourStagingPlan(tourId, questionnaire);
      if (result.error || !result.plan) {
        toast.error(result.error ?? "Failed to save staging plan.");
        return;
      }
      onPlanSaved(result.plan);
      setEditingPlan(false);
      toast.success("Staging plan locked for this tour.");
    });
  }

  function handleRoomTypeChange(next: RoomType) {
    if (!active) return;
    onScenesChange(
      scenes.map((scene) =>
        scene.id === active.id ? { ...scene, room_type: next } : scene,
      ),
    );
    startTransition(async () => {
      const result = await updateSceneRoomStaging(active.id, {
        roomType: next,
        intensity,
        note,
      });
      if (result.error) toast.error(result.error);
    });
  }

  function handleStageRoom() {
    if (!active || !plan) return;
    const ok = window.confirm(
      `Virtually stage this room?\n\nStrategy ${strategy}: ${strategyMeta.name}\nEstimated cost: ${formatCents(costCents)}\nEstimated time: ${formatSeconds(seconds)}\n\nYou will review a candidate before it is applied.`,
    );
    if (!ok) return;

    startTransition(async () => {
      const persist = await updateSceneRoomStaging(active.id, {
        roomType,
        intensity,
        note,
      });
      if (persist.error) {
        toast.error(persist.error);
        return;
      }

      const result = await createAndKickStageJob(tourId, active.id, {
        strategy,
        roomType,
        intensity,
        note: note.trim().slice(0, 400),
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setJobId(result.jobId ?? null);
    });
  }

  function handleApply() {
    if (!jobId) return;
    startTransition(async () => {
      const result = await applyStageRoomCandidate(jobId);
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
                  staged_path: result.stagedPath ?? scene.staged_path,
                  staged_enabled: true,
                  staging_candidate_path: null,
                  staging_candidate_job_id: null,
                }
              : scene,
          ),
        );
      }
      toast.success("Applied staged room.");
      setJobId(null);
    });
  }

  function handleDiscard() {
    if (!jobId) return;
    startTransition(async () => {
      const result = await discardStageRoomCandidate(jobId);
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
                  staging_candidate_path: null,
                  staging_candidate_job_id: null,
                }
              : scene,
          ),
        );
      }
      toast.message("Candidate discarded — staged scene unchanged.");
      setJobId(null);
    });
  }

  function handleRevert() {
    if (!active) return;
    startTransition(async () => {
      const result = await revertSceneStaged(active.id);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      onScenesChange(
        scenes.map((scene) =>
          scene.id === active.id
            ? {
                ...scene,
                staged_path: null,
                staged_compat_path: null,
                staged_enabled: false,
              }
            : scene,
        ),
      );
      toast.success("Reverted staged panorama.");
    });
  }

  function handleRetry() {
    setJobId(null);
    handleStageRoom();
  }

  const anySceneStaged = scenes.some((s) => s.staged_enabled && s.staged_path);

  if (!plan || editingPlan) {
    return (
      <div className="space-y-3 p-3">
        <div>
          <p className="text-xs font-medium text-foreground">
            Virtual staging plan
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Answer once per tour. The locked plan keeps furniture consistent
            across rooms.
          </p>
          {plan && anySceneStaged ? (
            <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-400">
              Changing the plan after scenes are staged can make earlier rooms
              inconsistent with new ones.
            </p>
          ) : null}
        </div>

        <fieldset className="space-y-1.5">
          <Label className="text-xs">Style</Label>
          <div className="flex flex-col gap-1">
            {STAGING_STYLES.map((value) => (
              <label key={value} className="flex items-center gap-2 text-[11px]">
                <input
                  type="radio"
                  name="staging-style"
                  checked={questionnaire.style === value}
                  onChange={() =>
                    setQuestionnaire((q) => ({ ...q, style: value }))
                  }
                  disabled={pending}
                />
                {value}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="space-y-1.5">
          <Label className="text-xs">Palette</Label>
          <div className="flex flex-col gap-1">
            {STAGING_PALETTES.map((value) => (
              <label key={value} className="flex items-center gap-2 text-[11px]">
                <input
                  type="radio"
                  name="staging-palette"
                  checked={questionnaire.palette === value}
                  onChange={() =>
                    setQuestionnaire((q) => ({ ...q, palette: value }))
                  }
                  disabled={pending}
                />
                {value}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="space-y-1.5">
          <Label className="text-xs">Density</Label>
          <div className="flex flex-col gap-1">
            {STAGING_DENSITIES.map((value) => (
              <label key={value} className="flex items-center gap-2 text-[11px]">
                <input
                  type="radio"
                  name="staging-density"
                  checked={questionnaire.density === value}
                  onChange={() =>
                    setQuestionnaire((q) => ({ ...q, density: value }))
                  }
                  disabled={pending}
                />
                {value}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="space-y-1.5">
          <Label className="text-xs">Market</Label>
          <div className="flex flex-col gap-1">
            {STAGING_MARKETS.map((value) => (
              <label key={value} className="flex items-center gap-2 text-[11px]">
                <input
                  type="radio"
                  name="staging-market"
                  checked={questionnaire.market === value}
                  onChange={() =>
                    setQuestionnaire((q) => ({ ...q, market: value }))
                  }
                  disabled={pending}
                />
                {value}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="space-y-1.5">
          <Label className="text-xs">Includes</Label>
          <div className="flex flex-col gap-1">
            {STAGING_INCLUDES.map((value) => {
              const checked = questionnaire.includes.includes(value);
              return (
                <label
                  key={value}
                  className="flex items-center gap-2 text-[11px]"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={pending}
                    onChange={() =>
                      setQuestionnaire((q) => ({
                        ...q,
                        includes: checked
                          ? q.includes.filter((i) => i !== value)
                          : [...q.includes, value],
                      }))
                    }
                  />
                  {value}
                </label>
              );
            })}
          </div>
        </fieldset>

        <div className="space-y-1.5">
          <Label className="text-xs" htmlFor="staging-notes">
            Notes (optional)
          </Label>
          <textarea
            id="staging-notes"
            className="min-h-[72px] w-full rounded-md border border-foreground/10 bg-background px-2 py-1.5 text-[11px]"
            maxLength={400}
            value={questionnaire.notes ?? ""}
            disabled={pending}
            onChange={(e) =>
              setQuestionnaire((q) => ({ ...q, notes: e.target.value }))
            }
          />
          <p className="text-[10px] text-muted-foreground">
            {(questionnaire.notes ?? "").length}/400
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            disabled={pending}
            onClick={handleSavePlan}
          >
            {plan ? "Update staging plan" : "Save staging plan"}
          </Button>
          {plan ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => setEditingPlan(false)}
            >
              Cancel
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 p-3">
      <div>
        <p className="text-xs font-medium text-foreground">Virtual staging</p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Stages a candidate you review before applying. Discarded jobs leave
          the scene unchanged.
        </p>
      </div>

      <div className="space-y-1 rounded-md border border-foreground/10 p-2 text-[11px]">
        <p className="font-medium text-foreground">Tour plan</p>
        <p className="text-muted-foreground">
          {stagingStyle ?? plan.style} · {plan.palette} · {plan.density} ·{" "}
          {plan.market}
          {typeof stagingSeed === "number" ? ` · seed ${stagingSeed}` : null}
        </p>
        {plan.includes.length ? (
          <p className="text-muted-foreground">
            Includes: {plan.includes.join(", ")}
          </p>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="mt-1 h-7 px-2"
          disabled={busy}
          onClick={() => setEditingPlan(true)}
        >
          Edit staging plan
        </Button>
      </div>

      {examplePrompt ? (
        <div className="space-y-1">
          <p className="text-[11px] font-medium text-foreground">
            Example prompt (living room)
          </p>
          <p className="rounded-md bg-muted/50 p-2 text-[10px] leading-relaxed text-muted-foreground">
            {examplePrompt}
          </p>
        </div>
      ) : null}

      <p className="text-[11px] text-muted-foreground">
        Tour spend so far:{" "}
        <span className="font-medium text-foreground">
          {formatCents(spendCents)}
        </span>
        {" · "}
        per-job cap ~$0.50 · tour cap $20
      </p>

      <div className="space-y-1.5">
        <Label className="text-xs" htmlFor="staging-room-type">
          Room type
        </Label>
        <select
          id="staging-room-type"
          className="w-full rounded-md border border-foreground/10 bg-background px-2 py-1.5 text-[11px]"
          value={roomType}
          disabled={busy || !active}
          onChange={(e) => handleRoomTypeChange(e.target.value as RoomType)}
        >
          {ROOM_TYPES.map((type) => (
            <option key={type} value={type}>
              {roomTypeLabel(type)}
            </option>
          ))}
        </select>
      </div>

      <fieldset className="space-y-1">
        <Label className="text-xs">Intensity</Label>
        {(
          [
            ["fully", "Fully"],
            ["lightly", "Lightly"],
            ["empty", "Leave empty"],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className="flex items-center gap-2 text-[11px]">
            <input
              type="radio"
              name="staging-intensity"
              checked={intensity === value}
              onChange={() => setIntensity(value)}
              disabled={busy}
            />
            {label}
          </label>
        ))}
      </fieldset>

      <div className="space-y-1.5">
        <Label className="text-xs" htmlFor="staging-scene-note">
          Scene note (optional)
        </Label>
        <textarea
          id="staging-scene-note"
          className="min-h-[56px] w-full rounded-md border border-foreground/10 bg-background px-2 py-1.5 text-[11px]"
          maxLength={400}
          value={note}
          disabled={busy}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      <fieldset className="space-y-1.5">
        <Label className="text-xs">View strategy</Label>
        {STRATEGY_IDS.map((id) => {
          const meta = getViewStrategy(id);
          return (
            <label key={id} className="flex items-start gap-2 text-[11px]">
              <input
                type="radio"
                name="staging-strategy"
                className="mt-0.5"
                checked={strategy === id}
                onChange={() => setStrategy(id)}
                disabled={busy}
              />
              <span>
                <span className="font-medium text-foreground">
                  {id}. {meta.name}
                </span>
                <span className="block text-muted-foreground">
                  {meta.description} ·{" "}
                  {formatCents(estimateStrategyCostCents(id))} ·{" "}
                  {formatSeconds(estimateStrategySeconds(id))}
                </span>
              </span>
            </label>
          );
        })}
      </fieldset>

      {active?.staged_enabled && active.staged_path ? (
        <p className="text-[11px] text-foreground">
          This scene has an applied staged panorama.
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <Button
          type="button"
          size="sm"
          disabled={busy || !active || intensity === "empty"}
          onClick={handleStageRoom}
        >
          Virtually stage this room
        </Button>
        {intensity === "empty" ? (
          <p className="text-[10px] text-muted-foreground">
            Leave empty skips staging — no job is created.
          </p>
        ) : null}
        {active?.staged_enabled ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={handleRevert}
          >
            Revert staged panorama
          </Button>
        ) : null}
      </div>

      {jobId ? (
        <div className="space-y-2 text-[11px] text-muted-foreground">
          <p>
            Status:{" "}
            {progressLabel ??
              stagingJobStatusLabel(
                job?.status ?? (isPolling ? "processing" : null),
                job?.error,
              )}
          </p>
          {pollError ? (
            <p className="text-amber-700 dark:text-amber-400">{pollError}</p>
          ) : null}

          {awaitingReview && candidateUrl ? (
            <div className="space-y-2 rounded border border-foreground/10 p-2">
              <p className="font-medium text-foreground">Review candidate</p>
              <div className="grid grid-cols-2 gap-2">
                {originalUrl ? (
                  <a
                    href={originalUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="block space-y-1"
                  >
                    <span className="text-[10px] text-muted-foreground">
                      Original
                    </span>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={originalUrl}
                      alt="Original panorama"
                      className="max-h-28 w-full rounded object-cover"
                    />
                  </a>
                ) : null}
                <a
                  href={candidateUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="block space-y-1"
                >
                  <span className="text-[10px] text-muted-foreground">
                    Candidate
                  </span>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={candidateUrl}
                    alt="Staging candidate"
                    className="max-h-28 w-full rounded object-cover"
                  />
                </a>
              </div>
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
                  onClick={handleRetry}
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
                onClick={handleRetry}
              >
                Retry
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
