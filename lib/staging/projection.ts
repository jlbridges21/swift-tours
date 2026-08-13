/**
 * Equirectangular ↔ perspective projection for staging.
 *
 * SERVER / NODE ONLY — do not import from Client Components (pulls into the
 * browser bundle and is unnecessary there). Prefer importing via
 * `lib/staging/process-job.ts` or API routes.
 *
 * Convention (matches typical equirect JPEGs + Photo Sphere Viewer):
 *   - Pixel (0, 0) = lon −π, lat +π/2 (left edge, north pole)
 *   - Pixel (W/2, H/2) = lon 0, lat 0 (center, horizon)
 *   - Direction: x = cos(lat)*sin(lon), y = sin(lat), z = cos(lat)*cos(lon)
 *   - yaw / pitch are look angles in the same frame (yaw 0 → +Z).
 *
 * Horizontal wrap at ±π is handled by modulo sampling on longitude and by
 * iterating the full equirect when reprojecting (no lon-bbox that drops the seam).
 */
export type RgbaImage = {
  /** Tight RGBA bytes, length = width * height * 4. */
  data: Uint8ClampedArray;
  width: number;
  height: number;
};

export type CoverageMask = {
  /** 0–1 coverage per pixel, length = width * height. */
  data: Float32Array;
  width: number;
  height: number;
};

export type PerspectiveParams = {
  /** Look yaw in radians (0 = image center / +Z). */
  yaw: number;
  /** Look pitch in radians (+up, −down). */
  pitch: number;
  /** Vertical field of view in radians. */
  fov: number;
  width: number;
  height: number;
};

export type ReprojectParams = {
  yaw: number;
  pitch: number;
  fov: number;
  targetWidth: number;
  targetHeight: number;
};

export type NadirCropParams = {
  /** Full angular diameter of the crop around the nadir, in degrees. */
  fovDegrees: number;
  /** Output square size in pixels. Default 1024. */
  size?: number;
};

export type CompositeOptions = {
  /**
   * Max channel difference (0–255) treated as "unchanged".
   * Below this, the original pixel is kept. Default 3.
   */
  threshold?: number;
  /** Soft falloff width above threshold in 0–255. Default 6. */
  softRange?: number;
  /** Feather coverage edges by this many pixels. Default 4. */
  featherPx?: number;
};

type Vec3 = { x: number; y: number; z: number };

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/** Lon/lat → unit direction. */
function dirFromLonLat(lon: number, lat: number): Vec3 {
  const cl = Math.cos(lat);
  return {
    x: cl * Math.sin(lon),
    y: Math.sin(lat),
    z: cl * Math.cos(lon),
  };
}

/** Unit direction → lon ∈ (−π, π], lat ∈ [−π/2, π/2]. */
function lonLatFromDir(d: Vec3): { lon: number; lat: number } {
  const lat = Math.asin(clamp(d.y, -1, 1));
  const lon = Math.atan2(d.x, d.z);
  return { lon, lat };
}

/**
 * Camera basis for look yaw/pitch.
 * Handles near-pole look by swapping the reference up vector.
 */
function cameraBasis(yaw: number, pitch: number): {
  forward: Vec3;
  right: Vec3;
  up: Vec3;
} {
  const forward = normalize({
    x: Math.cos(pitch) * Math.sin(yaw),
    y: Math.sin(pitch),
    z: Math.cos(pitch) * Math.cos(yaw),
  });

  const worldUp =
    Math.abs(forward.y) > 0.99
      ? ({ x: 0, y: 0, z: forward.y > 0 ? -1 : 1 } as Vec3)
      : ({ x: 0, y: 1, z: 0 } as Vec3);

  const right = normalize(cross(worldUp, forward));
  const up = normalize(cross(forward, right));
  return { forward, right, up };
}

/**
 * Bilinear sample with horizontal wrap (critical at the 0°/360° seam).
 * Vertical is clamped — poles have no wrap.
 */
