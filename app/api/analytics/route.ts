import { NextResponse } from "next/server";

import { createPublicClient } from "@/lib/supabase/public";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MAX_DURATION_MS = 4 * 60 * 60 * 1000;
const MAX_DWELL_ROWS = 64;
const MAX_CLICKS = 200;
const MAX_BODY_BYTES = 64_000;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

function clampMs(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.min(MAX_DURATION_MS, Math.round(value));
}

type DwellIn = { scene_id?: unknown; dwell_ms?: unknown };
type ClickIn = {
  id?: unknown;
  hotspot_id?: unknown;
  clicked_at?: unknown;
};

export async function POST(request: Request) {
  try {
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (contentLength > MAX_BODY_BYTES) {
      return new NextResponse(null, { status: 204 });
    }

    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) {
      return new NextResponse(null, { status: 204 });
    }

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return new NextResponse(null, { status: 204 });
    }

    const sessionId = body.session_id;
    const tourId = body.tour_id;
    const visitorId = body.visitor_id;

    if (!isUuid(sessionId) || !isUuid(tourId)) {
      return new NextResponse(null, { status: 204 });
    }
    if (
      typeof visitorId !== "string" ||
      visitorId.length < 8 ||
      visitorId.length > 80
    ) {
      return new NextResponse(null, { status: 204 });
    }

    const isEmbed = body.is_embed === true;
    const durationMs = clampMs(body.duration_ms);

    const dwellRaw = Array.isArray(body.dwell) ? (body.dwell as DwellIn[]) : [];
    const clicksRaw = Array.isArray(body.clicks)
      ? (body.clicks as ClickIn[])
      : [];

    if (dwellRaw.length > MAX_DWELL_ROWS || clicksRaw.length > MAX_CLICKS) {
      return new NextResponse(null, { status: 204 });
    }

    const supabase = createPublicClient();

    // Unauthenticated write path — only accept sessions for published tours.
    const { data: tour } = await supabase
      .from("tours")
      .select("id")
      .eq("id", tourId)
      .eq("is_public", true)
      .maybeSingle();

    if (!tour) {
      return new NextResponse(null, { status: 204 });
    }

    // Prefer insert; on conflict (session already exists) update duration only.
    // Avoid SELECT of sessions — anon cannot read under owner-only RLS.
    const { error: insertSessionError } = await supabase
      .from("tour_sessions")
      .insert({
        id: sessionId,
        tour_id: tourId,
        visitor_id: visitorId,
        is_embed: isEmbed,
        duration_ms: durationMs,
      });

    if (insertSessionError) {
      await supabase
        .from("tour_sessions")
        .update({ duration_ms: durationMs })
        .eq("id", sessionId);
    }

    for (const row of dwellRaw) {
      if (!isUuid(row.scene_id)) continue;
      const dwellMs = clampMs(row.dwell_ms);
      const { error: dwellInsertError } = await supabase
        .from("scene_dwell")
        .insert({
          session_id: sessionId,
          scene_id: row.scene_id,
          dwell_ms: dwellMs,
        });
      if (dwellInsertError) {
        await supabase
          .from("scene_dwell")
          .update({ dwell_ms: dwellMs })
          .eq("session_id", sessionId)
          .eq("scene_id", row.scene_id);
      }
    }

    for (const click of clicksRaw) {
      if (!isUuid(click.id) || !isUuid(click.hotspot_id)) continue;
      const clickedAt =
        typeof click.clicked_at === "string" && click.clicked_at.length < 64
          ? click.clicked_at
          : new Date().toISOString();

      // Client-generated ids make duplicate flushes idempotent.
      await supabase.from("hotspot_clicks").insert({
        id: click.id,
        session_id: sessionId,
        hotspot_id: click.hotspot_id,
        clicked_at: clickedAt,
      });
    }
  } catch {
    // Never surface analytics failures.
  }

  return new NextResponse(null, { status: 204 });
}
