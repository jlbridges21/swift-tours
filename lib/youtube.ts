/**
 * YouTube ID parsing and embed helpers.
 * Persist only the validated 11-char id — never interpolate raw user input into iframes.
 */

const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;

export type ParsedYouTube = {
  id: string;
  /** Start offset in seconds when present in the URL. */
  start: number | null;
};

export function isYouTubeId(value: string | null | undefined): value is string {
  return typeof value === "string" && YOUTUBE_ID_RE.test(value);
}

/**
 * Parse a YouTube URL or bare id → { id, start } or null.
 * Handles watch?v=, youtu.be/, shorts/, embed/, m.youtube.com, and bare ids.
 * Start time from ?t= / &t= / ?start= / &start= (seconds or 1h2m3s).
 */
export function parseYouTubeInput(input: string): ParsedYouTube | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (YOUTUBE_ID_RE.test(trimmed)) {
    return { id: trimmed, start: null };
  }

  let url: URL;
  try {
    const withProtocol = /^https?:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    url = new URL(withProtocol);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./i, "").toLowerCase();
  let id: string | null = null;

  if (host === "youtu.be") {
    id = url.pathname.split("/").filter(Boolean)[0] ?? null;
  } else if (
    host === "youtube.com" ||
    host === "m.youtube.com" ||
    host === "music.youtube.com" ||
    host === "youtube-nocookie.com"
  ) {
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] === "watch") {
      id = url.searchParams.get("v");
    } else if (
      parts[0] === "embed" ||
      parts[0] === "shorts" ||
      parts[0] === "live" ||
      parts[0] === "v"
    ) {
      id = parts[1] ?? null;
    } else if (url.searchParams.has("v")) {
      id = url.searchParams.get("v");
    }
  }

  if (!id || !YOUTUBE_ID_RE.test(id)) return null;

  const start =
    parseYouTubeTimeParam(url.searchParams.get("t")) ??
    parseYouTubeTimeParam(url.searchParams.get("start"));

  return { id, start };
}

/** @deprecated Prefer parseYouTubeInput — kept as a thin alias. */
export function parseYouTubeId(input: string): string | null {
  return parseYouTubeInput(input)?.id ?? null;
}

/**
 * Parse YouTube time params: "90", "90s", "1h2m3s".
 */
export function parseYouTubeTimeParam(
  value: string | null | undefined,
): number | null {
  if (value == null || value === "") return null;
  const raw = value.trim();
  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
  }

  const match = raw.match(
    /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i,
  );
  if (!match) return null;
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  const seconds = Number(match[3] ?? 0);
  if (!match[1] && !match[2] && !match[3]) return null;
  const total = hours * 3600 + minutes * 60 + seconds;
  return total >= 0 ? total : null;
}

/** Privacy-enhanced embed URL. Only call with a validated id. */
export function youtubeEmbedUrl(
  id: string,
  options?: { start?: number | null; autoplay?: boolean },
): string | null {
  if (!isYouTubeId(id)) return null;
  const params = new URLSearchParams();
  if (options?.autoplay) params.set("autoplay", "1");
  if (
    typeof options?.start === "number" &&
    Number.isFinite(options.start) &&
    options.start > 0
  ) {
    params.set("start", String(Math.floor(options.start)));
  }
  const qs = params.toString();
  return `https://www.youtube-nocookie.com/embed/${id}${qs ? `?${qs}` : ""}`;
}

export function youtubeThumbnailUrl(id: string): string | null {
  if (!isYouTubeId(id)) return null;
  return `https://img.youtube.com/vi/${id}/hqdefault.jpg`;
}