function sampleBilinear(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
): [number, number, number, number] {
  // Wrap X into [0, width).
  let sx = x % width;
  if (sx < 0) sx += width;
  const sy = clamp(y, 0, height - 1e-6);

  const x0 = Math.floor(sx) % width;
  const x1 = (x0 + 1) % width;
  const y0 = Math.floor(sy);
  const y1 = Math.min(y0 + 1, height - 1);
  const fx = sx - Math.floor(sx);
  const fy = sy - y0;

  const i00 = (y0 * width + x0) * 4;
  const i10 = (y0 * width + x1) * 4;
  const i01 = (y1 * width + x0) * 4;
  const i11 = (y1 * width + x1) * 4;

  const r =
    data[i00] * (1 - fx) * (1 - fy) +
    data[i10] * fx * (1 - fy) +
    data[i01] * (1 - fx) * fy +
    data[i11] * fx * fy;
  const g =
    data[i00 + 1] * (1 - fx) * (1 - fy) +
    data[i10 + 1] * fx * (1 - fy) +
    data[i01 + 1] * (1 - fx) * fy +
    data[i11 + 1] * fx * fy;
  const b =
    data[i00 + 2] * (1 - fx) * (1 - fy) +
    data[i10 + 2] * fx * (1 - fy) +
    data[i01 + 2] * (1 - fx) * fy +
    data[i11 + 2] * fx * fy;
  const a =
    data[i00 + 3] * (1 - fx) * (1 - fy) +
    data[i10 + 3] * fx * (1 - fy) +
    data[i01 + 3] * (1 - fx) * fy +
    data[i11 + 3] * fx * fy;

  return [r, g, b, a];
}

function lonLatToPixel(
  lon: number,
  lat: number,
  width: number,
  height: number,
): { x: number; y: number } {
  // Map lon from (−π, π] → [0, width).
  let u = (lon / (Math.PI * 2) + 0.5) * width;
  u = ((u % width) + width) % width;
  const v = (0.5 - lat / Math.PI) * height;
  return { x: u, y: v };
}

function pixelToLonLat(
  x: number,
  y: number,
  width: number,
  height: number,
): { lon: number; lat: number } {
  const lon = (x / width) * Math.PI * 2 - Math.PI;
  const lat = Math.PI / 2 - (y / height) * Math.PI;
  return { lon, lat };
}

/**
 * Extract a rectilinear (gnomonic) view — what the user sees looking that way.
 */
export function equirectToPerspective(
  equirect: RgbaImage,
  params: PerspectiveParams,
): RgbaImage {
  const { yaw, pitch, fov, width, height } = params;
  if (width < 1 || height < 1) {
    throw new Error("Perspective width/height must be >= 1.");
  }
  if (!(fov > 0 && fov < Math.PI)) {
    throw new Error("fov must be in (0, π) radians.");
  }

  const { forward, right, up } = cameraBasis(yaw, pitch);
  const tanHalf = Math.tan(fov / 2);
  const aspect = width / height;
  const out = new Uint8ClampedArray(width * height * 4);

  for (let j = 0; j < height; j++) {
    const ny = 1 - ((j + 0.5) / height) * 2;
    for (let i = 0; i < width; i++) {
      const nx = ((i + 0.5) / width) * 2 - 1;
      const dir = normalize({
        x: right.x * (nx * aspect * tanHalf) + up.x * (ny * tanHalf) + forward.x,
        y: right.y * (nx * aspect * tanHalf) + up.y * (ny * tanHalf) + forward.y,
        z: right.z * (nx * aspect * tanHalf) + up.z * (ny * tanHalf) + forward.z,
      });
      const { lon, lat } = lonLatFromDir(dir);
      const { x, y } = lonLatToPixel(lon, lat, equirect.width, equirect.height);
      const [r, g, b, a] = sampleBilinear(
        equirect.data,
        equirect.width,
        equirect.height,
        x,
        y,
      );
      const o = (j * width + i) * 4;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = a;
    }
  }

  return { data: out, width, height };
}

