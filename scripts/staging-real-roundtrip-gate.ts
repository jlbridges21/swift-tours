/**
 * Part 0 validation gate: no-op projection round-trip on a real Theta pano.
 * Usage:
 *   npx tsx scripts/staging-real-roundtrip-gate.ts [sceneId]
 * Defaults to Living Room (5376×2688).
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";

import {
  roundTripNoEdit,
  type RgbaImage,
} from "../lib/staging/projection";

function loadEnvLocal() {
  const path = resolve(process.cwd(), ".env.local");
  const text = readFileSync(path, "utf8");
  for (const line of text.split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    const key = m[1].trim();
    let val = m[2].trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

function peakHeapMb(): number {
  const m = process.memoryUsage();
  return (
    Math.round(
      ((m.heapUsed + (m.external ?? 0) + (m.arrayBuffers ?? 0)) / 1024 / 1024) *
        10,
    ) / 10
  );
}

function rssMb(): number {
  return Math.round((process.memoryUsage().rss / 1024 / 1024) * 10) / 10;
}

async function decodeJpeg(input: Buffer): Promise<RgbaImage> {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
    width: info.width,
    height: info.height,
  };
}

async function main() {
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  const sceneId =
    process.argv[2] ?? "fe646b7d-cf48-425f-8ed3-ea0a946f2aed";

  const sb = createClient(url, key);
  const { data: scene, error } = await sb
    .from("scenes")
    .select("id, name, storage_path, width, height, tour_id")
    .eq("id", sceneId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!scene) throw new Error(`Scene ${sceneId} not found`);

  console.log("Scene:", scene.name, scene.width, "×", scene.height);
  console.log("Path:", scene.storage_path);
  console.log("Heap before download:", peakHeapMb(), "MB; RSS:", rssMb(), "MB");

  const { data: file, error: dlError } = await sb.storage
    .from("panoramas")
    .download(scene.storage_path);
  if (dlError || !file) throw new Error(dlError?.message ?? "download failed");

  const input = Buffer.from(await file.arrayBuffer());
  console.log("JPEG bytes:", input.length);
  console.log("Heap after download:", peakHeapMb(), "MB; RSS:", rssMb(), "MB");

  const rgba = await decodeJpeg(input);
  console.log("Decoded:", rgba.width, "×", rgba.height);
  console.log("Heap after decode:", peakHeapMb(), "MB; RSS:", rssMb(), "MB");

  let peakHeap = peakHeapMb();
  let peakRss = rssMb();
  const tick = setInterval(() => {
    peakHeap = Math.max(peakHeap, peakHeapMb());
    peakRss = Math.max(peakRss, rssMb());
  }, 200);

  const t0 = performance.now();
  const trip = roundTripNoEdit(rgba, { perspectiveSize: 512 });
  const durationMs = Math.round(performance.now() - t0);
  clearInterval(tick);
  peakHeap = Math.max(peakHeap, peakHeapMb());
  peakRss = Math.max(peakRss, rssMb());

  console.log(
    JSON.stringify(
      {
        where: "local",
        width: rgba.width,
        height: rgba.height,
        viewCount: trip.viewCount,
        durationMs,
        peakHeapMb: peakHeap,
        peakRssMb: peakRss,
        replaceStats: trip.replaceStats,
        changedOnlyStats: trip.changedOnlyStats,
        seamReplaceStats: trip.seamReplaceStats,
        memoryStrategy:
          "Float32 accumulators + sequential views; full-res composite (no downscale)",
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
