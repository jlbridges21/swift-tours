/**
 * Offline no-op round-trip self-test (no Supabase, no AI).
 *
 *   npx tsx scripts/staging-projection-selftest.ts
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import sharp from "sharp";

import {
  defaultSphereViews,
  diffStats,
  equirectToPerspective,
  perspectiveToEquirect,
  replaceCoveredPixels,
  roundTripNoEdit,
  type RgbaImage,
} from "../lib/staging/projection";

/** Smooth gradient + seam markers — closer to real panorama spectra than noise. */
function makeTestEquirect(width: number, height: number): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const u = x / width;
      const v = y / height;
      // Smooth longitude/latitude ramps (continuous except intentional seam marks).
      data[o] = Math.round(40 + 180 * (0.5 + 0.5 * Math.sin(u * Math.PI * 2)));
      data[o + 1] = Math.round(40 + 180 * v);
      data[o + 2] = Math.round(40 + 180 * (1 - v) * (0.5 + 0.5 * Math.cos(u * Math.PI * 2)));
      data[o + 3] = 255;
      // 2px red markers at the ±π seam (x≈0 and x≈W).
      if (x < 2 || x >= width - 2) {
        data[o] = 220;
        data[o + 1] = 30;
        data[o + 2] = 30;
      }
    }
  }
  return { data, width, height };
}

async function main() {
  const width = 2048;
  const height = 1024;
  const original = makeTestEquirect(width, height);

  const seamView = { yaw: Math.PI, pitch: 0, fov: Math.PI / 2 };
  const seamPersp = equirectToPerspective(original, {
    ...seamView,
    width: 768,
    height: 768,
  });
  const seamBack = perspectiveToEquirect(seamPersp, {
    ...seamView,
    targetWidth: width,
    targetHeight: height,
  });
  const seamReplaced = replaceCoveredPixels(
    original,
    seamBack.image,
    seamBack.mask,
  );
  const seamOnlyStats = diffStats(original, seamReplaced, seamBack.mask);

  const trip = roundTripNoEdit(original, {
    views: defaultSphereViews(),
    perspectiveSize: 768,
  });

  const outDir = join(process.cwd(), ".tmp-staging");
  mkdirSync(outDir, { recursive: true });

  const jpeg = await sharp(Buffer.from(trip.changedOnly.data), {
    raw: { width, height, channels: 4 },
  })
    .jpeg({ quality: 92 })
    .toBuffer();
  writeFileSync(join(outDir, "roundtrip-changed.jpg"), jpeg);

  const origJpeg = await sharp(Buffer.from(original.data), {
    raw: { width, height, channels: 4 },
  })
    .jpeg({ quality: 92 })
    .toBuffer();
  writeFileSync(join(outDir, "original.jpg"), origJpeg);

  writeFileSync(
    join(outDir, "meta.json"),
    JSON.stringify(
      {
        width,
        height,
        viewCount: trip.viewCount,
        replaceStats: trip.replaceStats,
        changedOnlyStats: trip.changedOnlyStats,
        seamReplaceStats: trip.seamReplaceStats,
        singleSeamViewStats: seamOnlyStats,
      },
      null,
      2,
    ),
  );

  console.log("=== Staging projection self-test ===");
  console.log(`Resolution: ${width}×${height}, views: ${trip.viewCount}`);
  console.log("\nCovered-pixel replace (reprojection fidelity):");
  console.log(trip.replaceStats);
  console.log("\nChange-only composite (must ≈ original):");
  console.log(trip.changedOnlyStats);
  console.log("\nSeam band replace stats:");
  console.log(trip.seamReplaceStats);
  console.log("\nSingle seam-centered view (mask-only):");
  console.log(seamOnlyStats);
  console.log(`\nEyeball: ${join(outDir, "original.jpg")} vs ${join(outDir, "roundtrip-changed.jpg")}`);

  if (trip.changedOnlyStats.meanAbsError > 0.25) {
    console.error("FAIL: change-only composite drifted from original.");
    process.exit(1);
  }
  if (trip.replaceStats.meanAbsError > 6) {
    console.error("FAIL: replace MAE too high.");
    process.exit(1);
  }
  if (seamOnlyStats.meanAbsError > 6) {
    console.error("FAIL: seam-centered view MAE too high.");
    process.exit(1);
  }
  console.log("\nPASS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