/**
 * Reproject a perspective image into equirectangular space.
 * Returns an equirect-sized RGBA buffer (transparent where uncovered) and a
 * float coverage mask. Seam-safe: every equirect pixel is tested in lon wrap
 * space via atan2; no lon-bbox culling that could drop the ±π discontinuity.
 */
export function perspectiveToEquirect(
  perspective: RgbaImage,
  params: ReprojectParams,
): { image: RgbaImage; mask: CoverageMask } {
  const { yaw, pitch, fov, targetWidth, targetHeight } = params;
  if (targetWidth < 1 || targetHeight < 1) {
    throw new Error("targetWidth/Height must be >= 1.");
  }
  if (!(fov > 0 && fov < Math.PI)) {
    throw new Error("fov must be in (0, π) radians.");
  }

  const { forward, right, up } = cameraBasis(yaw, pitch);
  const tanHalf = Math.tan(fov / 2);
  const aspect = perspective.width / perspective.height;

  const imageData = new Uint8ClampedArray(targetWidth * targetHeight * 4);
  const maskData = new Float32Array(targetWidth * targetHeight);

  for (let j = 0; j < targetHeight; j++) {
    for (let i = 0; i < targetWidth; i++) {
      const { lon, lat } = pixelToLonLat(
        i + 0.5,
        j + 0.5,
        targetWidth,
        targetHeight,
      );
      const dir = dirFromLonLat(lon, lat);

      const lz = dot(dir, forward);
      if (lz <= 1e-6) continue;

      const lx = dot(dir, right);
      const ly = dot(dir, up);
      const nx = lx / (lz * aspect * tanHalf);
      const ny = ly / (lz * tanHalf);
      if (nx < -1 || nx > 1 || ny < -1 || ny > 1) continue;

      const u = ((nx + 1) / 2) * perspective.width - 0.5;
      const v = ((1 - ny) / 2) * perspective.height - 0.5;
      if (u < -0.5 || v < -0.5 || u > perspective.width - 0.5 || v > perspective.height - 0.5) {
        continue;
      }

      const [r, g, b, a] = sampleBilinear(
        perspective.data,
        perspective.width,
        perspective.height,
        clamp(u, 0, perspective.width - 1e-6),
        clamp(v, 0, perspective.height - 1e-6),
      );

      // Soften coverage near the frustum edge to ease later feathering.
      const edge = Math.min(1 - Math.abs(nx), 1 - Math.abs(ny));
      const coverage = smoothstep(0, 0.08, edge);

      const idx = j * targetWidth + i;
      const o = idx * 4;
      imageData[o] = r;
      imageData[o + 1] = g;
      imageData[o + 2] = b;
      imageData[o + 3] = a * coverage;
      maskData[idx] = coverage;
    }
  }

  return {
    image: { data: imageData, width: targetWidth, height: targetHeight },
    mask: { data: maskData, width: targetWidth, height: targetHeight },
  };
}

/**
 * Stereographic crop of the nadir (floor beneath the camera).
 * Different from lib/nadir.ts band sampling — this is a proper spherical
 * stereographic projection from the south pole.
 */
export function nadirCrop(
  equirect: RgbaImage,
  params: NadirCropParams,
): RgbaImage {
  const size = params.size ?? 1024;
  const halfFov = ((params.fovDegrees * Math.PI) / 180) / 2;
  if (!(halfFov > 0 && halfFov < Math.PI)) {
    throw new Error("fovDegrees must yield a half-angle in (0, π).");
  }

  const out = new Uint8ClampedArray(size * size * 4);
  const cx = (size - 1) / 2;
  const radius = size / 2;
  // Stereographic: ρ = tan(θ/2) / tan(halfFov/2), θ = angle from nadir.
  const tanHalfHalf = Math.tan(halfFov / 2) || 1e-6;

  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const dx = (i - cx) / radius;
      const dy = (j - cx) / radius;
      const rho = Math.hypot(dx, dy);
      const o = (j * size + i) * 4;
      if (rho > 1) {
        out[o + 3] = 0;
        continue;
      }
      // θ from nadir; azimuth around vertical.
      const theta = 2 * Math.atan(rho * tanHalfHalf);
      const az = Math.atan2(dx, -dy); // 0 = "up" in image → −Z in world when looking down

      // From nadir (−Y), tilt by theta toward azimuth in the XZ plane.
      // At theta=0: (0,-1,0). At horizon-ish: leans into XZ.
      const dir = normalize({
        x: Math.sin(theta) * Math.sin(az),
        y: -Math.cos(theta),
        z: Math.sin(theta) * Math.cos(az),
      });
      const { lon, lat } = lonLatFromDir(dir);
      const { x, y } = lonLatToPixel(lon, lat, equirect.width, equirect.height);
      const [r, g, b, a] = sampleBilinear(
        equirect.data,
        equirect.width,
        equirect.height,
        x,
        y,
      );
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = a;
    }
  }

  return { data: out, width: size, height: size };
}

