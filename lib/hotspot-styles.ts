/**
 * Hotspot shape registry — marker HTML builders + picker metadata.
 * Color and label text are always validated/escaped before injection.
 */

export const HOTSPOT_SHAPES = [
  "arrow",
  "chevron",
  "circle",
  "ring",
  "pin",
  "info",
  "plus",
  "pulse-dot",
  "label",
  "gallery",
  "video",
] as const;

export type HotspotShape = (typeof HOTSPOT_SHAPES)[number];

export const HOTSPOT_ANIMATIONS = ["none", "pulse", "bounce", "float"] as const;
export type HotspotAnimation = (typeof HOTSPOT_ANIMATIONS)[number];

export const LABEL_VISIBILITIES = ["hover", "always", "never"] as const;
export type LabelVisibility = (typeof LABEL_VISIBILITIES)[number];

export const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

export const PRESET_COLORS = [
  "#FFFFFF",
  "#111111",
  "#EF4444",
  "#F59E0B",
  "#22C55E",
  "#3B82F6",
  "#A855F7",
  "#EC4899",
] as const;

export const DEFAULT_LINK_SHAPE: HotspotShape = "arrow";
export const DEFAULT_INFO_SHAPE: HotspotShape = "info";
export const DEFAULT_GALLERY_SHAPE: HotspotShape = "gallery";
export const DEFAULT_VIDEO_SHAPE: HotspotShape = "video";
export const DEFAULT_COLOR = "#FFFFFF";
export const DEFAULT_SIZE = 48;
export const DEFAULT_ANIMATION: HotspotAnimation = "pulse";
export const DEFAULT_LABEL_VISIBILITY: LabelVisibility = "hover";

export type HotspotType = "link" | "info" | "gallery" | "video";

export function isHotspotType(value: string): value is HotspotType {
  return (
    value === "link" ||
    value === "info" ||
    value === "gallery" ||
    value === "video"
  );
}

/** Default marker shape for a newly created hotspot of this type. */
export function defaultShapeForHotspotType(type: HotspotType): HotspotShape {
  switch (type) {
    case "info":
      return DEFAULT_INFO_SHAPE;
    case "gallery":
      return DEFAULT_GALLERY_SHAPE;
    case "video":
      return DEFAULT_VIDEO_SHAPE;
    case "link":
    default:
      return DEFAULT_LINK_SHAPE;
  }
}

export function isHotspotShape(value: string): value is HotspotShape {
  return (HOTSPOT_SHAPES as readonly string[]).includes(value);
}

export function isHotspotAnimation(value: string): value is HotspotAnimation {
  return (HOTSPOT_ANIMATIONS as readonly string[]).includes(value);
}

export function isLabelVisibility(value: string): value is LabelVisibility {
  return (LABEL_VISIBILITIES as readonly string[]).includes(value);
}

/** Strict hex validation — reject anything that could break out of a CSS color. */
export function sanitizeHotspotColor(value: string | null | undefined): string {
  if (typeof value === "string" && HEX_COLOR_RE.test(value)) {
    return value;
  }
  return DEFAULT_COLOR;
}

