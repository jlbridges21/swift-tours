/**
 * View-strategy bake-off with layout plan (analysis → layout → per-view prompts).
 *
 *   npx tsx --env-file=.env.local scripts/virtual-staging-bakeoff.ts
 *   npx tsx --env-file=.env.local scripts/virtual-staging-bakeoff.ts --plan-only
 *   npx tsx --env-file=.env.local scripts/virtual-staging-bakeoff.ts --regenerate-plan
 *   npx tsx --env-file=.env.local scripts/virtual-staging-bakeoff.ts --force-split
 *   STRATEGY=A npx tsx --env-file=.env.local scripts/virtual-staging-bakeoff.ts
 *
 * Defaults to strategy C. Reuses scenes.staging_room_analysis + staging_layout when present
 * unless --regenerate-plan. --force-split redistributes pieces across ≥2 views.
 */
import Module from "node:module";

const originalLoad = (Module as unknown as { _load: typeof Module.prototype.require })
  ._load;
(Module as unknown as { _load: typeof Module.prototype.require })._load =
  function (request: string, parent: unknown, isMain: boolean) {
    if (request === "server-only") return {};
    return (originalLoad as Function).call(this, request, parent, isMain);
  };

process.env.STAGING_DEBUG = "true";
process.env.STAGING_ENABLED = "true";

/** Vacant living room (hardwood) — tour 3c477cd2… */
const DEFAULT_SCENE_ID = "2d4bb9fe-4a36-47e7-913b-cfab20550755";
const DEFAULT_ROOM_KEY = "living_room_1";

