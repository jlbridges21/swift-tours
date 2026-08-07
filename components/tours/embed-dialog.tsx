"use client";

import { CheckIcon, CopyIcon, ExternalLinkIcon } from "lucide-react";
import { useEffect, useMemo, useState, useTransition } from "react";
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

const TABS: { id: TabId; label: string }[] = [
  { id: "link", label: "Link" },
  { id: "iframe", label: "iframe" },
  { id: "javascript", label: "JavaScript" },
  { id: "unbranded", label: "Unbranded" },
];

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
  const [width, setWidth] = useState(800);
  const [height, setHeight] = useState(450);
  const [responsive, setResponsive] = useState(true);
  const [showTitle, setShowTitle] = useState(true);
  const [showThumbs, setShowThumbs] = useState(true);
  const [showShare, setShowShare] = useState(true);
  const [showFullscreen, setShowFullscreen] = useState(true);
  const [autorotate, setAutorotate] = useState(false);
  const [startSceneId, setStartSceneId] = useState<string>("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    setIsPublic(tour.is_public);
    setTab("link");
    if (scenesProp) {
      setScenes(scenesProp);
      return;
    }
    void listOwnedTourScenes(tour.id).then(setScenes);
  }, [open, tour.is_public, tour.id, scenesProp]);

  const origin = clientSiteOrigin();
  const snippetOptions = useMemo(
    () => ({
      showTitle,
      showThumbs,
      showShare,
      showFullscreen,
      autorotate,
      startSceneId: startSceneId || null,
    }),
    [
      showTitle,
      showThumbs,
      showShare,
      showFullscreen,
      autorotate,
      startSceneId,
    ],
  );

  const publicUrl = buildPublicTourUrl(origin, tour.slug);
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
                    <option value="">Cover / default</option>
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
