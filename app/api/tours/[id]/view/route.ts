import { NextResponse } from "next/server";

import { createPublicClient } from "@/lib/supabase/public";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const MAX_REFERRER_LEN = 512;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function sanitizeReferrer(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/[\u0000-\u001F\u007F]/g, "");
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_REFERRER_LEN);
}

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!UUID_RE.test(id)) {
    return new NextResponse(null, { status: 204 });
  }

  let referrer: string | null = null;
  try {
    const body = (await request.json()) as { referrer?: unknown };
    referrer = sanitizeReferrer(body?.referrer);
  } catch {
    // Empty / non-JSON body is fine.
  }

  try {
    const supabase = createPublicClient();
    // Same gate as /api/analytics — only count views for published tours.
    const { data: tour } = await supabase
      .from("tours")
      .select("id")
      .eq("id", id)
      .eq("is_public", true)
      .maybeSingle();
    if (!tour) {
      return new NextResponse(null, { status: 204 });
    }

    await supabase.from("tour_views").insert({
      tour_id: id,
      ...(referrer ? { referrer } : {}),
    });
  } catch {
    // Ignore analytics failures entirely.
  }

  return new NextResponse(null, { status: 204 });
}
