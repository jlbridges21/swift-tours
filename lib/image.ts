"use client";

import imageCompression from "browser-image-compression";

const MAX_BYTES = 100 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png"]);
const ASPECT_TOLERANCE = 0.03;

export type ValidatePanoramaResult = {
  ok: boolean;
  error?: string;
  warning?: string;
};

export async function validatePanorama(
  file: File,
): Promise<ValidatePanoramaResult> {
  if (!ALLOWED_TYPES.has(file.type)) {
    return { ok: false, error: "Only JPEG and PNG images are supported." };
  }

  if (file.size > MAX_BYTES) {
    return { ok: false, error: "File must be under 100MB." };
  }

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
    const ratio = bitmap.width / bitmap.height;
    const drift = Math.abs(ratio - 2) / 2;
    if (drift > ASPECT_TOLERANCE) {
      return {
        ok: true,
        warning:
          "This image isn’t close to a 2:1 aspect ratio, so it may not be a true 360° panorama.",
      };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not read this image." };
  } finally {
    bitmap?.close();
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

  // Force exact dimensions — equirectangular must stay 2:1 for correct sphere mapping.
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
 * Resize to exact 4096×2048 (GL_MAX_TEXTURE_SIZE / 2:1 equirectangular) and an
 * 800×400 thumbnail. Uses browser-image-compression in a web worker for the
 * heavy decode/resize pass so large files don't freeze the UI thread, then
 * draws to canvases at exact target dimensions.
 */
export async function processPanorama(
  file: File,
): Promise<{ full: Blob; thumb: Blob }> {
  let bitmap: ImageBitmap | null = null;

  try {
    const compressed = await imageCompression(file, {
      maxWidthOrHeight: 4096,
      useWebWorker: true,
      fileType: "image/jpeg",
      initialQuality: 0.85,
    });

    bitmap = await createImageBitmap(compressed);

    const full = await canvasToJpeg(bitmap, 4096, 2048, 0.82);
    const thumb = await canvasToJpeg(bitmap, 800, 400, 0.7);
    return { full, thumb };
  } catch {
    throw new Error(
      "This image is too large for your browser to process. Try a smaller file or another browser.",
    );
  } finally {
    bitmap?.close();
  }
}
