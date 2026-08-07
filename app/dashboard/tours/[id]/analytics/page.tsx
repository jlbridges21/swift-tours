import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { panoramaPublicUrl } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ range?: string }>;
};

type AnalyticsSummary = {
  unique_visitors: number;
  total_sessions: number;
  avg_duration_ms: number;
  total_hotspot_clicks: number;
};

type SceneRow = {
  id: string;
  name: string;
  thumbnail_path: string | null;
  views: number;
  avg_dwell_ms: number;
  reach_pct: number;
};

type HotspotRow = {
  id: string;
  type: string;
  label: string | null;
  scene_id: string;
  scene_name: string;
  target_scene_name: string | null;
  clicks: number;
  ctr_pct: number;
};

type AnalyticsPayload = {
  summary: AnalyticsSummary;
  scenes: SceneRow[];
  hotspots: HotspotRow[];
};

function rangeSince(range: string | undefined): {
  label: string;
  since: string | null;
  key: "7d" | "30d" | "all";
} {
  const now = Date.now();
  if (range === "30d") {
    return {
      key: "30d",
      label: "Last 30 days",
      since: new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString(),
    };
  }
  if (range === "all") {
    return { key: "all", label: "All time", since: null };
  }
  return {
    key: "7d",
    label: "Last 7 days",
    since: new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString(),
  };
}

function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default async function TourAnalyticsPage({
  params,
  searchParams,
}: PageProps) {
  const { id } = await params;
  const { range } = await searchParams;
  const selected = rangeSince(range);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: tour } = await supabase
    .from("tours")
    .select("id, title, owner_id")
    .eq("id", id)
    .maybeSingle();

  if (!tour || tour.owner_id !== user.id) {
    notFound();
  }

  const { data: raw, error } = await supabase.rpc("tour_analytics_summary", {
    p_tour_id: id,
    p_since: selected.since,
  });

  if (error) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-10">
        <p className="text-sm text-destructive">
          Could not load analytics: {error.message}
        </p>
        <Button
          className="mt-4"
          variant="outline"
          nativeButton={false}
          render={<Link href={`/dashboard/tours/${id}/edit`} />}
        >
          Back to editor
        </Button>
      </div>
    );
  }

  const payload = (raw ?? {
    summary: {
      unique_visitors: 0,
      total_sessions: 0,
      avg_duration_ms: 0,
      total_hotspot_clicks: 0,
    },
    scenes: [],
    hotspots: [],
  }) as AnalyticsPayload;

  const hasData = payload.summary.total_sessions > 0;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">
            <Link
              href={`/dashboard/tours/${id}/edit`}
              className="underline-offset-2 hover:underline"
            >
              ← Editor
            </Link>
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            Analytics
          </h1>
          <p className="text-sm text-muted-foreground">{tour.title}</p>
        </div>
        <div className="flex gap-1 rounded-lg bg-muted p-1">
          {(
            [
              { key: "7d", label: "Last 7 days" },
              { key: "30d", label: "Last 30 days" },
              { key: "all", label: "All time" },
            ] as const
          ).map((opt) => (
            <Link
              key={opt.key}
              href={`/dashboard/tours/${id}/analytics?range=${opt.key}`}
              className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                selected.key === opt.key
                  ? "bg-background shadow-sm"
                  : "text-muted-foreground"
              }`}
            >
              {opt.label}
            </Link>
          ))}
        </div>
      </div>

      <p className="mb-6 text-xs text-muted-foreground">
        Unique visitors use a random id in localStorage — not a fingerprint.
        People on two devices count twice. Idle time (60s+) and hidden tabs are
        excluded from session duration.
      </p>

      {!hasData ? (
        <div className="rounded-xl border border-dashed border-foreground/15 px-6 py-16 text-center">
          <p className="text-base font-medium">No visits yet</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Stats appear after the tour is visited on the public page, preview,
            or an embed.
          </p>
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Unique visitors"
              value={String(payload.summary.unique_visitors)}
            />
            <StatCard
              label="Total sessions"
              value={String(payload.summary.total_sessions)}
            />
            <StatCard
              label="Avg time on tour"
              value={formatDuration(payload.summary.avg_duration_ms)}
            />
            <StatCard
              label="Hotspot clicks"
              value={String(payload.summary.total_hotspot_clicks)}
            />
          </div>

          <section className="mt-10">
            <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">
              Scenes
            </h2>
            <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Scene</th>
                    <th className="px-3 py-2 font-medium">Views</th>
                    <th className="px-3 py-2 font-medium">Avg dwell</th>
                    <th className="px-3 py-2 font-medium">Reach</th>
                  </tr>
                </thead>
                <tbody>
                  {payload.scenes.map((scene) => {
                    const thumb = panoramaPublicUrl(scene.thumbnail_path);
                    return (
                      <tr
                        key={scene.id}
                        className="border-b border-foreground/5 last:border-0"
                      >
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-3">
                            <div className="relative size-10 shrink-0 overflow-hidden rounded bg-muted">
                              {thumb ? (
                                <Image
                                  src={thumb}
                                  alt=""
                                  fill
                                  className="object-cover"
                                  sizes="40px"
                                />
                              ) : null}
                            </div>
                            <span className="font-medium">{scene.name}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2 tabular-nums">{scene.views}</td>
                        <td className="px-3 py-2 tabular-nums">
                          {formatDuration(scene.avg_dwell_ms)}
                        </td>
                        <td className="px-3 py-2 tabular-nums">
                          {scene.reach_pct}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="mt-10">
            <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">
              Hotspots
            </h2>
            <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Hotspot</th>
                    <th className="px-3 py-2 font-medium">On scene</th>
                    <th className="px-3 py-2 font-medium">Clicks</th>
                    <th className="px-3 py-2 font-medium">CTR</th>
                  </tr>
                </thead>
                <tbody>
                  {payload.hotspots.map((hs) => (
                    <tr
                      key={hs.id}
                      className="border-b border-foreground/5 last:border-0"
                    >
                      <td className="px-3 py-2">
                        <span className="mr-2 text-xs uppercase text-muted-foreground">
                          {hs.type}
                        </span>
                        {hs.label?.trim() ||
                          hs.target_scene_name ||
                          "Untitled"}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {hs.scene_name}
                      </td>
                      <td className="px-3 py-2 tabular-nums">{hs.clicks}</td>
                      <td className="px-3 py-2 tabular-nums">{hs.ctr_pct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl px-4 py-3 ring-1 ring-foreground/10">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">
        {value}
      </p>
    </div>
  );
}