/**
 * Inverse of {@link nadirCrop}: reproject a stereographic nadir square into
 * equirectangular space with a coverage mask.
 */
export function nadirCropToEquirect(
  crop: RgbaImage,
  params: NadirCropParams & { targetWidth: number; targetHeight: number },
): { image: RgbaImage; mask: CoverageMask } {
  const { targetWidth, targetHeight } = params;
  const size = crop.width;
  if (crop.height !== size) {
    throw new Error("nadirCropToEquirect expects a square crop.");
  }
  const halfFov = ((params.fovDegrees * Math.PI) / 180) / 2;
  if (!(halfFov > 0 && halfFov < Math.PI)) {
    throw new Error("fovDegrees must yield a half-angle in (0, π).");
  }

  const cx = (size - 1) / 2;
  const radius = size / 2;
  const tanHalfHalf = Math.tan(halfFov / 2) || 1e-6;

  const imageData = new Uint8ClampedArray(targetWidth * targetHeight * 4);
  const maskData = new Float32Array(targetWidth * targetHeight);

  for (let j = 0; j < targetHeight; j++) {
    for (let i = 0; i < targetWidth; i++) {
      const { lon, lat } = pixelToLonLat(
        i + 0.5,
        j + 0.5,
        targetWidth,
        targetHeight,
      );
      const dir = dirFromLonLat(lon, lat);

      // Angle from nadir (−Y).
      const theta = Math.atan2(Math.hypot(dir.x, dir.z), -dir.y);
      if (theta > halfFov + 1e-4) continue;

      const az = Math.atan2(dir.x, dir.z);
      const rho = Math.tan(theta / 2) / tanHalfHalf;
      if (rho > 1 + 1e-4) continue;

      const dx = rho * Math.sin(az);
      const dy = -rho * Math.cos(az);
      const u = dx * radius + cx;
      const v = dy * radius + cx;
      if (u < -0.5 || v < -0.5 || u > size - 0.5 || v > size - 0.5) continue;

      const [r, g, b, a] = sampleBilinear(
        crop.data,
        size,
        size,
        clamp(u, 0, size - 1e-6),
        clamp(v, 0, size - 1e-6),
      );

      const edge = 1 - Math.min(1, rho);
      const coverage = smoothstep(0, 0.08, edge);

      const idx = j * targetWidth + i;
      const o = idx * 4;
      imageData[o] = r;
      imageData[o + 1] = g;
      imageData[o + 2] = b;
      imageData[o + 3] = a * coverage;
      maskData[idx] = coverage;
    }
  }

  return {
    image: { data: imageData, width: targetWidth, height: targetHeight },
    mask: { data: maskData, width: targetWidth, height: targetHeight },
  };
}

/**
 * Centred circular mask for nadir tripod fill (white = regenerate).
 * @param radiusRatio Fraction of half-width (default 0.45 ≈ inner 45%).
 * @param featherPx Soft edge in pixels.
 */
