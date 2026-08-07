/**
 * Embed chrome query params for /embed/[slug].
 * Malformed/unknown values are ignored (defaults apply).
 */

const SCENE_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type EmbedChromeOptions = {
  /** When false, MLS/unbranded mode — hides title, share, and brand marks. */
  branded: boolean;
  showTitle: boolean;
  showThumbs: boolean;
  showShare: boolean;
  showFullscreen: boolean;
  autorotate: boolean;
  startSceneId: string | null;
  /** When false, hide gyro control even if the tour enables it. */
  showGyro: boolean;
  /** When false, hide VR/stereo control even if the tour enables it. */
  showVr: boolean;
  /** When false, skip little-planet intro. */
  showIntro: boolean;
  /** When false, hide the group selector even if the tour has groups. */
  showGroups: boolean;
};

export const DEFAULT_EMBED_CHROME: EmbedChromeOptions = {
  branded: true,
  showTitle: true,
  showThumbs: true,
  showShare: true,
  showFullscreen: true,
  autorotate: false,
  startSceneId: null,
  showGyro: true,
  showVr: true,
  showIntro: true,
  showGroups: true,
};

function isOff(value: string | null | undefined): boolean {
  return value === "0";
}

function isOn(value: string | null | undefined): boolean {
  return value === "1";
}

type SearchParamsLike = {
  get(name: string): string | null;
};

/** Parse embed query string. Safe defaults; never throws. */
export function parseEmbedSearchParams(
  searchParams: SearchParamsLike,
): EmbedChromeOptions {
  const branded = !isOff(searchParams.get("branded"));
  const startRaw = searchParams.get("start");
  const startSceneId =
    typeof startRaw === "string" && SCENE_ID_RE.test(startRaw)
      ? startRaw
      : null;

  let showTitle = !isOff(searchParams.get("title"));
  let showShare = !isOff(searchParams.get("share"));

  if (!branded) {
    showTitle = false;
    showShare = false;
  }

  return {
    branded,
    showTitle,
    showThumbs: !isOff(searchParams.get("thumbs")),
    showShare,
    showFullscreen: !isOff(searchParams.get("fs")),
    autorotate: isOn(searchParams.get("autorotate")),
    startSceneId,
    showGyro: !isOff(searchParams.get("gyro")),
    showVr: !isOff(searchParams.get("vr")),
    showIntro: !isOff(searchParams.get("intro")),
    showGroups: !isOff(searchParams.get("groups")),
  };
}

export type EmbedSnippetOptions = {
  showTitle: boolean;
  showThumbs: boolean;
  showShare: boolean;
  showFullscreen: boolean;
  autorotate: boolean;
  startSceneId: string | null;
  /** Force MLS unbranded mode (branded=0). */
  unbranded?: boolean;
};

/** Build query string for embed URLs / data-params (no leading ?). */
export function buildEmbedQuery(options: EmbedSnippetOptions): string {
  const params = new URLSearchParams();

  if (options.unbranded) {
    params.set("branded", "0");
  } else {
    if (!options.showTitle) params.set("title", "0");
    if (!options.showShare) params.set("share", "0");
  }

  if (!options.showThumbs) params.set("thumbs", "0");
  if (!options.showFullscreen) params.set("fs", "0");
  if (options.autorotate) params.set("autorotate", "1");
  if (options.startSceneId && SCENE_ID_RE.test(options.startSceneId)) {
    params.set("start", options.startSceneId);
  }

  return params.toString();
}

export function buildEmbedUrl(
  origin: string,
  slug: string,
  options: EmbedSnippetOptions,
): string {
  const base = `${origin.replace(/\/$/, "")}/embed/${encodeURIComponent(slug)}`;
  const query = buildEmbedQuery(options);
  return query ? `${base}?${query}` : base;
}

export function buildPublicTourUrl(origin: string, slug: string): string {
  return `${origin.replace(/\/$/, "")}/tour/${encodeURIComponent(slug)}`;
}

export function buildFixedIframeSnippet(
  src: string,
  width: number,
  height: number,
): string {
  return `<iframe src="${src}" width="${width}" height="${height}" frameborder="0" allowfullscreen allow="fullscreen; accelerometer; gyroscope; magnetometer; xr-spatial-tracking"></iframe>`;
}

/** Responsive 16:9 wrapper with inline styles (no host CSS required). */
export function buildResponsiveIframeSnippet(src: string): string {
  return `<div style="position:relative;width:100%;height:0;padding-top:56.25%;overflow:hidden;">
  <iframe src="${src}" style="position:absolute;top:0;left:0;width:100%;height:100%;border:0;" frameborder="0" allowfullscreen allow="fullscreen; accelerometer; gyroscope; magnetometer; xr-spatial-tracking"></iframe>
</div>`;
}

export function buildJavaScriptSnippet(
  origin: string,
  slug: string,
  options: EmbedSnippetOptions,
): string {
  const params = buildEmbedQuery(options);
  const paramsAttr = params
    ? `\n  data-params="${params.replace(/"/g, "&quot;")}"`
    : "";
  return `<div data-swift-tour="${slug}"${paramsAttr}></div>
<script src="${origin.replace(/\/$/, "")}/embed.js" async></script>`;
}
