/**
 * Head-to-head + five-surface acceptance for nadir fill.
 *
 *   npx tsx --env-file=.env.local scripts/nadir-surface-bakeoff.ts
 *
 * Creates synthetic grass/carpet/tile/concrete panoramas (tripod in nadir),
 * runs fal_vision_fill + fal_flux_kontext (+ texture_fill) on each, prints URLs.
 */
import Module from "node:module";
import { createHash } from "node:crypto";

const originalLoad = (Module as unknown as { _load: typeof Module.prototype.require })
  ._load;
(Module as unknown as { _load: typeof Module.prototype.require })._load =
  function (request: string, parent: unknown, isMain: boolean) {
    if (request === "server-only") return {};
    return (originalLoad as Function).call(this, request, parent, isMain);
  };

process.env.STAGING_DEBUG = "true";
process.env.STAGING_ENABLED = "true";

type Surface = "hardwood" | "grass" | "carpet" | "tile" | "concrete";
type ProviderName = "fal_vision_fill" | "fal_flux_kontext" | "texture_fill";

const SURFACES: Surface[] = [
  "hardwood",
  "grass",
  "carpet",
  "tile",
  "concrete",
];
const PROVIDERS: ProviderName[] = [
  "fal_vision_fill",
  "fal_flux_kontext",
  "texture_fill",
];