export function clampHotspotSize(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_SIZE;
  return Math.min(128, Math.max(16, Math.round(value)));
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type MarkerStyleInput = {
  shape: string;
  color: string;
  size: number;
  animation: string;
  labelVisibility: string;
  /** Raw user label (will be escaped). */
  label?: string | null;
  /** Fallback when label shape has no label (escaped internally). */
  fallbackLabel?: string | null;
  selected?: boolean;
};

function resolveShape(shape: string): HotspotShape {
  return isHotspotShape(shape) ? shape : DEFAULT_LINK_SHAPE;
}

function resolveAnimation(animation: string): HotspotAnimation {
  return isHotspotAnimation(animation) ? animation : DEFAULT_ANIMATION;
}

function resolveLabelVisibility(value: string): LabelVisibility {
  return isLabelVisibility(value) ? value : DEFAULT_LABEL_VISIBILITY;
}

const FILTER_SHADOW =
  "drop-shadow(0 1px 2px rgba(0,0,0,0.65)) drop-shadow(0 0 1px rgba(0,0,0,0.4))";

function wrapMarker(
  size: number,
  animation: HotspotAnimation,
  selected: boolean,
  inner: string,
): string {
  const animClass =
    animation === "none" ? "" : ` st-hotspot-anim st-hotspot-anim--${animation}`;
  const selectedClass = selected ? " st-hotspot--selected" : "";
  return `<div class="st-hotspot${animClass}${selectedClass}" style="width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;cursor:pointer;user-select:none;filter:${FILTER_SHADOW};pointer-events:auto;">${inner}</div>`;
}

function svgShell(size: number, content: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 48 48" fill="none" aria-hidden="true">${content}</svg>`;
}

type ShapeBuilder = (args: {
  color: string;
  size: number;
  animation: HotspotAnimation;
  labelText: string;
  selected: boolean;
}) => string;

const builders: Record<HotspotShape, ShapeBuilder> = {
  arrow: ({ color, size, animation, selected }) =>
    wrapMarker(
      size,
      animation,
      selected,
      svgShell(
        size,
        `<path d="M24 6 L40 28 H30 V42 H18 V28 H8 Z" fill="${color}" stroke="rgba(0,0,0,0.35)" stroke-width="1.5" stroke-linejoin="round"/>`,
      ),
    ),

  chevron: ({ color, size, animation, selected }) =>
    wrapMarker(
      size,
      animation,
      selected,
      svgShell(
        size,
        `<path d="M14 10 L24 20 L34 10" stroke="${color}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
         <path d="M14 22 L24 32 L34 22" stroke="${color}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
      ),
    ),

  circle: ({ color, size, animation, selected }) =>
    wrapMarker(
      size,
      animation,
      selected,
      svgShell(
        size,
        `<circle cx="24" cy="24" r="14" fill="${color}" opacity="0.35"/>
         <circle cx="24" cy="24" r="10" fill="${color}" stroke="rgba(0,0,0,0.35)" stroke-width="1.5"/>`,
      ),
    ),

  ring: ({ color, size, animation, selected }) =>
    wrapMarker(
      size,
      animation,
      selected,
      svgShell(
        size,
        `<circle cx="24" cy="24" r="12" fill="none" stroke="${color}" stroke-width="4"/>
         <circle cx="24" cy="24" r="12" fill="none" stroke="rgba(0,0,0,0.3)" stroke-width="1"/>`,
      ),
    ),

  pin: ({ color, size, animation, selected }) =>
    wrapMarker(
      size,
      animation,
      selected,
      svgShell(
        size,
        `<path d="M24 4 C15 4 8 11.2 8 20.5 C8 31 24 44 24 44 C24 44 40 31 40 20.5 C40 11.2 33 4 24 4 Z" fill="${color}" stroke="rgba(0,0,0,0.35)" stroke-width="1.5"/>
         <circle cx="24" cy="20" r="6" fill="rgba(0,0,0,0.35)"/>`,
      ),
    ),

  info: ({ color, size, animation, selected }) =>
    wrapMarker(
      size,
      animation,
      selected,
      svgShell(
        size,
        `<circle cx="24" cy="24" r="16" fill="${color}" stroke="rgba(0,0,0,0.35)" stroke-width="1.5"/>
         <circle cx="24" cy="16" r="2.5" fill="#111111"/>
         <rect x="21.5" y="21" width="5" height="14" rx="2" fill="#111111"/>`,
      ),
    ),

  plus: ({ color, size, animation, selected }) =>
    wrapMarker(
      size,
      animation,
      selected,
      svgShell(
        size,
        `<circle cx="24" cy="24" r="16" fill="${color}" stroke="rgba(0,0,0,0.35)" stroke-width="1.5"/>
         <path d="M24 14 V34 M14 24 H34" stroke="#111111" stroke-width="4" stroke-linecap="round"/>`,
      ),
    ),

  "pulse-dot": ({ color, size, animation, selected }) =>
    wrapMarker(
      size,
      animation,
      selected,
      svgShell(
        size,
        `<circle class="st-hotspot-pulse-ring" cx="24" cy="24" r="14" fill="none" stroke="${color}" stroke-width="2" opacity="0.7"/>
         <circle cx="24" cy="24" r="6" fill="${color}" stroke="rgba(0,0,0,0.35)" stroke-width="1"/>`,
      ),
    ),

  gallery: ({ color, size, animation, selected }) =>
    wrapMarker(
      size,
      animation,
      selected,
      svgShell(
        size,
        `<rect x="10" y="14" width="28" height="22" rx="3" fill="${color}" stroke="rgba(0,0,0,0.35)" stroke-width="1.5"/>
         <rect x="14" y="10" width="24" height="18" rx="2" fill="${color}" opacity="0.55" stroke="rgba(0,0,0,0.25)" stroke-width="1"/>
         <circle cx="18" cy="20" r="2.5" fill="#111111"/>
         <path d="M12 32 L20 24 L25 28 L30 22 L36 32 Z" fill="#111111" opacity="0.85"/>`,
      ),
    ),

  video: ({ color, size, animation, selected }) =>
    wrapMarker(
      size,
      animation,
      selected,
      svgShell(
        size,
        `<circle cx="24" cy="24" r="16" fill="${color}" stroke="rgba(0,0,0,0.35)" stroke-width="1.5"/>
         <path d="M20 16 L34 24 L20 32 Z" fill="#111111"/>`,
      ),
    ),

  label: ({ color, size, animation, labelText, selected }) => {
    const safe = escapeHtml(labelText || "Hotspot");
    const fontSize = Math.max(10, Math.round(size * 0.28));
    const padX = Math.max(8, Math.round(size * 0.2));
    const padY = Math.max(4, Math.round(size * 0.12));
    const height = Math.max(22, Math.round(size * 0.55));
    // Width grows with text; marker size box uses style_size as height hint.
    return `<div class="st-hotspot${animation === "none" ? "" : ` st-hotspot-anim st-hotspot-anim--${animation}`}${selected ? " st-hotspot--selected" : ""}" style="display:inline-flex;align-items:center;justify-content:center;min-width:${size}px;height:${height}px;padding:${padY}px ${padX}px;border-radius:9999px;background:${color};color:#111111;font:600 ${fontSize}px/1.2 system-ui,sans-serif;white-space:nowrap;max-width:220px;overflow:hidden;text-overflow:ellipsis;cursor:pointer;user-select:none;filter:${FILTER_SHADOW};box-shadow:inset 0 0 0 1px rgba(0,0,0,0.2);">${safe}</div>`;
  },
};

/** Tiny static SVG for the shape picker grid (fixed 28×28). */
export const SHAPE_PREVIEW_SVG: Record<HotspotShape, string> = {
  arrow: `<svg viewBox="0 0 48 48" width="28" height="28" aria-hidden="true"><path d="M24 6 L40 28 H30 V42 H18 V28 H8 Z" fill="currentColor"/></svg>`,
  chevron: `<svg viewBox="0 0 48 48" width="28" height="28" aria-hidden="true"><path d="M14 10 L24 20 L34 10 M14 22 L24 32 L34 22" stroke="currentColor" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  circle: `<svg viewBox="0 0 48 48" width="28" height="28" aria-hidden="true"><circle cx="24" cy="24" r="12" fill="currentColor"/></svg>`,
  ring: `<svg viewBox="0 0 48 48" width="28" height="28" aria-hidden="true"><circle cx="24" cy="24" r="12" fill="none" stroke="currentColor" stroke-width="4"/></svg>`,
  pin: `<svg viewBox="0 0 48 48" width="28" height="28" aria-hidden="true"><path d="M24 4 C15 4 8 11 8 20 C8 30 24 44 24 44 S40 30 40 20 C40 11 33 4 24 4 Z" fill="currentColor"/></svg>`,
  info: `<svg viewBox="0 0 48 48" width="28" height="28" aria-hidden="true"><circle cx="24" cy="24" r="14" fill="currentColor"/><circle cx="24" cy="16" r="2.2" fill="#111"/><rect x="21.5" y="21" width="5" height="12" rx="2" fill="#111"/></svg>`,
  plus: `<svg viewBox="0 0 48 48" width="28" height="28" aria-hidden="true"><circle cx="24" cy="24" r="14" fill="currentColor"/><path d="M24 14 V34 M14 24 H34" stroke="#111" stroke-width="4" stroke-linecap="round"/></svg>`,
  "pulse-dot": `<svg viewBox="0 0 48 48" width="28" height="28" aria-hidden="true"><circle cx="24" cy="24" r="14" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="24" cy="24" r="6" fill="currentColor"/></svg>`,
  label: `<svg viewBox="0 0 48 48" width="28" height="28" aria-hidden="true"><rect x="6" y="16" width="36" height="16" rx="8" fill="currentColor"/></svg>`,
  gallery: `<svg viewBox="0 0 48 48" width="28" height="28" aria-hidden="true"><rect x="12" y="12" width="24" height="18" rx="2" fill="currentColor"/><path d="M14 28 L20 22 L24 26 L30 18 L36 28 Z" fill="#111" opacity="0.7"/></svg>`,
  video: `<svg viewBox="0 0 48 48" width="28" height="28" aria-hidden="true"><circle cx="24" cy="24" r="14" fill="currentColor"/><path d="M20 16 L34 24 L20 32 Z" fill="#111"/></svg>`,
};

export const SHAPE_DISPLAY_NAMES: Record<HotspotShape, string> = {
  arrow: "Arrow",
  chevron: "Chevron",
  circle: "Circle",
  ring: "Ring",
  pin: "Pin",
  info: "Info",
  plus: "Plus",
  "pulse-dot": "Pulse dot",
  label: "Label",
  gallery: "Gallery",
  video: "Video",
};

export function buildHotspotMarkerHtml(input: MarkerStyleInput): string {
  const shape = resolveShape(input.shape);
  const color = sanitizeHotspotColor(input.color);
  const size = clampHotspotSize(input.size);
  const animation = resolveAnimation(input.animation);
  const labelVisibility = resolveLabelVisibility(input.labelVisibility);

  const rawLabel = (input.label ?? "").trim();
  const rawFallback = (input.fallbackLabel ?? "").trim();
  const labelForShape =
    shape === "label"
      ? rawLabel || rawFallback || "Hotspot"
      : labelVisibility === "always"
        ? rawLabel || rawFallback
        : "";

  // Always-visible caption outside the shape (except the label shape, which is the caption).
  const alwaysCaption =
    shape !== "label" && labelVisibility === "always" && labelForShape
      ? `<span class="st-hotspot-caption" style="position:absolute;left:50%;top:100%;transform:translate(-50%,4px);white-space:nowrap;max-width:160px;overflow:hidden;text-overflow:ellipsis;font:600 11px/1.2 system-ui,sans-serif;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,0.85);pointer-events:none;">${escapeHtml(labelForShape)}</span>`
      : "";

  const core = builders[shape]({
    color,
    size,
    animation,
    labelText: labelForShape,
    selected: Boolean(input.selected),
  });

  if (!alwaysCaption) return core;

  return `<div style="position:relative;display:inline-flex;flex-direction:column;align-items:center;">${core}${alwaysCaption}</div>`;
}

export type HotspotStyleFields = {
  style_shape: HotspotShape;
  style_color: string;
  style_size: number;
  style_animation: HotspotAnimation;
  label_visibility: LabelVisibility;
};

export function normalizeStyleFields(input: {
  style_shape?: string | null;
  style_color?: string | null;
  style_size?: number | null;
  style_animation?: string | null;
  label_visibility?: string | null;
  type?: string;
}): HotspotStyleFields {
  const typed =
    input.type === "info" ||
    input.type === "gallery" ||
    input.type === "video" ||
    input.type === "link"
      ? input.type
      : undefined;
  const shape =
    typed && !input.style_shape
      ? defaultShapeForHotspotType(typed)
      : resolveShape(input.style_shape ?? DEFAULT_LINK_SHAPE);

  return {
    style_shape: shape,
    style_color: sanitizeHotspotColor(input.style_color),
    style_size: clampHotspotSize(input.style_size ?? DEFAULT_SIZE),
    style_animation: resolveAnimation(
      input.style_animation ?? DEFAULT_ANIMATION,
    ),
    label_visibility: resolveLabelVisibility(
      input.label_visibility ?? DEFAULT_LABEL_VISIBILITY,
    ),
  };
}

/** Server-side validation for style patches. Returns error message or null. */
export function validateStylePatch(patch: {
  style_shape?: string;
  style_color?: string;
  style_size?: number;
  style_animation?: string;
  label_visibility?: string;
}): string | null {
  if (patch.style_shape !== undefined && !isHotspotShape(patch.style_shape)) {
    return "Invalid hotspot shape.";
  }
  if (
    patch.style_color !== undefined &&
    !HEX_COLOR_RE.test(patch.style_color)
  ) {
    return "Color must be a hex value like #FFFFFF.";
  }
  if (patch.style_size !== undefined) {
    if (
      !Number.isFinite(patch.style_size) ||
      patch.style_size < 16 ||
      patch.style_size > 128
    ) {
      return "Size must be between 16 and 128.";
    }
  }
  if (
    patch.style_animation !== undefined &&
    !isHotspotAnimation(patch.style_animation)
  ) {
    return "Invalid animation.";
  }
  if (
    patch.label_visibility !== undefined &&
    !isLabelVisibility(patch.label_visibility)
  ) {
    return "Invalid label visibility.";
  }
  return null;
}
