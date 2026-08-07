import { NextResponse } from "next/server";

import { createPublicClient } from "@/lib/supabase/public";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  try {
    const supabase = createPublicClient();
    await supabase.from("tour_views").insert({ tour_id: id });
  } catch {
    // Ignore analytics failures entirely.
  }

  return new NextResponse(null, { status: 204 });
}
