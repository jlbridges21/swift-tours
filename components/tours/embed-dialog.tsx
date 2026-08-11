"use client";

import { CheckIcon, CopyIcon, ExternalLinkIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { setTourPublic, listOwnedTourScenes } from "@/app/dashboard/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  buildEmbedUrl,
  buildFixedIframeSnippet,
  buildJavaScriptSnippet,
  buildPublicTourUrl,
  buildResponsiveIframeSnippet,
  isValidSceneIdParam,
} from "@/lib/embed-options";
import { clientSiteOrigin } from "@/lib/site-url";
import { cn } from "@/lib/utils";

export type EmbedDialogScene = {
  id: string;
  name: string;
};

export type EmbedDialogTour = {
  id: string;
  slug: string;
  title: string;
  is_public: boolean;
};

type EmbedDialogProps = {
  tour: EmbedDialogTour;
  /** Optional — loaded on open when omitted (dashboard card). */
  scenes?: EmbedDialogScene[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type TabId = "link" | "iframe" | "javascript" | "unbranded";

type EmbedOptionState = {
  width: number;
  height: number;
  responsive: boolean;
  showTitle: boolean;
  showThumbs: boolean;
  showShare: boolean;
  showFullscreen: boolean;
  autorotate: boolean;
  startSceneId: string;
};

const DEFAULT_OPTIONS: EmbedOptionState = {
  width: 800,
  height: 450,
  responsive: true,
  showTitle: true,
  showThumbs: true,
  showShare: true,
  showFullscreen: true,
  autorotate: false,
  startSceneId: "",
};

const TABS: { id: TabId; label: string }[] = [
  { id: "link", label: "Link" },
  { id: "iframe", label: "iframe" },
  { id: "javascript", label: "JavaScript" },
  { id: "unbranded", label: "Unbranded" },
];

function embedOptionsStorageKey(tourId: string): string {
  return `swift-tours:embed-options:${tourId}`;
}

function readStoredOptions(tourId: string): EmbedOptionState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(embedOptionsStorageKey(tourId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<EmbedOptionState>;
    return {
      width:
        typeof parsed.width === "number" && parsed.width > 0
          ? parsed.width
          : DEFAULT_OPTIONS.width,
      height:
        typeof parsed.height === "number" && parsed.height > 0
          ? parsed.height
          : DEFAULT_OPTIONS.height,
      responsive:
        typeof parsed.responsive === "boolean"
          ? parsed.responsive
          : DEFAULT_OPTIONS.responsive,
      showTitle:
        typeof parsed.showTitle === "boolean"
          ? parsed.showTitle
          : DEFAULT_OPTIONS.showTitle,
      showThumbs:
        typeof parsed.showThumbs === "boolean"
          ? parsed.showThumbs
          : DEFAULT_OPTIONS.showThumbs,
      showShare:
        typeof parsed.showShare === "boolean"
          ? parsed.showShare
          : DEFAULT_OPTIONS.showShare,
      showFullscreen:
        typeof parsed.showFullscreen === "boolean"
          ? parsed.showFullscreen
          : DEFAULT_OPTIONS.showFullscreen,
      autorotate:
        typeof parsed.autorotate === "boolean"
          ? parsed.autorotate
          : DEFAULT_OPTIONS.autorotate,
      startSceneId:
        typeof parsed.startSceneId === "string" ? parsed.startSceneId : "",
    };
  } catch {
    return null;
  }
}

function writeStoredOptions(tourId: string, options: EmbedOptionState): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(embedOptionsStorageKey(tourId), JSON.stringify(options));
  } catch {
    // Quota / private mode — ignore.
  }
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function CopyBlock({
  label,
  value,
  monospace = true,
}: {
  label: string;
  value: string;
  monospace?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    const ok = await copyText(value);
    if (!ok) {
      toast.error("Could not copy to clipboard");
      return;
    }
    setCopied(true);
    toast.success("Copied");
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <Label>{label}</Label>
        <Button type="button" variant="outline" size="sm" onClick={handleCopy}>
          {copied ? (
            <CheckIcon className="size-3.5" />
          ) : (
            <CopyIcon className="size-3.5" />
          )}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <pre
        className={cn(
          "max-h-40 overflow-auto rounded-lg border border-foreground/10 bg-muted/40 p-3 text-xs leading-relaxed whitespace-pre-wrap break-all",
          monospace && "font-mono",
        )}
      >
        {value}
      </pre>
    </div>
  );
}

export function EmbedDialog({
  tour,
  scenes: scenesProp,
  open,
  onOpenChange,
}: EmbedDialogProps) {
  const [tab, setTab] = useState<TabId>("link");
  const [isPublic, setIsPublic] = useState(tour.is_public);
  const [scenes, setScenes] = useState<EmbedDialogScene[]>(scenesProp ?? []);
  const [width, setWidth] = useState(DEFAULT_OPTIONS.width);
  const [height, setHeight] = useState(DEFAULT_OPTIONS.height);
  const [responsive, setResponsive] = useState(DEFAULT_OPTIONS.responsive);
  const [showTitle, setShowTitle] = useState(DEFAULT_OPTIONS.showTitle);
  const [showThumbs, setShowThumbs] = useState(DEFAULT_OPTIONS.showThumbs);
  const [showShare, setShowShare] = useState(DEFAULT_OPTIONS.showShare);
  const [showFullscreen, setShowFullscreen] = useState(
    DEFAULT_OPTIONS.showFullscreen,
  );
  const [autorotate, setAutorotate] = useState(DEFAULT_OPTIONS.autorotate);
  const [startSceneId, setStartSceneId] = useState(DEFAULT_OPTIONS.startSceneId);
  const [pending, startTransition] = useTransition();
  const wasOpenRef = useRef(false);
  const scenesPropKey = useMemo(
    () =>
      scenesProp
        ? scenesProp.map((scene) => `${scene.id}:${scene.name}`).join("|")
        : "",
    [scenesProp],
  );

  // Restore options once per open; reset the tab to Link.
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setIsPublic(tour.is_public);
      setTab("link");
      const stored = readStoredOptions(tour.id);
      if (stored) {
        setWidth(stored.width);
        setHeight(stored.height);
        setResponsive(stored.responsive);
        setShowTitle(stored.showTitle);
        setShowThumbs(stored.showThumbs);
        setShowShare(stored.showShare);
        setShowFullscreen(stored.showFullscreen);
        setAutorotate(stored.autorotate);
        setStartSceneId(stored.startSceneId);
      }
    }
    wasOpenRef.current = open;
  }, [open, tour.id, tour.is_public]);

  useEffect(() => {
    if (!open) return;
    if (scenesProp) {
      setScenes(scenesProp);
      return;
    }
    void listOwnedTourScenes(tour.id).then(setScenes);
  }, [open, tour.id, scenesPropKey, scenesProp]);

  // Drop a stored start id that no longer exists in this tour.
  useEffect(() => {
    if (!startSceneId || scenes.length === 0) return;
    if (!scenes.some((scene) => scene.id === startSceneId)) {
      setStartSceneId("");
    }
  }, [scenes, startSceneId]);

  const optionState = useMemo<EmbedOptionState>(
    () => ({
      width,
      height,
      responsive,
      showTitle,
      showThumbs,
      showShare,
      showFullscreen,
      autorotate,
      startSceneId,
    }),
    [
      width,
      height,
      responsive,
      showTitle,
      showThumbs,
      showShare,
      showFullscreen,
      autorotate,
      startSceneId,
    ],
  );

  useEffect(() => {
    if (!open) return;
    writeStoredOptions(tour.id, optionState);
  }, [open, tour.id, optionState]);

  const origin = clientSiteOrigin();
  const snippetStartId = isValidSceneIdParam(startSceneId)
    ? startSceneId
    : null;
  const snippetOptions = useMemo(
    () => ({
      showTitle,
      showThumbs,
      showShare,
      showFullscreen,
      autorotate,
      startSceneId: snippetStartId,
    }),
    [
      showTitle,
      showThumbs,
      showShare,
      showFullscreen,
      autorotate,
      snippetStartId,
    ],
  );

  const publicUrl = buildPublicTourUrl(origin, tour.slug, {
    startSceneId: snippetStartId,
  });
  const embedUrl = buildEmbedUrl(origin, tour.slug, snippetOptions);
  const unbrandedUrl = buildEmbedUrl(origin, tour.slug, {
    ...snippetOptions,
    unbranded: true,
  });
  const iframeSnippet = responsive
    ? buildResponsiveIframeSnippet(embedUrl)
    : buildFixedIframeSnippet(embedUrl, width, height);
  const jsSnippet = buildJavaScriptSnippet(origin, tour.slug, snippetOptions);
  const previewSrc =
    tab === "unbranded"
      ? unbrandedUrl
      : buildEmbedUrl(origin, tour.slug, snippetOptions);

  function handleMakePublic() {
    startTransition(async () => {
      const result = await setTourPublic(tour.id, true);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setIsPublic(true);
      toast.success("Tour is now public");
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Embed & share</DialogTitle>
          <DialogDescription>
            Place “{tour.title}” on a website, listing, or MLS portal.
          </DialogDescription>
        </DialogHeader>

        {!isPublic ? (
          <div className="flex flex-col gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
            <p>
              This tour is unlisted. Set it to public before embedding — visitors
              and iframes can only load public tours.
            </p>
            <Button
              type="button"
              size="sm"
              disabled={pending}
              onClick={handleMakePublic}
            >
              {pending ? "Updating…" : "Make tour public"}
            </Button>
          </div>
        ) : (
          <>
            <div className="grid gap-3 rounded-lg border border-foreground/10 p-3">
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="embed-width">Width</Label>
                  <Input
                    id="embed-width"
                    type="number"
                    min={200}
                    max={2400}
                    value={width}
                    disabled={responsive}
                    onChange={(event) =>
                      setWidth(Number(event.target.value) || 800)
                    }
                    className="w-24"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="embed-height">Height</Label>
                  <Input
                    id="embed-height"
                    type="number"
                    min={150}
                    max={1600}
                    value={height}
                    disabled={responsive}
                    onChange={(event) =>
                      setHeight(Number(event.target.value) || 450)
                    }
                    className="w-24"
                  />
                </div>
                <label className="flex items-center gap-2 pb-2 text-sm">
                  <input
                    type="checkbox"
                    checked={responsive}
                    onChange={(event) => setResponsive(event.target.checked)}
                    className="size-4 rounded border"
                  />
                  Responsive (16:9)
                </label>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="embed-title" className="font-normal">
                    Show title
                  </Label>
                  <Switch
                    id="embed-title"
                    checked={showTitle}
                    onCheckedChange={setShowTitle}
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="embed-thumbs" className="font-normal">
                    Show thumbnails
                  </Label>
                  <Switch
                    id="embed-thumbs"
                    checked={showThumbs}
                    onCheckedChange={setShowThumbs}
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="embed-share" className="font-normal">
                    Show share
                  </Label>
                  <Switch
                    id="embed-share"
                    checked={showShare}
                    onCheckedChange={setShowShare}
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="embed-fs" className="font-normal">
                    Allow fullscreen
                  </Label>
                  <Switch
                    id="embed-fs"
                    checked={showFullscreen}
                    onCheckedChange={setShowFullscreen}
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="embed-auto" className="font-normal">
                    Autorotate
                  </Label>
                  <Switch
                    id="embed-auto"
                    checked={autorotate}
                    onCheckedChange={setAutorotate}
                  />
                </div>
              </div>

              {scenes.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="embed-start">Start scene</Label>
                  <select
                    id="embed-start"
                    className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
                    value={startSceneId}
                    onChange={(event) => setStartSceneId(event.target.value)}
                  >
                    <option value="">Tour default</option>
                    {scenes.map((scene) => (
                      <option key={scene.id} value={scene.id}>
                        {scene.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
            </div>

            <div
              role="tablist"
              aria-label="Embed formats"
              className="flex flex-wrap gap-1 border-b border-foreground/10 pb-2"
            >
              {TABS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === item.id}
                  className={cn(
                    "rounded-md px-2.5 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    tab === item.id
                      ? "bg-muted font-medium"
                      : "text-muted-foreground hover:bg-muted/60",
                  )}
                  onClick={() => setTab(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <div role="tabpanel" className="flex flex-col gap-3">
              {tab === "link" ? (
                <>
                  <CopyBlock label="Public link" value={publicUrl} />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-fit"
                    nativeButton={false}
                    render={
                      <a href={publicUrl} target="_blank" rel="noreferrer" />
                    }
                  >
                    <ExternalLinkIcon className="size-3.5" />
                    Open
                  </Button>
                </>
              ) : null}

              {tab === "iframe" ? (
                <CopyBlock label="iframe HTML" value={iframeSnippet} />
              ) : null}

              {tab === "javascript" ? (
                <CopyBlock label="JavaScript snippet" value={jsSnippet} />
              ) : null}

              {tab === "unbranded" ? (
                <>
                  <p className="text-sm text-muted-foreground">
                    Unbranded mode strips the title, share controls, and any
                    Swift Tours branding — suitable for MLS and other listing
                    sites that require a clean tour URL. Domain allowlisting for
                    embeds is a future option; any site can frame this URL today.
                  </p>
                  <CopyBlock label="Unbranded embed URL" value={unbrandedUrl} />
                </>
              ) : null}
            </div>

            <div className="flex flex-col gap-2">
              <Label>Preview</Label>
              <div className="overflow-hidden rounded-lg border border-foreground/10 bg-black">
                <div className="relative w-full" style={{ paddingTop: "56.25%" }}>
                  <iframe
                    title="Embed preview"
                    src={previewSrc}
                    className="absolute inset-0 size-full border-0"
                    allow="fullscreen; accelerometer; gyroscope; magnetometer; xr-spatial-tracking; autoplay; encrypted-media; picture-in-picture"
                    allowFullScreen
                  />
                </div>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