export function makeCenteredCircleMask(
  size: number,
  radiusRatio = 0.45,
  featherPx = 12,
): RgbaImage {
  const data = new Uint8ClampedArray(size * size * 4);
  const cx = (size - 1) / 2;
  const radius = Math.max(1, radiusRatio * (size / 2));
  const feather = Math.max(1, featherPx);

  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const d = Math.hypot(i - cx, j - cx);
      let t = 0;
      if (d <= radius - feather) t = 1;
      else if (d < radius + feather) {
        t = 1 - smoothstep(radius - feather, radius + feather, d);
      }
      const v = Math.round(255 * t);
      const o = (j * size + i) * 4;
      data[o] = v;
      data[o + 1] = v;
      data[o + 2] = v;
      data[o + 3] = 255;
    }
  }

  return { data, width: size, height: size };
}

function boxBlurFloat(
  src: Float32Array,
  width: number,
  height: number,
  radius: number,
): Float32Array {
  if (radius <= 0) return src.slice();
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const r = Math.ceil(radius);

  // Horizontal (wrap X for seam continuity of the feather).
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let n = 0;
      for (let k = -r; k <= r; k++) {
        let xx = (x + k) % width;
        if (xx < 0) xx += width;
        sum += src[y * width + xx];
        n += 1;
      }
      tmp[y * width + x] = sum / n;
    }
  }

  // Vertical (clamp Y).
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let n = 0;
      for (let k = -r; k <= r; k++) {
        const yy = clamp(y + k, 0, height - 1);
        sum += tmp[yy * width + x];
        n += 1;
      }
      out[y * width + x] = sum / n;
    }
  }

  return out;
}

/**
 * Composite ONLY pixels that actually changed within the covered region onto
 * a working base image. Architecture outside the edit keeps native resolution.
 *
 * `original` is the pristine reference used for the change detection diff.
 * Pass `options.base` to composite onto an in-progress working buffer (multi-view);
 * otherwise the result starts from a copy of `original`.
 */
export function compositeChangedPixels(
  original: RgbaImage,
  edited: RgbaImage,
  coverageMask: CoverageMask,
  options: CompositeOptions & { base?: RgbaImage } = {},
): RgbaImage {
  const base = options.base ?? original;
  if (
    original.width !== edited.width ||
    original.height !== edited.height ||
    original.width !== coverageMask.width ||
    original.height !== coverageMask.height ||
    base.width !== original.width ||
    base.height !== original.height
  ) {
    throw new Error("compositeChangedPixels: dimension mismatch.");
  }

  const threshold = options.threshold ?? 3;
  const softRange = options.softRange ?? 6;
  const featherPx = options.featherPx ?? 4;

  const feathered =
    featherPx > 0
      ? boxBlurFloat(
          coverageMask.data,
          coverageMask.width,
          coverageMask.height,
          featherPx,
        )
      : coverageMask.data;

  const { width, height } = original;
  const out = new Uint8ClampedArray(base.data);

  for (let i = 0; i < width * height; i++) {
    const cov = feathered[i];
    if (cov < 1e-4) continue;

    const o = i * 4;
    // Diff against pristine original — not the working base — so no-op
    // reprojection noise does not compound across overlapping views.
    const dr = Math.abs(edited.data[o] - original.data[o]);
    const dg = Math.abs(edited.data[o + 1] - original.data[o + 1]);
    const db = Math.abs(edited.data[o + 2] - original.data[o + 2]);
    const diff = Math.max(dr, dg, db);

    const change = smoothstep(threshold, threshold + softRange, diff);
    const alpha = clamp(change * cov, 0, 1);
    if (alpha < 1e-4) continue;

    out[o] = out[o] * (1 - alpha) + edited.data[o] * alpha;
    out[o + 1] = out[o + 1] * (1 - alpha) + edited.data[o + 1] * alpha;
    out[o + 2] = out[o + 2] * (1 - alpha) + edited.data[o + 2] * alpha;
    out[o + 3] = 255;
  }

  return { data: out, width, height };
}

/**
 * Overwrite covered pixels with the reprojected view (for round-trip fidelity
 * measurement). Not used for production AI composite.
 */
