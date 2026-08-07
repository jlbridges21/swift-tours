"use client";

import imageCompression from "browser-image-compression";

const MAX_BYTES = 200 * 1024 * 1024;
const WARN_BYTES = 50 * 1024 * 1024;
const COMPAT_WIDTH = 4096;
const COMPAT_HEIGHT = 2048;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png"]);
const ASPECT_TOLERANCE = 0.03;

export type ValidatePanoramaResult = {
  ok: boolean;
  error?: string;
  warning?: string;
  width?: number;
  height?: number;
};

export type ProcessPanoramaResult = {
  /** Original file bytes — never re-encoded. */
  original: File;
  contentType: "image/jpeg" | "image/png";
  extension: ".jpg" | ".png";
  width: number;
  height: number;
  fileSize: number;
  /** 4096×2048 JPEG when width > 4096; otherwise null. */
  compat: Blob | null;
  thumb: Blob;
};

/**
 * Read width/height from PNG/JPEG headers without a full decode when possible.
 * Falls back to createImageBitmap only if header parsing fails.
 */
export async function readImageDimensions(
  file: File,
): Promise<{ width: number; height: number }> {
  const header = new Uint8Array(await file.slice(0, 65536).arrayBuffer());

  const png = tryParsePng(header);
  if (png) return png;

  const jpeg = tryParseJpeg(header);
  if (jpeg) return jpeg;

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
    return { width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap?.close();
  }
}

function tryParsePng(
  bytes: Uint8Array,
): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== sig[i]) return null;
  }
  // IHDR starts at byte 8; width/height are big-endian at 16 and 20.
  const width =
    (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
  const height =
    (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

function tryParseJpeg(
  bytes: Uint8Array,
): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    // Soften / restart / standalone markers without a length field.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2;
      continue;
    }
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2) return null;

    // SOF0 / SOF1 / SOF2 … baseline & progressive frames carry dimensions.
    const isSof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);

    if (isSof) {
      const height = (bytes[offset + 5] << 8) | bytes[offset + 6];
      const width = (bytes[offset + 7] << 8) | bytes[offset + 8];
      if (width <= 0 || height <= 0) return null;
      return { width, height };
    }

    offset += 2 + length;
  }
  return null;
}

export async function validatePanorama(
  file: File,
): Promise<ValidatePanoramaResult> {
  if (!ALLOWED_TYPES.has(file.type)) {
    return { ok: false, error: "Only JPEG and PNG images are supported." };
  }

  if (file.size > MAX_BYTES) {
    return { ok: false, error: "File must be under 200MB." };
  }

  try {
    const { width, height } = await readImageDimensions(file);
    const ratio = width / height;
    const drift = Math.abs(ratio - 2) / 2;

    const warnings: string[] = [];
    if (drift > ASPECT_TOLERANCE) {
      warnings.push(
        "This image isn’t close to a 2:1 aspect ratio, so it may not be a true 360° panorama.",
      );
    }
    if (file.size > WARN_BYTES) {
      warnings.push(
        "This file is over 50MB and may load slowly for visitors on mobile or slow connections.",
      );
    }

    return {
      ok: true,
      width,
      height,
      warning: warnings.length > 0 ? warnings.join(" ") : undefined,
    };
  } catch {
    return { ok: false, error: "Could not read this image." };
  }
}

async function canvasToJpeg(
  source: ImageBitmap,
  width: number,
  height: number,
  quality: number,
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Could not create canvas context.");
  }

  ctx.drawImage(source, 0, 0, width, height);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => {
        if (result) resolve(result);
        else reject(new Error("Failed to encode JPEG."));
      },
      "image/jpeg",
      quality,
    );
  });

  canvas.width = 0;
  canvas.height = 0;
  return blob;
}

/**
 * Keep the original file untouched. Generate a thumbnail always, and a 4k
 * compat JPEG only when the original is wider than 4096px.
 */
export async function processPanorama(
  file: File,
  dimensions?: { width: number; height: number },
): Promise<ProcessPanoramaResult> {
  const contentType =
    file.type === "image/png" ? ("image/png" as const) : ("image/jpeg" as const);
  const extension = contentType === "image/png" ? (".png" as const) : (".jpg" as const);
  const { width, height } = dimensions ?? (await readImageDimensions(file));

  let thumbBitmap: ImageBitmap | null = null;
  let compatBitmap: ImageBitmap | null = null;

  try {
    const thumbSource = await imageCompression(file, {
      maxWidthOrHeight: 800,
      useWebWorker: true,
      fileType: "image/jpeg",
      initialQuality: 0.75,
    });
    thumbBitmap = await createImageBitmap(thumbSource);
    const thumb = await canvasToJpeg(thumbBitmap, 800, 400, 0.7);

    let compat: Blob | null = null;
    if (width > COMPAT_WIDTH) {
      const compatSource = await imageCompression(file, {
        maxWidthOrHeight: COMPAT_WIDTH,
        useWebWorker: true,
        fileType: "image/jpeg",
        initialQuality: 0.85,
      });
      compatBitmap = await createImageBitmap(compatSource);
      compat = await canvasToJpeg(
        compatBitmap,
        COMPAT_WIDTH,
        COMPAT_HEIGHT,
        0.85,
      );
    }

    return {
      original: file,
      contentType,
      extension,
      width,
      height,
      fileSize: file.size,
      compat,
      thumb,
    };
  } catch {
    throw new Error(
      "This image is too large for your browser to process. Try a smaller file or another browser.",
    );
  } finally {
    thumbBitmap?.close();
    compatBitmap?.close();
  }
}
