"use client";

import imageCompression from "browser-image-compression";

import { readImageDimensions } from "@/lib/image";

const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const MAX_LONG_EDGE = 2048;
const MAX_BYTES = 25 * 1024 * 1024;

export type ProcessFloorPlanResult = {
  blob: Blob;
  contentType: "image/jpeg";
  extension: ".jpg";
  width: number;
  height: number;
};

export async function validateFloorPlan(
  file: File,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!ALLOWED_TYPES.has(file.type)) {
    return { ok: false, error: "Use a JPG, PNG, or WebP image." };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, error: "Floor plan must be under 25 MB." };
  }
  return { ok: true };
}

/**
 * Cap the long edge at 2048 and encode as JPEG — plans are line art, not huge.
 * Returns intrinsic width/height of the compressed output.
 */
export async function processFloorPlan(
  file: File,
): Promise<ProcessFloorPlanResult> {
  const { width: srcW, height: srcH } = await readImageDimensions(file);
  const longEdge = Math.max(srcW, srcH);
  const needsResize = longEdge > MAX_LONG_EDGE;

  const compressed = await imageCompression(file, {
    maxWidthOrHeight: needsResize ? MAX_LONG_EDGE : longEdge,
    maxSizeMB: 2,
    useWebWorker: true,
    fileType: "image/jpeg",
    initialQuality: 0.85,
  });

  const { width, height } = await readImageDimensions(compressed);

  return {
    blob: compressed,
    contentType: "image/jpeg",
    extension: ".jpg",
    width,
    height,
  };
}