export function replaceCoveredPixels(
  base: RgbaImage,
  patch: RgbaImage,
  mask: CoverageMask,
): RgbaImage {
  if (
    base.width !== patch.width ||
    base.height !== patch.height ||
    base.width !== mask.width
  ) {
    throw new Error("replaceCoveredPixels: dimension mismatch.");
  }
  const out = new Uint8ClampedArray(base.data);
  const { width, height } = base;
  for (let i = 0; i < width * height; i++) {
    const cov = mask.data[i];
    if (cov < 1e-4) continue;
    const o = i * 4;
    out[o] = base.data[o] * (1 - cov) + patch.data[o] * cov;
    out[o + 1] = base.data[o + 1] * (1 - cov) + patch.data[o + 1] * cov;
    out[o + 2] = base.data[o + 2] * (1 - cov) + patch.data[o + 2] * cov;
    out[o + 3] = 255;
  }
  return { data: out, width, height };
}

export type DiffStats = {
  comparedPixels: number;
  meanAbsError: number;
  maxAbsError: number;
  rmse: number;
  /** Fraction of compared pixels with max-channel delta > threshold. */
  pctAbove1: number;
  pctAbove3: number;
  pctAbove8: number;
};

export function diffStats(
  a: RgbaImage,
  b: RgbaImage,
  mask?: CoverageMask,
): DiffStats {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error("diffStats: dimension mismatch.");
  }
  let compared = 0;
  let sum = 0;
  let sumSq = 0;
  let max = 0;
  let above1 = 0;
  let above3 = 0;
  let above8 = 0;

  const n = a.width * a.height;
  for (let i = 0; i < n; i++) {
    if (mask && mask.data[i] < 0.5) continue;
    compared += 1;
    const o = i * 4;
    const dr = Math.abs(a.data[o] - b.data[o]);
    const dg = Math.abs(a.data[o + 1] - b.data[o + 1]);
    const db = Math.abs(a.data[o + 2] - b.data[o + 2]);
    const d = Math.max(dr, dg, db);
    sum += d;
    sumSq += d * d;
    if (d > max) max = d;
    if (d > 1) above1 += 1;
    if (d > 3) above3 += 1;
    if (d > 8) above8 += 1;
  }

  return {
    comparedPixels: compared,
    meanAbsError: compared ? sum / compared : 0,
    maxAbsError: max,
    rmse: compared ? Math.sqrt(sumSq / compared) : 0,
    pctAbove1: compared ? (100 * above1) / compared : 0,
    pctAbove3: compared ? (100 * above3) / compared : 0,
    pctAbove8: compared ? (100 * above8) / compared : 0,
  };
}

/** Default sphere coverage for round-trip tests (overlapping 90° V-FOV views). */
export function defaultSphereViews(): Array<{
  yaw: number;
  pitch: number;
  fov: number;
}> {
  const fov = Math.PI / 2;
  const views: Array<{ yaw: number; pitch: number; fov: number }> = [];
  for (let i = 0; i < 6; i++) {
    views.push({ yaw: (i * Math.PI) / 3, pitch: 0, fov });
  }
  views.push({ yaw: 0, pitch: Math.PI / 3, fov });
  views.push({ yaw: Math.PI, pitch: Math.PI / 3, fov });
  views.push({ yaw: Math.PI / 2, pitch: Math.PI / 3, fov });
  views.push({ yaw: -Math.PI / 2, pitch: Math.PI / 3, fov });
  views.push({ yaw: 0, pitch: -Math.PI / 3, fov });
  views.push({ yaw: Math.PI, pitch: -Math.PI / 3, fov });
  views.push({ yaw: 0, pitch: Math.PI / 2 - 0.05, fov });
  views.push({ yaw: 0, pitch: -Math.PI / 2 + 0.05, fov });
  // Explicit seam-centered view (yaw ≈ ±π) to stress wraparound.
  views.push({ yaw: Math.PI, pitch: 0, fov });
  views.push({ yaw: -Math.PI + 0.15, pitch: 0, fov });
  return views;
}

