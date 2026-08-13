import "server-only";

import type { RgbaImage } from "@/lib/staging/projection";

/**
 * Non-AI nadir fill: synthesize the masked disc from real annulus pixels.
 * Cannot invent a material — every sample comes from the source photo.
 *
 * For each masked pixel, sample the annulus just outside the mask at a similar
 * angle, with slight radial/angular jitter and a soft blend toward the centre.
 */
export function radialTextureFill(
  crop: RgbaImage,
  mask: RgbaImage,
): RgbaImage {
  if (crop.width !== mask.width || crop.height !== mask.height) {
    throw new Error("radialTextureFill: crop/mask dimension mismatch.");
  }

  const { width: size, height } = crop;
  if (size !== height) {
    throw new Error("radialTextureFill expects a square crop.");
  }

  const out = new Uint8ClampedArray(crop.data);
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;

  // Find mask outer radius (where alpha/white falls below fill threshold).
  let maxMaskR = 0;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const m = mask.data[(j * size + i) * 4]! / 255;
      if (m > 0.05) {
        const r = Math.hypot(i - cx, j - cy);
        if (r > maxMaskR) maxMaskR = r;
      }
    }
  }
  if (maxMaskR < 2) return { data: out, width: size, height: size };

  const annulusInner = maxMaskR + 2;
  const annulusOuter = Math.min(size / 2 - 2, maxMaskR + Math.max(18, size * 0.08));

  // Deterministic LCG for reproducible jitter.
  let seed = (size * 2654435761) >>> 0;
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };

  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const o = (j * size + i) * 4;
      const m = mask.data[o]! / 255;
      if (m < 1e-3) continue;

      const dx = i - cx;
      const dy = j - cy;
      const r = Math.hypot(dx, dy);
      const ang = Math.atan2(dy, dx);

      // Source radius in the annulus, biased outward as we go toward centre.
      const t = Math.min(1, r / Math.max(1, maxMaskR));
      const baseR =
        annulusInner + (annulusOuter - annulusInner) * (0.35 + 0.65 * t);
      const jitterR = (rand() - 0.5) * 6;
      const jitterA = (rand() - 0.5) * 0.08;
      // Slight rotation so seams don't form radial spokes.
      const rot = ((i * 17 + j * 31) % 360) * (Math.PI / 180) * 0.02;

      const srcR = Math.min(size / 2 - 1.5, Math.max(0, baseR + jitterR));
      const srcA = ang + jitterA + rot;
      const sx = cx + Math.cos(srcA) * srcR;
      const sy = cy + Math.sin(srcA) * srcR;

      const [sr, sg, sb, sa] = sampleBilinearLocal(crop.data, size, size, sx, sy);
      // Near the mask edge, keep more of the original (already correct floor).
      const edgeKeep = 1 - m;
      out[o] = Math.round(crop.data[o]! * edgeKeep + sr * m);
      out[o + 1] = Math.round(crop.data[o + 1]! * edgeKeep + sg * m);
      out[o + 2] = Math.round(crop.data[o + 2]! * edgeKeep + sb * m);
      out[o + 3] = Math.round(Math.max(crop.data[o + 3]!, sa));
    }
  }

  return { data: out, width: size, height: size };
}

function sampleBilinearLocal(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
): [number, number, number, number] {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const clampX = (v: number) => Math.max(0, Math.min(width - 1, v));
  const clampY = (v: number) => Math.max(0, Math.min(height - 1, v));
  const xx0 = clampX(x0);
  const yy0 = clampY(y0);
  const xx1 = clampX(x1);
  const yy1 = clampY(y1);

  const at = (ix: number, iy: number) => {
    const o = (iy * width + ix) * 4;
    return [data[o]!, data[o + 1]!, data[o + 2]!, data[o + 3]!] as const;
  };
  const p00 = at(xx0, yy0);
  const p10 = at(xx1, yy0);
  const p01 = at(xx0, yy1);
  const p11 = at(xx1, yy1);
  const mix = (a: number, b: number, t: number) => a * (1 - t) + b * t;
  return [
    mix(mix(p00[0], p10[0], tx), mix(p01[0], p11[0], tx), ty),
    mix(mix(p00[1], p10[1], tx), mix(p01[1], p11[1], tx), ty),
    mix(mix(p00[2], p10[2], tx), mix(p01[2], p11[2], tx), ty),
    mix(mix(p00[3], p10[3], tx), mix(p01[3], p11[3], tx), ty),
  ];
}
