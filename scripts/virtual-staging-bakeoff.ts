/**
 * View-strategy bake-off for virtual staging (A/B/C/D) on one real vacant room.
 *
 *   npx tsx --env-file=.env.local scripts/virtual-staging-bakeoff.ts
 *
 * Does not require migration 0019 — writes artifacts to storage under
 * {owner}/{tour}/staging-bakeoff/{runId}/…
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

async function main() {
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
    nadirCrop,
    nadirCropToEquirect,
    perspectiveToEquirect,
  } = await import("../lib/staging/projection");
  type CoverageMask = import("../lib/staging/projection").CoverageMask;
  type RgbaImage = import("../lib/staging/projection").RgbaImage;

  const { falKontextProvider, FAL_KONTEXT_COST_CENTS } = await import(
    "../lib/staging/providers/fal-kontext"
  );
  const { buildFallbackStagingPlan, composeRoomStagingPrompt } = await import(
    "../lib/staging/staging-plan-shared"
  );
  type StagingQuestionnaire =
    import("../lib/staging/staging-plan-shared").StagingQuestionnaire;
  const { getViewStrategy } = await import("../lib/staging/view-strategies");
  type ViewStrategyId = import("../lib/staging/view-strategies").ViewStrategyId;
  const { publicUrl } = await import("../lib/storage");

  const STRATEGIES: ViewStrategyId[] = ["A", "B", "C", "D"];

  const QUESTIONNAIRE: StagingQuestionnaire = {
    style: "Transitional",
    palette: "Neutral warm",
    density: "Balanced",
    market: "Family home",
    includes: ["Wall art", "Area rugs", "Plants", "Lamps and lighting"],
    notes: "",
  };

  async function buildReferenceCollage(
    current: Buffer,
    previous: Buffer,
  ): Promise<Buffer> {
    const [l, r] = await Promise.all([
      sharp(current).resize(768, 768, { fit: "fill" }).toBuffer(),
      sharp(previous).resize(768, 768, { fit: "fill" }).toBuffer(),
    ]);
    return sharp({
      create: {
        width: 1536,
        height: 768,
        channels: 3,
        background: { r: 0, g: 0, b: 0 },
      },
    })
      .composite([
        { input: l, left: 0, top: 0 },
        { input: r, left: 768, top: 0 },
      ])
      .jpeg({ quality: 90 })
      .toBuffer();
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase env");
  if (!process.env.FAL_KEY?.trim()) throw new Error("Missing FAL_KEY");

  const sb = createClient(url, key);
  const runId = `vs-${Date.now().toString(36)}`;
  const sceneId = process.env.BAKEOFF_SCENE_ID || DEFAULT_SCENE_ID;

  const { data: scene, error: sceneErr } = await sb
    .from("scenes")
    .select("id, name, storage_path, tour_id, width, height")
    .eq("id", sceneId)
    .maybeSingle();
  if (sceneErr || !scene) throw new Error(sceneErr?.message ?? "Scene missing");

  const { data: tour } = await sb
    .from("tours")
    .select("id, owner_id, title")
    .eq("id", scene.tour_id)
    .maybeSingle();
  if (!tour) throw new Error("Tour missing");

  const seed = 481923;
  const plan = buildFallbackStagingPlan(QUESTIONNAIRE, seed);
  plan.rooms.living_room =
    "a charcoal three-seat linen sofa, two cream armchairs, a natural jute area rug, a walnut coffee table with brass legs, a large abstract canvas in sage and cream above the sofa, a tall fiddle-leaf fig in a woven basket";
  plan.global_descriptors =
    "warm oak flooring tones, brushed brass hardware, matte black accents, cream and sage textiles";
  plan.palette = "warm neutrals with muted sage accents";
  plan.style = "transitional";

  const prompt = composeRoomStagingPrompt({
    roomType: "living_room",
    plan,
    intensity: "fully",
  });

  console.log("\n========== COMPOSED PROMPT ==========");
  console.log(prompt);
  console.log("=====================================\n");
  console.log("Scene:", scene.name, scene.id);
  console.log("Tour:", tour.title, tour.id);
  console.log("Run:", runId);

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

  await upload("prompt.txt", Buffer.from(prompt, "utf8"), "text/plain");

  type Row = {
    strategy: ViewStrategyId;
    views: number;
    costCents: number;
    seconds: number;
    candidateUrl: string;
    debugUrls: Record<string, string>;
    error?: string;
  };
  const rows: Row[] = [];

  for (const strategyId of STRATEGIES) {
    const strategy = getViewStrategy(strategyId);
    console.log(`\n── Strategy ${strategyId}: ${strategy.name} ──`);
    const t0 = Date.now();
    let costCents = 0;
    const debugUrls: Record<string, string> = {};
    const viewResults: { index: number; buf: Buffer }[] = [];

    try {
      for (const view of strategy.views) {
        let cropJpeg: Buffer;
        if (strategyId === "D") {
          const crop = nadirCrop(original, {
            fovDegrees: 160,
            size: strategy.size,
          });
          cropJpeg = await encodeRgbaToJpeg(crop, 92);
        } else {
          const persp = equirectToPerspective(original, {
            yaw: view.yaw,
            pitch: view.pitch,
            fov: view.fov,
            width: strategy.size,
            height: strategy.size,
          });
          cropJpeg = await encodeRgbaToJpeg(persp, 92);
        }

        const srcUp = await upload(
          `${strategyId}/view-${view.index}-source.jpg`,
          cropJpeg,
          "image/jpeg",
        );
        debugUrls[`view-${view.index}-source`] = srcUp.url;

        let submitBuf = cropJpeg;
        let usedCollage = false;
        const prior = viewResults[viewResults.length - 1];
        if (prior) {
          submitBuf = await buildReferenceCollage(cropJpeg, prior.buf);
          usedCollage = true;
          const col = await upload(
            `${strategyId}/view-${view.index}-collage.jpg`,
            submitBuf,
            "image/jpeg",
          );
          debugUrls[`view-${view.index}-collage`] = col.url;
        }

        const stagedPrompt = usedCollage
          ? `${prompt} The image is a side-by-side pair: furnish ONLY the LEFT half. The RIGHT half is an adjacent already-staged view — match the same furniture pieces, materials, and lighting in the overlap.`
          : prompt;

        console.log(
          `  submitting view ${view.index + 1}/${strategy.views.length}…`,
        );
        const submitted = await falKontextProvider.submitInpaint({
          image: submitBuf,
          mask: Buffer.alloc(0),
          imageUrl: usedCollage
            ? debugUrls[`view-${view.index}-collage`]
            : srcUp.url,
          prompt: stagedPrompt,
          seed: seed + view.index * 17,
          numImages: 1,
        });

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

        if (usedCollage) {
          const meta = await sharp(resultBuf).metadata();
          if (meta.width && meta.height && meta.width >= meta.height * 1.5) {
            resultBuf = await sharp(resultBuf)
              .extract({
                left: 0,
                top: 0,
                width: Math.floor(meta.width / 2),
                height: meta.height,
              })
              .resize(strategy.size, strategy.size, { fit: "fill" })
              .jpeg({ quality: 92 })
              .toBuffer();
          }
        } else {
          resultBuf = await sharp(resultBuf)
            .resize(strategy.size, strategy.size, { fit: "fill" })
            .jpeg({ quality: 92 })
            .toBuffer();
        }

        const resUp = await upload(
          `${strategyId}/view-${view.index}-result.jpg`,
          resultBuf,
          "image/jpeg",
        );
        debugUrls[`view-${view.index}-result`] = resUp.url;
        viewResults.push({ index: view.index, buf: resultBuf });
        console.log(`  view ${view.index} done — ${resUp.url}`);
      }

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

      for (const v of strategy.views) {
        const entry = viewResults.find((r) => r.index === v.index)!;
        const staged = await decodeImageToRgba(entry.buf);
        let patch: RgbaImage;
        let coverage: CoverageMask;
        if (strategyId === "D") {
          const re = nadirCropToEquirect(staged, {
            fovDegrees: 160,
            size: strategy.size,
            targetWidth: original.width,
            targetHeight: original.height,
          });
          patch = re.image;
          coverage = re.mask;
        } else {
          const re = perspectiveToEquirect(staged, {
            yaw: v.yaw,
            pitch: v.pitch,
            fov: v.fov,
            targetWidth: original.width,
            targetHeight: original.height,
          });
          patch = re.image;
          coverage = re.mask;
        }
        const faded = applyPitchFalloff(coverage);
        for (let i = 0; i < unionAlpha.data.length; i++) {
          unionAlpha.data[i] = Math.max(unionAlpha.data[i]!, faded.data[i]!);
        }
        working = compositeWithBlendAlpha(working, patch, faded);
      }

      assertOutsideMaskUnchanged(original, working, unionAlpha);
      const candidateJpeg = await encodeRgbaToJpeg(working, 92);
      const cand = await upload(
        `${strategyId}/staged-candidate.jpg`,
        candidateJpeg,
        "image/jpeg",
      );
      debugUrls.candidate = cand.url;

      const seconds = Math.round((Date.now() - t0) / 1000);
      rows.push({
        strategy: strategyId,
        views: strategy.views.length,
        costCents,
        seconds,
        candidateUrl: cand.url,
        debugUrls,
      });
      console.log(
        `  DONE ${strategyId}: $${(costCents / 100).toFixed(2)} in ${seconds}s`,
      );
      console.log(`  candidate: ${cand.url}`);
    } catch (err) {
      const seconds = Math.round((Date.now() - t0) / 1000);
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  FAIL ${strategyId}:`, message);
      rows.push({
        strategy: strategyId,
        views: strategy.views.length,
        costCents,
        seconds,
        candidateUrl: "",
        debugUrls,
        error: message,
      });
    }
  }

  const summary = {
    sceneId: scene.id,
    sceneName: scene.name,
    prompt,
    seed,
    runId,
    rows,
  };
  const sumUp = await upload(
    "summary.json",
    Buffer.from(JSON.stringify(summary, null, 2)),
    "application/json",
  );

  console.log("\n========== BAKE-OFF TABLE ==========");
  console.log("| Strat | Views | Cost | Time | Candidate |");
  console.log("|---|---|---|---|---|");
  for (const r of rows) {
    console.log(
      `| ${r.strategy} | ${r.views} | $${(r.costCents / 100).toFixed(2)} | ${r.seconds}s | ${r.candidateUrl || r.error || "—"} |`,
    );
  }
  console.log("Summary:", sumUp.url);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
