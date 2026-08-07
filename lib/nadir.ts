/**
 * Client-side nadir (floor/tripod) patch generation.
 * Output is a circular feathered PNG — never baked into the panorama itself.
 */

export const NADIR_MARKER_ID = "__nadir__";
export const DEFAULT_NADIR_LOGO_URL = "/nadir/default-logo.png";

export type NadirType = "none" | "blur" | "logo";

export const NADIR_TYPES: NadirType[] = ["none", "blur", "logo"];

export function isNadirType(value: string): value is NadirType {
  return (NADIR_TYPES as string[]).includes(value);
}

export function isNadirMarkerId(id: string | null | undefined): boolean {
  return id === NADIR_MARKER_ID;
}

const OUTPUT_SIZE = 1024;
const SAMPLE_BAND_RATIO = 0.14;
const SAMPLE_HEIGHT = 64;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // Required before src — otherwise the canvas is tainted and toBlob throws.
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
    img.src = url;
  });
}

/**
 * Generate a circular nadir patch PNG (with alpha).
 * Blur base is sampled from the panorama's bottom band; logo composites on top.
 */
export async function generateNadirPatch(
  panoramaUrl: string,
  options: {
    type: "blur" | "logo";
    logoUrl?: string | null;
  },
): Promise<Blob> {
  const panorama = await loadImage(panoramaUrl);

  const bandHeight = Math.max(
    1,
    Math.round(panorama.naturalHeight * SAMPLE_BAND_RATIO),
  );
  const bandY = panorama.naturalHeight - bandHeight;

  // Downscale the bottom band aggressively — destroys detail → soft blur.
  const sample = document.createElement("canvas");
  sample.width = Math.max(64, Math.round(panorama.naturalWidth / 16));
  sample.height = SAMPLE_HEIGHT;
  const sampleCtx = sample.getContext("2d");
  if (!sampleCtx) throw new Error("Could not create canvas context.");
  sampleCtx.imageSmoothingEnabled = true;
  sampleCtx.imageSmoothingQuality = "high";
  sampleCtx.drawImage(
    panorama,
    0,
    bandY,
    panorama.naturalWidth,
    bandHeight,
    0,
    0,
    sample.width,
    sample.height,
  );

  const out = document.createElement("canvas");
  out.width = OUTPUT_SIZE;
  out.height = OUTPUT_SIZE;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("Could not create canvas context.");

  // Circular disc filled with the sampled (blurred) floor color.
  ctx.save();
  ctx.beginPath();
  ctx.arc(OUTPUT_SIZE / 2, OUTPUT_SIZE / 2, OUTPUT_SIZE / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(sample, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
  ctx.restore();

  // Feather outer edge with a radial alpha mask.
  ctx.globalCompositeOperation = "destination-in";
  const gradient = ctx.createRadialGradient(
    OUTPUT_SIZE / 2,
    OUTPUT_SIZE / 2,
    OUTPUT_SIZE * 0.42,
    OUTPUT_SIZE / 2,
    OUTPUT_SIZE / 2,
    OUTPUT_SIZE / 2,
  );
  gradient.addColorStop(0, "rgba(0,0,0,1)");
  gradient.addColorStop(0.72, "rgba(0,0,0,1)");
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
  ctx.globalCompositeOperation = "source-over";

  if (options.type === "logo") {
    const logoUrl = options.logoUrl?.trim() || DEFAULT_NADIR_LOGO_URL;
    const logo = await loadImage(logoUrl);
    const logoSize = Math.round(OUTPUT_SIZE * 0.6);
    const logoX = Math.round((OUTPUT_SIZE - logoSize) / 2);
    const logoY = Math.round((OUTPUT_SIZE - logoSize) / 2);
    ctx.drawImage(logo, logoX, logoY, logoSize, logoSize);
  }

  const blob = await new Promise<Blob>((resolve, reject) => {
    out.toBlob(
      (result) => {
        if (result) resolve(result);
        else reject(new Error("Failed to encode nadir PNG."));
      },
      "image/png",
    );
  });

  sample.width = 0;
  sample.height = 0;
  out.width = 0;
  out.height = 0;

  return blob;
}

/** Map 0.1–1.0 tour size into imageLayer pixel size (PSV scales by /100). */
export function nadirLayerPixelSize(nadirSize: number): number {
  const clamped = Math.min(1, Math.max(0.1, nadirSize));
  return Math.round(500 + 1500 * clamped);
}

/**
 * Flat floor layer at the nadir. Uses MarkersPlugin `imageLayer` (not `image`)
 * with pitch rotation so the plane lies on the floor instead of facing the camera.
 */
export function buildNadirMarkerConfig(options: {
  imageUrl: string;
  size: number;
  opacity: number;
  /** Degrees 0–360, spin around the floor normal. */
  rotationDegrees: number;
}): {
  id: string;
  imageLayer: string;
  position: { yaw: number; pitch: number };
  size: { width: number; height: number };
  opacity: number;
  rotation: { pitch: number; yaw: number };
  hideList: boolean;
  data: { nadir: true };
} {
  const px = nadirLayerPixelSize(options.size);
  const yawRad = ((options.rotationDegrees % 360) * Math.PI) / 180;
  return {
    id: NADIR_MARKER_ID,
    imageLayer: options.imageUrl,
    position: { yaw: 0, pitch: -Math.PI / 2 },
    size: { width: px, height: px },
    opacity: Math.min(1, Math.max(0.1, options.opacity)),
    // pitch π/2 lays the plane flat; yaw spins the logo on the floor.
    rotation: { pitch: Math.PI / 2, yaw: yawRad },
    hideList: true,
    data: { nadir: true },
  };
}

