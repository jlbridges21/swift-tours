/**
 * Bounded prompt-framing experiment (~$0.16): one view, short piece list, four framings.
 *
 *   npx tsx --env-file=.env.local scripts/staging-prompt-framing.ts
 */
import Module from "node:module";

const originalLoad = (Module as unknown as { _load: typeof Module.prototype.require })
  ._load;
(Module as unknown as { _load: typeof Module.prototype.require })._load =
  function (request: string, parent: unknown, isMain: boolean) {
    if (request === "server-only") return {};
    return (originalLoad as Function).call(this, request, parent, isMain);
  };

process.env.STAGING_ENABLED = "true";

const DEFAULT_SCENE_ID = "2d4bb9fe-4a36-47e7-913b-cfab20550755";
const SHORT_PIECES = ["a tall fiddle-leaf fig in a woven basket"];
const GLOBAL =
  "warm oak flooring tones, brushed brass hardware, matte black accents, cream and sage textiles";

async function main() {
  const { createClient } = await import("@supabase/supabase-js");
  const sharp = (await import("sharp")).default;
  const { decodeImageToRgba, encodeRgbaToJpeg } = await import(
    "../lib/staging/image-codec"
  );
  const { equirectToPerspective } = await import("../lib/staging/projection");
  const { falKontextProvider, FAL_KONTEXT_COST_CENTS } = await import(
    "../lib/staging/providers/fal-kontext"
  );
  const { composeViewStagingPrompt } = await import(
    "../lib/staging/layout-shared"
  );
  type StagingPromptFraming =
    import("../lib/staging/layout-shared").StagingPromptFraming;
  const { getViewStrategy } = await import("../lib/staging/view-strategies");
  const { publicUrl } = await import("../lib/storage");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase env");
  if (!process.env.FAL_KEY?.trim()) throw new Error("Missing FAL_KEY");

  const sb = createClient(url, key);
  const sceneId = process.env.BAKEOFF_SCENE_ID || DEFAULT_SCENE_ID;
  const runId = `pf-${Date.now().toString(36)}`;

  const { data: scene, error: sceneErr } = await sb
    .from("scenes")
    .select("id, name, storage_path, tour_id")
    .eq("id", sceneId)
    .maybeSingle();
  if (sceneErr || !scene) throw new Error(sceneErr?.message ?? "Scene missing");

  const { data: tour } = await sb
    .from("tours")
    .select("id, owner_id")
    .eq("id", scene.tour_id)
    .maybeSingle();
  if (!tour) throw new Error("Tour missing");

  const { data: file, error: dlErr } = await sb.storage
    .from("panoramas")
    .download(scene.storage_path);
  if (dlErr || !file) throw new Error(dlErr?.message ?? "Download failed");
  const original = await decodeImageToRgba(
    Buffer.from(await file.arrayBuffer()),
  );

  const strategy = getViewStrategy("C");
  const view = strategy.views[0]!;
  const persp = equirectToPerspective(original, {
    yaw: view.yaw,
    pitch: view.pitch,
    fov: view.fov,
    width: strategy.size,
    height: strategy.size,
  });
  const cropJpeg = await encodeRgbaToJpeg(persp, 92);

  const basePrefix = `${tour.owner_id}/${tour.id}/staging-prompt-framing/${runId}`;
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

  const srcUp = await upload("source.jpg", cropJpeg, "image/jpeg");
  console.log("Source view 0:", srcUp.url);
  console.log("Short piece list:", SHORT_PIECES);
  console.log("Expected cost ~$", ((FAL_KONTEXT_COST_CENTS * 4) / 100).toFixed(2));

  const framings: {
    id: StagingPromptFraming;
    label: string;
    why?: string;
  }[] = [
    { id: "current", label: "a) Current phrasing" },
    { id: "completion", label: "b) Completion framing" },
    { id: "exclusion", label: "c) Explicit exclusion" },
    {
      id: "vacant",
      label: "d) Vacant-room alternative",
      why: "States the photo is vacant and forbids category fill-in (seating/table/rug/lamp/art) rather than only saying 'add nothing else'.",
    },
  ];

  type Row = {
    id: StagingPromptFraming;
    label: string;
    prompt: string;
    url: string;
    costCents: number;
    why?: string;
  };
  const rows: Row[] = [];

  for (const f of framings) {
    const prompt = composeViewStagingPrompt({
      pieces: SHORT_PIECES,
      globalDescriptors: GLOBAL,
      framing: f.id,
    });
    if (!prompt) throw new Error("empty prompt");

    console.log(`\n── ${f.label} ──`);
    console.log(prompt);

    const submitted = await falKontextProvider.submitInpaint({
      image: cropJpeg,
      mask: Buffer.alloc(0),
      imageUrl: srcUp.url,
      prompt,
      seed: 424242,
      numImages: 1,
      aspectRatio: "1:1",
    });

    let resultBuf: Buffer | null = null;
    let costCents = FAL_KONTEXT_COST_CENTS;
    for (let i = 0; i < 90; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const poll = await falKontextProvider.pollInpaint(submitted.providerJobId);
      if (poll.status === "queued" || poll.status === "processing") continue;
      if (poll.status !== "completed") {
        throw new Error(poll.status === "failed" ? poll.error : "Provider failed");
      }
      resultBuf = poll.image;
      costCents = poll.costCents ?? FAL_KONTEXT_COST_CENTS;
      break;
    }
    if (!resultBuf) throw new Error(`Timed out on framing ${f.id}`);

    resultBuf = await sharp(resultBuf)
      .resize(strategy.size, strategy.size, { fit: "fill" })
      .jpeg({ quality: 92 })
      .toBuffer();

    const up = await upload(`${f.id}-result.jpg`, resultBuf, "image/jpeg");
    await upload(
      `${f.id}-prompt.txt`,
      Buffer.from(prompt, "utf8"),
      "text/plain",
    );
    console.log(`Result: ${up.url} ($${(costCents / 100).toFixed(2)})`);
    rows.push({
      id: f.id,
      label: f.label,
      prompt,
      url: up.url,
      costCents,
      why: f.why,
    });
  }

  const summary = {
    sceneId: scene.id,
    runId,
    pieces: SHORT_PIECES,
    sourceUrl: srcUp.url,
    rows: rows.map((r) => ({
      id: r.id,
      label: r.label,
      url: r.url,
      costCents: r.costCents,
      why: r.why,
      prompt: r.prompt,
    })),
  };
  const sum = await upload(
    "summary.json",
    Buffer.from(JSON.stringify(summary, null, 2)),
    "application/json",
  );

  console.log("\n========== PROMPT FRAMING RESULTS ==========");
  for (const r of rows) {
    console.log(`${r.label}: ${r.url}`);
  }
  console.log("Summary:", sum.url);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
