"use client";

import imageCompression from "browser-image-compression";

import { readImageDimensions } from "@/lib/image";

const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const MAX_LONG_EDGE = 2048;
const THUMB_LONG_EDGE = 400;
const MAX_BYTES = 25 * 1024 * 1024;
export const GALLERY_MAX_IMAGES = 20;
export const GALLERY_UPLOAD_CONCURRENCY = 3;

export type ProcessGalleryImageResult = {
  full: Blob;
  thumb: Blob;
  contentType: "image/jpeg";
  extension: ".jpg";
  width: number;
  height: number;
};

export async function validateGalleryImage(
  file: File,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!ALLOWED_TYPES.has(file.type)) {
    return { ok: false, error: "Use a JPG, PNG, or WebP image." };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, error: "Each gallery image must be under 25 MB." };
  }
  return { ok: true };
}

/**
 * Ordinary photos (not panoramas): long edge ≤ 2048, JPEG q≈0.85, plus a 400px thumb.
 */
export async function processGalleryImage(
  file: File,
): Promise<ProcessGalleryImageResult> {
  const { width: srcW, height: srcH } = await readImageDimensions(file);
  const longEdge = Math.max(srcW, srcH);

  const full = await imageCompression(file, {
    maxWidthOrHeight: longEdge > MAX_LONG_EDGE ? MAX_LONG_EDGE : longEdge,
    maxSizeMB: 3,
    useWebWorker: true,
    fileType: "image/jpeg",
    initialQuality: 0.85,
  });

  const thumb = await imageCompression(file, {
    maxWidthOrHeight: THUMB_LONG_EDGE,
    maxSizeMB: 0.4,
    useWebWorker: true,
    fileType: "image/jpeg",
    initialQuality: 0.8,
  });

  const { width, height } = await readImageDimensions(full);

  return {
    full,
    thumb,
    contentType: "image/jpeg",
    extension: ".jpg",
    width,
    height,
  };
}

/** Worker pool — same pattern as the panorama uploader. */
export async function mapPool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  async function run(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  }

  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    () => run(),
  );
  await Promise.all(runners);
  return results;
}
