/**
 * Client-side nadir (floor/tripod) patch generation.
 * Output is a circular feathered PNG — never baked into the panorama itself.
 *
 * Note: the nadir patch is a 3D `imageLayer` inside the PSV canvas, so scene
 * CSS adjustments (brightness/contrast/saturation) also tint this patch.
 * That keeps the blurred floor matching the panorama; a logo cap is adjusted
 * too. Acceptable — matching the floor matters more than an unfiltered logo.
 */

export const NADIR_MARKER_ID = "__nadir__";
export const DEFAULT_NADIR_LOGO_URL = "/nadir/default-logo.png";

export type NadirType = "none" | "blur" | "logo";
export type NadirLogoSource = "default" | "custom";

export const NADIR_TYPES: NadirType[] = ["none", "blur", "logo"];
export const NADIR_LOGO_SOURCES: NadirLogoSource[] = ["default", "custom"];

export function isNadirType(value: string): value is NadirType {
  return (NADIR_TYPES as string[]).includes(value);
}

export function isNadirLogoSource(value: string): value is NadirLogoSource {
  return (NADIR_LOGO_SOURCES as string[]).includes(value);
}

export function isNadirMarkerId(id: string | null | undefined): boolean {
  return id === NADIR_MARKER_ID;
}

const OUTPUT_SIZE = 1024;
const SAMPLE_BAND_RATIO = 0.14;
const SAMPLE_HEIGHT = 64;
const DEFAULT_FEATHER = 0.35;

/**
 * Load an image for canvas compositing.
 *
 * Only set crossOrigin for cross-origin http(s) URLs (Supabase Storage).
 * Same-origin `/public` assets must NOT use crossOrigin=anonymous — Next's
 * static handler often omits ACAO, so the load fails (or taints) and the
 * logo never draws. Blob URLs are same-document and need no CORS flag.
 */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (needsCrossOrigin(url)) {
      img.crossOrigin = "anonymous";
    }
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
    img.src = url;
  });
}

function needsCrossOrigin(url: string): boolean {
  if (url.startsWith("blob:") || url.startsWith("data:")) return false;
  if (url.startsWith("/")) return false;
  if (typeof window === "undefined") return true;
  try {
    const absolute = new URL(url, window.location.href);
    return absolute.origin !== window.location.origin;
  } catch {
    return true;
  }
}

/**
 * Map feather 0–1 → radial opaque-stop (fraction of radius).
 * 0.0 = hard edge; 0.35 ≈ legacy stops; 1.0 = fade starts near center.
 */
export function featherOpaqueStop(feather: number): number {
  const f = Math.min(1, Math.max(0, feather));
  if (f <= DEFAULT_FEATHER) {
    // 0 → 0.99, 0.35 → 0.42
    return 0.99 + (f / DEFAULT_FEATHER) * (0.42 - 0.99);
  }
  // 0.35 → 0.42, 1 → 0.08
  return 0.42 + ((f - DEFAULT_FEATHER) / (1 - DEFAULT_FEATHER)) * (0.08 - 0.42);
}

export type GenerateNadirOptions = {
  type: "blur" | "logo";
  logoSource?: NadirLogoSource;
  /** Storage path or absolute/relative URL when logoSource is 'custom'. */
  logoUrl?: string | null;
  /** 0 = hard edge, 1 = very soft. Default 0.35 matches the original mask. */
  feather?: number;
};

/**
 * Generate a circular nadir patch PNG (with alpha).
 * Prefer feeding a thumbnail URL — full-res panoramas are wasted once blurred.
 */