async function main() {
  const sharp = (await import("sharp")).default;
  const { createAdminClient } = await import("../lib/supabase/admin");
  const { processStagingJob } = await import("../lib/staging/process-job");
  const { publicUrl } = await import("../lib/storage");

  const admin = createAdminClient();

  // Prefer the known Theta Living Room (hardwood) when present.
  const HARDWOOD_SCENE = "2d4bb9fe-4a36-47e7-913b-cfab20550755";
  let living: {
    id: string;
    name: string;
    tour_id: string;
    storage_path: string;
  } | null = null;
  {
    const { data } = await admin
      .from("scenes")
      .select("id, name, tour_id, storage_path")
      .eq("id", HARDWOOD_SCENE)
      .maybeSingle();
    living = data;
  }
  if (!living) {
    const { data, error: livingErr } = await admin
      .from("scenes")
      .select("id, name, tour_id, storage_path")
      .ilike("name", "%living%")
      .limit(1)
      .maybeSingle();
    if (livingErr || !data) {
      throw new Error(livingErr?.message ?? "Living Room scene not found.");
    }
    living = data;
  }

  const skipEnv = process.env.BAKEOFF_SKIP ?? "";
  const skip = new Set(
    skipEnv
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );

  const { data: tour } = await admin
    .from("tours")
    .select("id, owner_id")
    .eq("id", living.tour_id)
    .single();
  if (!tour) throw new Error("Tour not found.");

  const ownerId = tour.owner_id;
  const tourId = tour.id;

  const { data: livingFile, error: dlErr } = await admin.storage
    .from("panoramas")
    .download(living.storage_path);
  if (dlErr || !livingFile) throw new Error(dlErr?.message ?? "download failed");

  const livingBuf = Buffer.from(await livingFile.arrayBuffer());
  const livingMeta = await sharp(livingBuf).metadata();
  const W = livingMeta.width ?? 5376;
  const H = livingMeta.height ?? 2688;

  async function makeSurfacePano(surface: Surface): Promise<Buffer> {
    if (surface === "hardwood") return livingBuf;

    // Base: muted mid-tone; paint nadir band with surface color + noise; dark tripod.
    const raw = Buffer.alloc(W * H * 3);
    const colors: Record<Exclude<Surface, "hardwood">, [number, number, number]> = {
      grass: [62, 110, 48],
      carpet: [120, 78, 62],
      tile: [190, 188, 182],
      concrete: [140, 140, 138],
    };
    const [cr, cg, cb] = colors[surface];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const o = (y * W + x) * 3;
        const nadir = y > H * 0.72;
        if (!nadir) {
          raw[o] = 40;
          raw[o + 1] = 42;
          raw[o + 2] = 48;
          continue;
        }
        // Tile grout / grass blade / carpet noise
        let n = ((x * 13 + y * 7) % 17) - 8;
        if (surface === "tile") {
          const gx = x % 48 < 3 || y % 48 < 3;
          if (gx) n = -40;
        }
        if (surface === "grass") n += ((x * y) % 11) - 5;
        raw[o] = Math.max(0, Math.min(255, cr + n));
        raw[o + 1] = Math.max(0, Math.min(255, cg + n));
        raw[o + 2] = Math.max(0, Math.min(255, cb + n));
      }
    }
    // Fake tripod near south pole (bottom centre-ish).
    const cx = Math.floor(W / 2);
    const cy = H - 8;
    for (let dy = -40; dy <= 8; dy++) {
      for (let dx = -30; dx <= 30; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || x >= W || y < 0 || y >= H) continue;
        const r = Math.hypot(dx, dy * 2.2);
        if (r < 18 || (Math.abs(dx) < 4 && dy > -35)) {
          const o = (y * W + x) * 3;
          raw[o] = 70;
          raw[o + 1] = 70;
          raw[o + 2] = 72;
        }
      }
    }

    return sharp(raw, { raw: { width: W, height: H, channels: 3 } })
      .jpeg({ quality: 90 })
      .toBuffer();
  }

  const sceneIds: Record<Surface, string> = {
    hardwood: living.id,
    grass: "",
    carpet: "",
    tile: "",
    concrete: "",
  };

  for (const surface of SURFACES) {
    if (surface === "hardwood") continue;
    const buf = await makeSurfacePano(surface);
    const sceneId = createHash("sha1")
      .update(`nadir-bakeoff-${surface}-${tourId}`)
      .digest("hex")
      .slice(0, 32)
      .replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, "$1-$2-$3-$4-$5");
    // Use random UUID instead for FK safety
    const { data: inserted, error: insErr } = await admin
      .from("scenes")
      .insert({
        tour_id: tourId,
        name: `Bakeoff ${surface}`,
        storage_path: `${ownerId}/${tourId}/bakeoff-${surface}.jpg`,
        width: W,
        height: H,
        position: 900 + SURFACES.indexOf(surface),
        cleaned_enabled: false,
      })
      .select("id, storage_path")
      .single();
    if (insErr || !inserted) {
      // Maybe already exists
      const { data: existing } = await admin
        .from("scenes")
        .select("id, storage_path")
        .eq("tour_id", tourId)
        .eq("name", `Bakeoff ${surface}`)
        .maybeSingle();
      if (!existing) throw new Error(insErr?.message ?? "insert failed");
      sceneIds[surface] = existing.id;
      await admin.storage
        .from("panoramas")
        .upload(existing.storage_path, buf, {
          contentType: "image/jpeg",
          upsert: true,
        });
    } else {
      sceneIds[surface] = inserted.id;
      await admin.storage
        .from("panoramas")
        .upload(inserted.storage_path, buf, {
          contentType: "image/jpeg",
          upsert: true,
        });
    }
    void sceneId;
  }

  type Row = {
    surface: Surface;
    provider: ProviderName;
    status: string;
    costCents: number | null;
    error?: string;
    debugUrls?: Record<string, string>;
    candidateUrl?: string;
    jobId?: string;
  };
  const results: Row[] = [];

  async function runOne(surface: Surface, provider: ProviderName) {
    const sceneId = sceneIds[surface];
    await admin
      .from("scenes")
      .update({ cleaned_enabled: false })
      .eq("id", sceneId);

    const { data: job, error: jobErr } = await admin
      .from("staging_jobs")
      .insert({
        tour_id: tourId,
        scene_id: sceneId,
        kind: "nadir_fill",
        status: "queued",
        params: { provider, debug: true },
      })
      .select("id")
      .single();
    if (jobErr || !job) throw new Error(jobErr?.message ?? "job insert");

    console.log(`\n=== ${surface} / ${provider} job=${job.id} ===`);
    for (let i = 0; i < 100; i++) {
      const result = await processStagingJob(job.id);
      if (result.status === "processing") {
        await new Promise((r) => setTimeout(r, 2500));
        continue;
      }
      const { data: row } = await admin
        .from("staging_jobs")
        .select("status, error, cost_cents, params, result_path")
        .eq("id", job.id)
        .single();
      const params = (row?.params ?? {}) as Record<string, unknown>;
      const debugUrls = params.debugUrls as Record<string, string> | undefined;
      const candidateUrls = params.candidateUrls as string[] | undefined;
      results.push({
        surface,
        provider,
        status: row?.status ?? result.status,
        costCents: row?.cost_cents ?? null,
        error: row?.error ?? result.error ?? undefined,
        debugUrls,
        candidateUrl: candidateUrls?.[0] ?? (row?.result_path ? publicUrl(row.result_path) : undefined),
        jobId: job.id,
      });
      console.log(
        JSON.stringify(
          {
            status: row?.status,
            cost: row?.cost_cents,
            error: row?.error,
            debug: debugUrls,
            candidate: candidateUrls?.[0],
          },
          null,
          2,
        ),
      );
      return;
    }
    results.push({
      surface,
      provider,
      status: "timeout",
      costCents: null,
      error: "poll timeout",
      jobId: job.id,
    });
  }

  for (const surface of SURFACES) {
    for (const provider of PROVIDERS) {
      const key = `${surface}/${provider}`;
      if (skip.has(key)) {
        console.log(`skip ${key}`);
        continue;
      }
      try {
        await runOne(surface, provider);
      } catch (err) {
        console.error(surface, provider, err);
        results.push({
          surface,
          provider,
          status: "failed",
          costCents: null,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  console.log("\n\n======== SUMMARY ========");
  console.log(JSON.stringify(results, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
