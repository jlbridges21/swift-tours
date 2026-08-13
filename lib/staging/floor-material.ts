import "server-only";

import type { RgbaImage } from "@/lib/staging/projection";

export type FloorMaterialHint =
  | "hardwood"
  | "tile"
  | "carpet"
  | "concrete"
  | "laminate"
  | "generic";

/**
 * Build a Fill prompt that DESCRIBES desired floor content only.
 * Never mention tripod/camera/remove/erase/delete — Fill is not instruction-
 * following; those words become content.
 */
export function buildNadirFillPrompt(material: FloorMaterialHint): string {
  const byMaterial: Record<FloorMaterialHint, string> = {
    hardwood:
      "continuous hardwood floor, wood plank flooring, consistent grain direction, even indoor lighting, uniform surface, empty floor",
    tile: "continuous ceramic tile floor, consistent grout lines, even indoor lighting, uniform surface, empty floor",
    carpet:
      "continuous carpet flooring, soft uniform pile texture, even indoor lighting, empty floor",
    concrete:
      "continuous concrete floor, subtle uniform texture, even indoor lighting, empty floor",
    laminate:
      "continuous laminate wood floor, consistent plank pattern, even indoor lighting, uniform surface, empty floor",
    generic:
      "continuous floor surface, matching surrounding floor material and color, even indoor lighting, uniform empty floor",
  };
  return byMaterial[material];
}

/**
 * Derive a coarse material hint from the annulus around the fill disc
 * (outside the mask, inside the crop). Falls back to generic.
 */
export function deriveFloorMaterialFromAnnulus(
  crop: RgbaImage,
  mask: RgbaImage,
): FloorMaterialHint {
  const { width, height, data: cropData } = crop;
  const maskData = mask.data;
  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  let n = 0;
  let edgeSum = 0;

  for (let j = 1; j < height - 1; j++) {
    for (let i = 1; i < width - 1; i++) {
      const idx = j * width + i;
      const m = maskData[idx * 4]!;
      // Annulus: preserved ring (mostly black mask) with valid crop pixels.
      if (m > 40) continue;
      const o = idx * 4;
      const a = cropData[o + 3]!;
      if (a < 200) continue;
      const r = cropData[o]!;
      const g = cropData[o + 1]!;
      const b = cropData[o + 2]!;
      rSum += r;
      gSum += g;
      bSum += b;
      n += 1;
      // Simple local contrast proxy (luma delta to right neighbour).
      const r2 = cropData[o + 4]!;
      const g2 = cropData[o + 5]!;
      const b2 = cropData[o + 6]!;
      const l1 = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const l2 = 0.2126 * r2 + 0.7152 * g2 + 0.0722 * b2;
      edgeSum += Math.abs(l1 - l2);
    }
  }

  if (n < 64) return "generic";

  const r = rSum / n;
  const g = gSum / n;
  const b = bSum / n;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const sat = max > 1e-3 ? (max - min) / max : 0;
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const edge = edgeSum / n;

  // Warm, mid-contrast → wood / laminate.
  if (sat > 0.12 && r > g && g >= b * 0.9 && luma > 60 && luma < 200) {
    return edge > 8 ? "hardwood" : "laminate";
  }
  // Cool / gray, low sat → concrete or tile.
  if (sat < 0.1) {
    if (luma > 160 && edge > 10) return "tile";
    if (luma < 140) return "concrete";
    return edge > 6 ? "tile" : "concrete";
  }
  // Soft low-edge → carpet.
  if (edge < 4 && sat < 0.25) return "carpet";

  return "generic";
}