export type RoundTripResult = {
  /** Reprojected-replace composite (measures projection fidelity). */
  replaced: RgbaImage;
  /** Change-only composite (should ≈ original on a no-op). */
  changedOnly: RgbaImage;
  replaceStats: DiffStats;
  changedOnlyStats: DiffStats;
  /** Stats restricted to pixels within ~15° of the ±π seam. */
  seamReplaceStats: DiffStats;
  viewCount: number;
};

function seamBandMask(width: number, height: number): CoverageMask {
  const data = new Float32Array(width * height);
  const band = Math.max(8, Math.round(width * 0.02)); // ~7° at full width
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dist = Math.min(x, width - x);
      data[y * width + x] = dist < band ? 1 : 0;
    }
  }
  return { data, width, height };
}

/**
 * No-op round trip: extract N views, reproject, composite. No AI.
 *
 * Memory strategy for full Theta resolution (e.g. 5376×2688):
 * - Float32 weighted accumulators (not Float64) — halves ~230MB vs ~460MB
 * - Process views sequentially and drop each perspective/equirect patch
 * - Mutate a single changedOnly buffer via compositeChangedPixels `base`
 * This keeps peak well under Vercel’s 2GB ceiling without downscaling the
 * working copy; compositing stays on the full-resolution original.
 */
export function roundTripNoEdit(
  original: RgbaImage,
  options?: {
    views?: Array<{ yaw: number; pitch: number; fov: number }>;
    perspectiveSize?: number;
  },
): RoundTripResult {
  const views = options?.views ?? defaultSphereViews();
  const perspectiveSize = options?.perspectiveSize ?? 512;
  const { width, height } = original;
  const n = width * height;

  // Weighted accumulation for replace-path fidelity (avoids compounding blends).
  const accR = new Float32Array(n);
  const accG = new Float32Array(n);
  const accB = new Float32Array(n);
  const accW = new Float32Array(n);

  let changedOnly: RgbaImage = {
    data: new Uint8ClampedArray(original.data),
    width,
    height,
  };

  for (const view of views) {
    const persp = equirectToPerspective(original, {
      ...view,
      width: perspectiveSize,
      height: perspectiveSize,
    });
    const { image: patch, mask } = perspectiveToEquirect(persp, {
      yaw: view.yaw,
      pitch: view.pitch,
      fov: view.fov,
      targetWidth: width,
      targetHeight: height,
    });

    for (let i = 0; i < n; i++) {
      const w = mask.data[i];
      if (w < 1e-6) continue;
      const o = i * 4;
      accR[i] += patch.data[o] * w;
      accG[i] += patch.data[o + 1] * w;
      accB[i] += patch.data[o + 2] * w;
      accW[i] += w;
    }

    changedOnly = compositeChangedPixels(original, patch, mask, {
      base: changedOnly,
      threshold: 4,
      softRange: 8,
      featherPx: 3,
    });
    // Help GC release full-res equirect patch/mask before the next view.
    // (perspective buffer is small; the equirect patch is ~W*H*4.)
  }

  const replacedData = new Uint8ClampedArray(original.data);
  const unionMask = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const w = accW[i];
    if (w < 1e-6) continue;
    const o = i * 4;
    replacedData[o] = accR[i] / w;
    replacedData[o + 1] = accG[i] / w;
    replacedData[o + 2] = accB[i] / w;
    replacedData[o + 3] = 255;
    unionMask[i] = 1;
  }

  // Drop accumulators before allocating seam/diff work.
  accR.fill(0);
  accG.fill(0);
  accB.fill(0);
  accW.fill(0);

  const replaced: RgbaImage = { data: replacedData, width, height };
  const covered: CoverageMask = { data: unionMask, width, height };
  const seam = seamBandMask(width, height);
  const seamCovered = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    seamCovered[i] = unionMask[i] > 0 && seam.data[i] > 0 ? 1 : 0;
  }

  return {
    replaced,
    changedOnly,
    replaceStats: diffStats(original, replaced, covered),
    changedOnlyStats: diffStats(original, changedOnly),
    seamReplaceStats: diffStats(original, replaced, {
      data: seamCovered,
      width,
      height,
    }),
    viewCount: views.length,
  };
}
