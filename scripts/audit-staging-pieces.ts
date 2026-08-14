import Module from "node:module";

const originalLoad = (Module as unknown as { _load: typeof Module.prototype.require })
  ._load;
(Module as unknown as { _load: typeof Module.prototype.require })._load =
  function (request: string, parent: unknown, isMain: boolean) {
    if (request === "server-only") return {};
    return (originalLoad as Function).call(this, request, parent, isMain);
  };

async function main() {
  const {
    validatePiecePhrases,
    normalizeRoomPlanEntry,
    roomPlanNeedsRegeneration,
    buildFallbackStagingPlan,
    normalizeStagingPlanRooms,
  } = await import("../lib/staging/staging-plan-shared");
  const { fallbackRoomPieces, ensureFrozenRoomDescription } = await import(
    "../lib/staging/generate-plan"
  );
  const { createClient } = await import("@supabase/supabase-js");

  const q = {
    style: "Transitional" as const,
    palette: "Neutral warm" as const,
    density: "Balanced" as const,
    market: "Family home" as const,
    includes: ["Wall art", "Area rugs", "Plants"] as (
      | "Wall art"
      | "Area rugs"
      | "Plants"
    )[],
    notes: "",
  };
  const planShell = buildFallbackStagingPlan(q, 1);
  for (const rt of [
    "living_room",
    "bedroom",
    "kitchen",
    "bathroom",
    "office",
    "dining_room",
    "entry",
    "basement",
    "outdoor",
    "other",
  ] as const) {
    const pieces = fallbackRoomPieces(rt, planShell, `${rt}_1`);
    const v = validatePiecePhrases(pieces);
    console.log(rt, v.ok ? `OK ${pieces.length}` : v);
  }

  const prose = validatePiecePhrases([
    "A warm wood coffee table with a distressed finish anchors the space",
    "complemented by a plush",
    "neutral-toned linen sofa",
    "all arranged on a subtly patterned area rug",
  ]);
  console.log("\nprose rejected:", !prose.ok);
  if (!prose.ok) console.log(JSON.stringify(prose.failures, null, 2));

  const legacy = normalizeRoomPlanEntry(
    "A warm wood coffee table with a distressed finish anchors the space, complemented by a plush, neutral-toned linen sofa, all arranged on a subtly patterned area rug",
  );
  console.log("legacy needsRegen", roomPlanNeedsRegeneration(legacy));

  console.log("\n========== SAMPLE GENERATED PIECES ==========");
  let plan = buildFallbackStagingPlan(q, 481923);
  plan.global_descriptors =
    "warm oak flooring tones, brushed brass hardware, matte black accents, cream and sage textiles";
  plan = await ensureFrozenRoomDescription({
    plan,
    roomKey: "living_room_1",
    roomType: "living_room",
    force: true,
  });
  console.log(JSON.stringify(plan.rooms.living_room_1, null, 2));

  console.log("\n========== TOUR AUDIT ==========");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase env");
  const sb = createClient(url, key);
  const { data: tours, error } = await sb
    .from("tours")
    .select("id, title, staging_plan, staging_seed");
  if (error) throw error;

  const rows: Array<{
    tourId: string;
    title: string;
    roomKey: string;
    legacy: boolean;
    stagedScenes: number;
    piecesCount: number;
    preview: string;
  }> = [];

  for (const t of tours ?? []) {
    if (!t.staging_plan || typeof t.staging_plan !== "object") continue;
    const plan = t.staging_plan as { rooms?: Record<string, unknown> };
    const rooms = plan.rooms ?? {};
    const normalized = normalizeStagingPlanRooms(rooms);
    const { data: scenes } = await sb
      .from("scenes")
      .select("id, room_key, staged_enabled, staged_path")
      .eq("tour_id", t.id);

    for (const [roomKey, raw] of Object.entries(rooms)) {
      const entry = normalized[roomKey];
      const isLegacy =
        typeof raw === "string" || roomPlanNeedsRegeneration(entry);
      const stagedScenes = (scenes ?? []).filter(
        (s) => s.room_key === roomKey && s.staged_enabled && s.staged_path,
      ).length;
      rows.push({
        tourId: t.id,
        title: t.title,
        roomKey,
        legacy: isLegacy,
        stagedScenes,
        piecesCount: entry?.pieces?.length ?? 0,
        preview:
          typeof raw === "string"
            ? raw.slice(0, 100)
            : JSON.stringify(entry?.pieces?.slice(0, 2) ?? entry).slice(0, 100),
      });
    }
  }

  console.log(JSON.stringify(rows, null, 2));
  console.log("\nsummary:", {
    rooms: rows.length,
    legacyRooms: rows.filter((r) => r.legacy).length,
    legacyAlreadyStaged: rows.filter((r) => r.legacy && r.stagedScenes > 0),
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