async function main() {
  const planOnly = process.argv.includes("--plan-only");
  const regeneratePlan = process.argv.includes("--regenerate-plan");
  const forceSplit = process.argv.includes("--force-split");
  const { createClient } = await import("@supabase/supabase-js");
  const sharp = (await import("sharp")).default;

  const { decodeImageToRgba, encodeRgbaToJpeg } = await import(
    "../lib/staging/image-codec"
  );
  const {
    applyPitchFalloff,
    assertOutsideMaskUnchanged,
    compositeWithBlendAlpha,
    equirectToPerspective,
    perspectiveToEquirect,
  } = await import("../lib/staging/projection");
  type CoverageMask = import("../lib/staging/projection").CoverageMask;
  type RgbaImage = import("../lib/staging/projection").RgbaImage;

  const { falKontextProvider, FAL_KONTEXT_COST_CENTS } = await import(
    "../lib/staging/providers/fal-kontext"
  );
  const { buildFallbackStagingPlan } = await import(
    "../lib/staging/staging-plan-shared"
  );
  type StagingQuestionnaire =
    import("../lib/staging/staging-plan-shared").StagingQuestionnaire;
  const {
    composeViewStagingPrompt,
    forceSplitLayout,
    piecesForView,
    viewImageSeed,
  } = await import("../lib/staging/layout-shared");
  type StagingLayout = import("../lib/staging/layout-shared").StagingLayout;
  type StagingRoomAnalysis =
    import("../lib/staging/layout-shared").StagingRoomAnalysis;
  const { analyzeRoomViews } = await import("../lib/staging/room-analysis");
  const { generateLayoutPlan } = await import("../lib/staging/layout-plan");
  const { computeTourStagingOrder } = await import("../lib/staging/cross-scene");
  const { getViewStrategy } = await import("../lib/staging/view-strategies");
  type ViewStrategyId = import("../lib/staging/view-strategies").ViewStrategyId;
  const { publicUrl } = await import("../lib/storage");

  const envStrategy = (process.env.STRATEGY || "C").toUpperCase();
  const strategyIds: ViewStrategyId[] =
    envStrategy === "ALL"
      ? ["A", "B", "C"]
      : envStrategy === "A" || envStrategy === "B" || envStrategy === "C"
        ? [envStrategy]
        : ["C"];

  console.log("Flags:", {
    planOnly,
    regeneratePlan,
    forceSplit,
    strategies: strategyIds,
  });

  const QUESTIONNAIRE: StagingQuestionnaire = {
    style: "Transitional",
    palette: "Neutral warm",
    density: "Balanced",
    market: "Family home",
    includes: ["Wall art", "Area rugs", "Plants", "Lamps and lighting"],
    notes: "",
  };

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase env");
  if (!process.env.FAL_KEY?.trim()) throw new Error("Missing FAL_KEY");

  const sb = createClient(url, key);
  const runId = `vs-${Date.now().toString(36)}`;
  const sceneId = process.env.BAKEOFF_SCENE_ID || DEFAULT_SCENE_ID;

  const { data: scene, error: sceneErr } = await sb
    .from("scenes")
    .select(
      "id, name, storage_path, tour_id, width, height, room_key, room_type, staging_room_analysis, staging_layout",
    )
    .eq("id", sceneId)
    .maybeSingle();
  if (sceneErr || !scene) throw new Error(sceneErr?.message ?? "Scene missing");

  const { data: tour } = await sb
    .from("tours")
    .select("id, owner_id, title, staging_seed")
    .eq("id", scene.tour_id)
    .maybeSingle();
  if (!tour) throw new Error("Tour missing");

  const seed =
    typeof tour.staging_seed === "number" ? tour.staging_seed : 481923;
  const roomKey = scene.room_key || DEFAULT_ROOM_KEY;
  const plan = buildFallbackStagingPlan(QUESTIONNAIRE, seed);
  plan.rooms = {
    [roomKey]:
      "a charcoal three-seat linen sofa, two cream armchairs, a natural jute area rug, a walnut coffee table with brass legs, a large abstract canvas in sage and cream above the sofa, a tall fiddle-leaf fig in a woven basket",
  };
  plan.room_types = { [roomKey]: "living_room" };
  plan.global_descriptors =
    "warm oak flooring tones, brushed brass hardware, matte black accents, cream and sage textiles";
  plan.palette = "warm neutrals with muted sage accents";
  plan.style = "transitional";

  const roomDescription = plan.rooms[roomKey]!;

  console.log("\nScene:", scene.name, scene.id);
  console.log("Tour:", tour.title, tour.id);
  console.log("room_key:", roomKey);
  console.log("tour seed:", seed, "→ view seeds:", [0, 1, 2].map((i) => viewImageSeed(seed, i)).join(", "));
  console.log("Run:", runId);
  console.log("Strategies:", strategyIds.join(", "));
  console.log("Room description:", roomDescription);

  try {
    const order = await computeTourStagingOrder(scene.tour_id);
    console.log("\n========== TOUR STAGING ORDER ==========");
    for (let i = 0; i < order.length; i++) {
      const e = order[i]!;
      console.log(
        `${i + 1}. ${e.name} — ${e.outboundLinks} outbound links` +
          (e.alreadyStaged ? " [already staged]" : "") +
          (e.roomKey ? ` room_key=${e.roomKey}` : ""),
      );
    }
  } catch (err) {
    console.warn("Could not compute staging order (migration pending?):", err);
  }

  const { data: file, error: dlErr } = await sb.storage
    .from("panoramas")
    .download(scene.storage_path);
  if (dlErr || !file) throw new Error(dlErr?.message ?? "Download failed");
  const originalBuf = Buffer.from(await file.arrayBuffer());
  const original = await decodeImageToRgba(originalBuf);

  const basePrefix = `${tour.owner_id}/${tour.id}/staging-bakeoff/${runId}`;

  async function upload(rel: string, body: Buffer, contentType: string) {
    const path = `${basePrefix}/${rel}`;
    const { error } = await sb.storage.from("panoramas").upload(path, body, {
      contentType,
      upsert: true,
      cacheControl: "60",
    });
    if (error) throw new Error(error.message);
    return { path, url: publicUrl(path) };
  }

  type Row = {
    strategy: ViewStrategyId;
    views: number;
    generated: number;
    skipped: number;
    costCents: number;
    seconds: number;
    candidateUrl: string;
    resolutions: string[];
    error?: string;
  };
  const rows: Row[] = [];

  for (const strategyId of strategyIds) {
    const strategy = getViewStrategy(strategyId);
    console.log(`\n── Strategy ${strategyId}: ${strategy.name} ──`);

    const storedAnalysis = scene.staging_room_analysis as StagingRoomAnalysis | null;
    const storedLayout = scene.staging_layout as StagingLayout | null;
    const canReuse =
      !regeneratePlan &&
      storedAnalysis &&
      Array.isArray(storedAnalysis.views) &&
      storedAnalysis.strategy === strategyId &&
      storedLayout &&
      Array.isArray(storedLayout.views) &&
      storedLayout.strategy === strategyId;

    let analysis: StagingRoomAnalysis;
    let layout: StagingLayout;

    if (canReuse) {
      analysis = storedAnalysis;
      layout = storedLayout;
      console.info(
        `[bakeoff] reusing stored analysis+layout for scene ${scene.id} room_key=${roomKey} strategy=${strategyId} (pass --regenerate-plan to rebuild)`,
      );
    } else {
      const analysisUrls: string[] = [];
      for (const v of strategy.views) {
        const persp = equirectToPerspective(original, {
          yaw: v.yaw,
          pitch: v.pitch,
          fov: v.fov,
          width: Math.min(768, strategy.size),
          height: Math.min(768, strategy.size),
        });
        const jpeg = await encodeRgbaToJpeg(persp, 85);
        const up = await upload(
          `${strategyId}/analysis-${v.index}.jpg`,
          jpeg,
          "image/jpeg",
        );
        analysisUrls.push(up.url);
      }

      analysis = await analyzeRoomViews({
        strategy: strategyId,
        imageUrls: analysisUrls,
      });
      layout = await generateLayoutPlan({
        strategy: strategyId,
        roomDescription,
        analysis,
      });

      // Persist so a second run reuses without regenerating.
      const { error: persistErr } = await sb
        .from("scenes")
        .update({
          staging_room_analysis: analysis,
          staging_layout: layout,
          room_key: roomKey,
          room_type: "living_room",
        })
        .eq("id", scene.id);
      if (persistErr) {
        console.warn(
          "[bakeoff] could not persist analysis/layout (apply migration 0020/0021?):",
          persistErr.message,
        );
      } else {
        console.info(
          `[bakeoff] generated+stored analysis+layout for scene ${scene.id}`,
        );
      }
    }

    if (forceSplit) {
      layout = forceSplitLayout(layout, analysis);
      console.info("[bakeoff] --force-split applied:", JSON.stringify(layout.views));
    }
    console.log("\n========== ROOM ANALYSIS ==========");
    console.log(JSON.stringify(analysis, null, 2));
    console.log("\n========== LAYOUT PLAN ==========");
    console.log(JSON.stringify(layout, null, 2));

    console.log("\n========== INTENDED VIEW ORDER / SOURCES ==========");
    let priorListed: number[] = [];
    for (const v of strategy.views) {
      const pieces = piecesForView(layout, v.index);
      if (pieces.length === 0) {
        console.log(
          `view ${v.index}: SKIP (empty) — no extract, working unchanged`,
        );
        continue;
      }
      console.log(
        `view ${v.index}: extract from running_composite` +
          (priorListed.length
            ? ` (already composited: ${priorListed.join(", ")})`
            : " (initialized from original)") +
          ` → generate @ ${strategy.size}×${strategy.size} (1:1, no intra-scene collage)` +
          ` → composite back into working`,
      );
      priorListed = [...priorListed, v.index];
    }
    console.log("candidate = final working composite");

    for (const v of layout.views) {
      const prompt = composeViewStagingPrompt({
        pieces: v.pieces,
        globalDescriptors: plan.global_descriptors,
      });
      console.log(`\n── View ${v.index} prompt ──`);
      console.log(prompt ?? "(SKIP — empty pieces; no model call)");
    }

    await upload(
      `${strategyId}/analysis.json`,
      Buffer.from(JSON.stringify(analysis, null, 2)),
      "application/json",
    );
    await upload(
      `${strategyId}/layout.json`,
      Buffer.from(JSON.stringify(layout, null, 2)),
      "application/json",
    );

    if (planOnly) {
      console.log("\n--plan-only: stopping before Kontext generation.");
      continue;
    }

    const t0 = Date.now();
    let costCents = 0;
    let generated = 0;
    let skipped = 0;
    const resolutions: string[] = [];
    const viewResults: { index: number; buf: Buffer }[] = [];

    let working: RgbaImage = {
      data: new Uint8ClampedArray(original.data),
      width: original.width,
      height: original.height,
    };
    const unionAlpha: CoverageMask = {
      data: new Float32Array(original.width * original.height),
      width: original.width,
      height: original.height,
    };

    try {
      for (const view of strategy.views) {
        const pieces = piecesForView(layout, view.index);
        const viewPrompt = composeViewStagingPrompt({
          pieces,
          globalDescriptors: plan.global_descriptors,
        });

        if (!viewPrompt) {
          skipped += 1;
          console.log(`  view ${view.index}: SKIP (empty pieces)`);
          resolutions.push(`${view.index}:skipped`);
          continue;
        }

        const priorIdx = viewResults.map((r) => r.index);
        console.log(
          `  view ${view.index} extract source=running_composite` +
            (priorIdx.length
              ? ` (already composited: ${priorIdx.join(", ")})`
              : " (from original init)"),
        );

        const persp = equirectToPerspective(working, {
          yaw: view.yaw,
          pitch: view.pitch,
          fov: view.fov,
          width: strategy.size,
          height: strategy.size,
        });
        const cropJpeg = await encodeRgbaToJpeg(persp, 92);
        const srcUp = await upload(
          `${strategyId}/view-${view.index}-source.jpg`,
          cropJpeg,
          "image/jpeg",
        );

        const submitBuf = cropJpeg;
        const stagedPrompt = viewPrompt;

        console.log(
          `  submitting view ${view.index + 1}/${strategy.views.length} (1:1 native ${strategy.size}²)…`,
        );
        const submitted = await falKontextProvider.submitInpaint({
          image: submitBuf,
          mask: Buffer.alloc(0),
          imageUrl: srcUp.url,
          prompt: stagedPrompt,
          seed: viewImageSeed(seed, view.index),
          numImages: 1,
          aspectRatio: "1:1",
        });
        console.log(
          `  image seed=${viewImageSeed(seed, view.index)} (tourSeed + viewIndex*17)`,
        );

        let resultBuf: Buffer | null = null;
        for (let i = 0; i < 90; i++) {
          await new Promise((r) => setTimeout(r, 2000));
          const poll = await falKontextProvider.pollInpaint(
            submitted.providerJobId,
          );
          if (poll.status === "queued" || poll.status === "processing") continue;
          if (poll.status !== "completed") {
            throw new Error(
              poll.status === "failed" ? poll.error : "Provider failed",
            );
          }
          resultBuf = poll.image;
          costCents += poll.costCents ?? FAL_KONTEXT_COST_CENTS;
          break;
        }
        if (!resultBuf) throw new Error("Timed out waiting for provider");

        const rawMeta = await sharp(resultBuf).metadata();
        console.log(
          `  raw provider output: ${rawMeta.width}×${rawMeta.height}`,
        );

        resultBuf = await sharp(resultBuf)
          .resize(strategy.size, strategy.size, { fit: "fill" })
          .jpeg({ quality: 92 })
          .toBuffer();

        const finalMeta = await sharp(resultBuf).metadata();
        resolutions.push(
          `${view.index}:${rawMeta.width}x${rawMeta.height}→${finalMeta.width}x${finalMeta.height}`,
        );

        const resUp = await upload(
          `${strategyId}/view-${view.index}-result.jpg`,
          resultBuf,
          "image/jpeg",
        );
        viewResults.push({ index: view.index, buf: resultBuf });
        generated += 1;

        // Progressive composite into working.
        const staged = await decodeImageToRgba(resultBuf);
        const re = perspectiveToEquirect(staged, {
          yaw: view.yaw,
          pitch: view.pitch,
          fov: view.fov,
          targetWidth: original.width,
          targetHeight: original.height,
        });
        const faded = applyPitchFalloff(re.mask);
        for (let i = 0; i < unionAlpha.data.length; i++) {
          unionAlpha.data[i] = Math.max(unionAlpha.data[i]!, faded.data[i]!);
        }
        working = compositeWithBlendAlpha(working, re.image, faded);
        console.log(
          `  view ${view.index} composited into running buffer — ${resUp.url}`,
        );
      }

      assertOutsideMaskUnchanged(original, working, unionAlpha);
      const candidateJpeg = await encodeRgbaToJpeg(working, 92);
      const cand = await upload(
        `${strategyId}/staged-candidate.jpg`,
        candidateJpeg,
        "image/jpeg",
      );

      const seconds = Math.round((Date.now() - t0) / 1000);
      rows.push({
        strategy: strategyId,
        views: strategy.views.length,
        generated,
        skipped,
        costCents,
        seconds,
        candidateUrl: cand.url,
        resolutions,
      });
      console.log(
        `  DONE ${strategyId}: $${(costCents / 100).toFixed(2)} in ${seconds}s` +
          ` (${generated} gen, ${skipped} skip)`,
      );
      console.log(`  resolutions: ${resolutions.join(", ")}`);
      console.log(`  candidate: ${cand.url}`);
    } catch (err) {
      const seconds = Math.round((Date.now() - t0) / 1000);
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  FAIL ${strategyId}:`, message);
      rows.push({
        strategy: strategyId,
        views: strategy.views.length,
        generated,
        skipped,
        costCents,
        seconds,
        candidateUrl: "",
        resolutions,
        error: message,
      });
    }
  }

  if (!planOnly && rows.length > 0) {
    const summary = { sceneId: scene.id, sceneName: scene.name, runId, rows };
    const sumUp = await upload(
      "summary.json",
      Buffer.from(JSON.stringify(summary, null, 2)),
      "application/json",
    );
    console.log("\n========== BAKE-OFF TABLE ==========");
    console.log("| Strat | Gen/Skip | Cost | Time | Candidate |");
    console.log("|---|---|---|---|---|");
    for (const r of rows) {
      console.log(
        `| ${r.strategy} | ${r.generated}/${r.skipped} | $${(r.costCents / 100).toFixed(2)} | ${r.seconds}s | ${r.candidateUrl || r.error || "—"} |`,
      );
    }
    console.log("Summary:", sumUp.url);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
