import { NextResponse } from "next/server";

import { createPublicClient } from "@/lib/supabase/public";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const MAX_REFERRER_LEN = 512;

function sanitizeReferrer(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/[\u0000-\u001F\u007F]/g, "");
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_REFERRER_LEN);
}

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;

  let referrer: string | null = null;
  try {
    const body = (await request.json()) as { referrer?: unknown };
    referrer = sanitizeReferrer(body?.referrer);
  } catch {
    // Empty / non-JSON body is fine.
  }

  try {
    const supabase = createPublicClient();
    await supabase.from("tour_views").insert({
      tour_id: id,
      ...(referrer ? { referrer } : {}),
    });
  } catch {
    // Ignore analytics failures entirely.
  }

  return new NextResponse(null, { status: 204 });
}