export async function generateNadirPatch(
  sampleImageUrl: string,
  options: GenerateNadirOptions,
): Promise<Blob> {
  const panorama = await loadImage(sampleImageUrl);

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
  const feather = options.feather ?? DEFAULT_FEATHER;
  const opaque = featherOpaqueStop(feather);
  const mid = opaque + (1 - opaque) * 0.55;
  ctx.globalCompositeOperation = "destination-in";
  const gradient = ctx.createRadialGradient(
    OUTPUT_SIZE / 2,
    OUTPUT_SIZE / 2,
    OUTPUT_SIZE * opaque,
    OUTPUT_SIZE / 2,
    OUTPUT_SIZE / 2,
    OUTPUT_SIZE / 2,
  );
  gradient.addColorStop(0, "rgba(0,0,0,1)");
  gradient.addColorStop(Math.min(0.999, mid), "rgba(0,0,0,1)");
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
  ctx.globalCompositeOperation = "source-over";

  if (options.type === "logo") {
    const source = options.logoSource ?? "default";
    const logoUrl =
      source === "custom" && options.logoUrl?.trim()
        ? options.logoUrl.trim()
        : DEFAULT_NADIR_LOGO_URL;
    const logo = await loadImage(logoUrl);
    const logoSize = Math.round(OUTPUT_SIZE * 0.6);
    const logoX = Math.round((OUTPUT_SIZE - logoSize) / 2);
    const logoY = Math.round((OUTPUT_SIZE - logoSize) / 2);
    const cx = OUTPUT_SIZE / 2;
    const cy = OUTPUT_SIZE / 2;

    // Soft contrasting disc + shadow so light logos stay visible on light floors.
    // (Default logo is dark; this still helps custom light artwork.)
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, logoSize * 0.52, 0, Math.PI * 2);
    ctx.closePath();
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.fill();
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = logoSize * 0.08;
    ctx.shadowOffsetY = logoSize * 0.02;
    ctx.drawImage(logo, logoX, logoY, logoSize, logoSize);
    ctx.restore();
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

/** Prefer thumbnail → compat → full for patch sampling (blur discards detail). */
export function nadirSamplePath(scene: {
  thumbnail_path?: string | null;
  compat_path?: string | null;
  storage_path: string;
}): string {
  if (scene.thumbnail_path) return scene.thumbnail_path;
  if (scene.compat_path) return scene.compat_path;
  return scene.storage_path;
}

/** Map 0.1–1.0 tour size → angular half-extent (radians) above the nadir. */
export function nadirAngularExtent(nadirSize: number): number {
  const clamped = Math.min(1, Math.max(0.1, nadirSize));
  // ~0.12 rad (~7°) at min → ~0.55 rad (~31°) at max — readable floor disc.
  return 0.1 + 0.45 * clamped;
}

/**
 * @deprecated Prefer four-corner placement. Kept so size math stays documented:
 * PSV scales imageLayer as width/100; with SPHERE_RADIUS=10, pixel sizes 650–2000
 * yield world scales 6.5–20 — already large enough. Size was never the bug.
 */
export function nadirLayerPixelSize(nadirSize: number): number {
  const clamped = Math.min(1, Math.max(0.1, nadirSize));
  return Math.round(500 + 1500 * clamped);
}

/**
 * Horizontal floor disc at the nadir via four corner positions.
 *
 * PSV 5 has no `orientation: 'horizontal'`. A single `position` at pitch=-π/2
 * places the group at (0,-R,0) then `lookAt(0,-R,0)` — degenerate — so the
 * plane is edge-on or invisible. Four equal-pitch corners form a horizontal
 * chord plane above the nadir without lookAt.
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
  position: [
    { yaw: number; pitch: number },
    { yaw: number; pitch: number },
    { yaw: number; pitch: number },
    { yaw: number; pitch: number },
  ];
  opacity: number;
  hideList: boolean;
  data: { nadir: true };
} {
  const elev = nadirAngularExtent(options.size);
  const spin = ((options.rotationDegrees % 360) * Math.PI) / 180;
  const pitch = -Math.PI / 2 + elev;

  // Clockwise from top-left (PSV imageLayer convention). Same pitch → horizontal.
  const corners: [
    { yaw: number; pitch: number },
    { yaw: number; pitch: number },
    { yaw: number; pitch: number },
    { yaw: number; pitch: number },
  ] = [
    { yaw: spin + 0, pitch },
    { yaw: spin + Math.PI / 2, pitch },
    { yaw: spin + Math.PI, pitch },
    { yaw: spin + (3 * Math.PI) / 2, pitch },
  ];

  return {
    id: NADIR_MARKER_ID,
    imageLayer: options.imageUrl,
    position: corners,
    opacity: Math.min(1, Math.max(0.1, options.opacity)),
    hideList: true,
    data: { nadir: true },
  };
}
