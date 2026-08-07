"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { updateTourNadir } from "@/app/dashboard/actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  DEFAULT_NADIR_LOGO_URL,
  isNadirLogoSource,
  isNadirType,
  type NadirLogoSource,
  type NadirType,
} from "@/lib/nadir";
import {
  clearNadirPatchForScene,
  mapPool,
  resolveNadirLogoUrl,
  uploadNadirPatchForScene,
} from "@/lib/nadir-upload";
import { createClient } from "@/lib/supabase/client";
import { brandingLogoPath } from "@/lib/storage";
import { cn } from "@/lib/utils";
import type { Scene, Tour } from "@/types";

export type EditorScene = Scene & {
  nadir_preview_url?: string | null;
};

export type NadirTourFields = Pick<
  Tour,
  | "nadir_type"
  | "nadir_logo_path"
  | "nadir_logo_source"
  | "nadir_size"
  | "nadir_opacity"
  | "nadir_rotation"
  | "nadir_feather"
>;

type NadirSettingsProps = {
  tourId: string;
  userId: string;
  scenes: EditorScene[];
  activeSceneId: string | null;
  values: NadirTourFields;
  onChange: (next: NadirTourFields) => void;
  onScenesChange: (scenes: EditorScene[]) => void;
  className?: string;
};

const TYPE_OPTIONS: { value: NadirType; label: string }[] = [
  { value: "none", label: "None" },
  { value: "blur", label: "Blur" },
  { value: "logo", label: "Logo" },
];

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function NadirSettings({
  tourId,
  userId,
  scenes,
  activeSceneId,
  values,
  onChange,
  onScenesChange,
  className,
}: NadirSettingsProps) {
  const [pending, startTransition] = useTransition();
  const [applying, setApplying] = useState(false);
  const [regenPending, setRegenPending] = useState(false);
  const [applyProgress, setApplyProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const regenerateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewUrls = useRef(new Map<string, string>());
  const scenesRef = useRef(scenes);
  scenesRef.current = scenes;

  const type: NadirType = isNadirType(values.nadir_type)
    ? values.nadir_type
    : "none";
  const logoSource: NadirLogoSource = isNadirLogoSource(values.nadir_logo_source)
    ? values.nadir_logo_source
    : values.nadir_logo_path
      ? "custom"
      : "default";

  useEffect(() => {
    return () => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
      if (regenerateTimer.current) clearTimeout(regenerateTimer.current);
      for (const url of previewUrls.current.values()) {
        URL.revokeObjectURL(url);
      }
      previewUrls.current.clear();
    };
  }, []);

  function setPreview(sceneId: string, url: string | null) {
    const prev = previewUrls.current.get(sceneId);
    if (prev && prev !== url) {
      URL.revokeObjectURL(prev);
      previewUrls.current.delete(sceneId);
    }
    if (url) previewUrls.current.set(sceneId, url);

    onScenesChange(
      scenesRef.current.map((scene) =>
        scene.id === sceneId ? { ...scene, nadir_preview_url: url } : scene,
      ),
    );
  }

  function persist(patch: Partial<NadirTourFields>, debounceMs = 400) {
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      startTransition(async () => {
        const result = await updateTourNadir(tourId, patch);
        if (result.error) {
          toast.error(result.error);
        }
      });
    }, debounceMs);
  }

  function updateLocal(patch: Partial<NadirTourFields>) {
    onChange({ ...values, ...patch });
  }

  /** Size / opacity / rotation — live preview only; debounce DB write. */
  function updateRenderSetting(
    key: "nadir_size" | "nadir_opacity" | "nadir_rotation",
    value: number,
  ) {
    updateLocal({ [key]: value });
    persist({ [key]: value });
  }

  async function regenerateScene(
    scene: EditorScene,
    nextType: NadirType,
    nextLogoSource: NadirLogoSource,
    nextLogoPath: string | null,
    nextFeather: number,
  ): Promise<EditorScene> {
    if (nextType === "none") {
      setPreview(scene.id, null);
      const result = await clearNadirPatchForScene(scene);
      if (result.error) {
        console.error("[nadir] clear failed", scene.id, result.error);
        return scene;
      }
      return { ...scene, nadir_patch_path: null, nadir_preview_url: null };
    }

    const result = await uploadNadirPatchForScene({
      userId,
      tourId,
      scene,
      type: nextType,
      logoSource: nextLogoSource,
      logoPath: nextLogoPath,
      feather: nextFeather,
      onPreviewUrl: (sceneId, url) => setPreview(sceneId, url),
    });

    if ("path" in result) {
      const updated: EditorScene = {
        ...scene,
        nadir_patch_path: result.path,
        nadir_preview_url: null,
      };
      // Drop blob preview only after the stored path is on the scene.
      const prev = previewUrls.current.get(scene.id);
      if (prev) {
        URL.revokeObjectURL(prev);
        previewUrls.current.delete(scene.id);
      }
      if (result.previewUrl !== prev) {
        URL.revokeObjectURL(result.previewUrl);
      }
      return updated;
    }

    console.error("[nadir] regenerate failed", scene.id, result.error);
    setPreview(scene.id, null);
    return scene;
  }

  async function regenerateCurrent(
    nextType: NadirType,
    nextLogoSource: NadirLogoSource,
    nextLogoPath: string | null,
    nextFeather: number,
  ) {
    const scene =
      scenesRef.current.find((item) => item.id === activeSceneId) ??
      scenesRef.current[0];
    if (!scene) return;

    setRegenPending(true);
    try {
      const updated = await regenerateScene(
        scene,
        nextType,
        nextLogoSource,
        nextLogoPath,
        nextFeather,
      );
      onScenesChange(
        scenesRef.current.map((item) =>
          item.id === updated.id ? updated : item,
        ),
      );
    } finally {
      setRegenPending(false);
    }
  }

  async function regenerateAll(
    nextType: NadirType,
    nextLogoSource: NadirLogoSource,
    nextLogoPath: string | null,
    nextFeather: number,
  ) {
    const list = scenesRef.current;
    if (list.length === 0) return;
    setApplying(true);
    setApplyProgress({ done: 0, total: list.length });

    let done = 0;
    const updated = [...list];

    await mapPool(list, 3, async (scene, index) => {
      updated[index] = await regenerateScene(
        scene,
        nextType,
        nextLogoSource,
        nextLogoPath,
        nextFeather,
      );
      done += 1;
      setApplyProgress({ done, total: list.length });
    });

    onScenesChange(updated);
    setApplying(false);
    setApplyProgress(null);
  }

  function scheduleCurrentRegen(
    nextType: NadirType,
    nextLogoSource: NadirLogoSource,
    nextLogoPath: string | null,
    nextFeather: number,
    debounceMs = 250,
  ) {
    if (regenerateTimer.current) clearTimeout(regenerateTimer.current);
    regenerateTimer.current = setTimeout(() => {
      void regenerateCurrent(
        nextType,
        nextLogoSource,
        nextLogoPath,
        nextFeather,
      );
    }, debounceMs);
  }

  function handleTypeChange(next: NadirType) {
    updateLocal({ nadir_type: next });
    persist({ nadir_type: next }, 0);
    scheduleCurrentRegen(
      next,
      logoSource,
      values.nadir_logo_path,
      values.nadir_feather,
      100,
    );
  }

  function handleLogoDefault() {
    updateLocal({ nadir_logo_source: "default", nadir_logo_path: null });
    persist({ nadir_logo_source: "default", nadir_logo_path: null }, 0);
    if (type === "logo") {
      scheduleCurrentRegen("logo", "default", null, values.nadir_feather, 100);
    }
  }

  async function handleLogoUpload(file: File) {
    const isPng = file.type === "image/png";
    const isSvg =
      file.type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg");
    if (!isPng && !isSvg) {
      toast.error("Logo must be a PNG or SVG.");
      return;
    }

    const ext = isSvg ? ".svg" : ".png";
    const path = brandingLogoPath(userId, crypto.randomUUID(), ext);
    const supabase = createClient();
    const { error } = await supabase.storage.from("panoramas").upload(path, file, {
      contentType: isSvg ? "image/svg+xml" : "image/png",
      cacheControl: "31536000",
      upsert: false,
    });

    if (error) {
      toast.error(error.message);
      return;
    }

    updateLocal({ nadir_logo_source: "custom", nadir_logo_path: path });
    persist({ nadir_logo_source: "custom", nadir_logo_path: path }, 0);
    if (type === "logo") {
      scheduleCurrentRegen("logo", "custom", path, values.nadir_feather, 100);
    }
    toast.success("Logo uploaded");
  }

  function handleFeather(value: number) {
    const feather = clamp(value, 0, 1);
    updateLocal({ nadir_feather: feather });
    persist({ nadir_feather: feather });
    if (type !== "none") {
      scheduleCurrentRegen(
        type,
        logoSource,
        values.nadir_logo_path,
        feather,
        250,
      );
    }
  }

  async function handleApplyAll() {
    await regenerateAll(
      type,
      logoSource,
      values.nadir_logo_path,
      values.nadir_feather,
    );
    toast.success(
      type === "none"
        ? "Nadir patches cleared on all scenes"
        : "Nadir patch applied to all scenes",
    );
  }

  const previewLogoUrl = resolveNadirLogoUrl(
    logoSource,
    values.nadir_logo_path,
  );

  return (
    <div className={cn("flex flex-col gap-4 p-3", className)}>
      <div>
        <h2 className="text-sm font-semibold tracking-tight">Nadir patch</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Cover the tripod at the bottom of each panorama. Look down to preview.
        </p>
      </div>

      <div className="space-y-2">
        <Label className="text-xs">Type</Label>
        <div
          className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1"
          role="group"
          aria-label="Nadir patch type"
        >
          {TYPE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              disabled={pending || applying}
              className={cn(
                "rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                type === option.value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => handleTypeChange(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {type === "logo" ? (
        <div className="space-y-2">
          <Label className="text-xs">Logo</Label>
          <p className="text-xs text-muted-foreground">
            PNG or SVG with transparency works best.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className={cn(
                "flex size-14 items-center justify-center overflow-hidden rounded-md ring-1 ring-foreground/10",
                logoSource === "default" && "ring-2 ring-foreground",
              )}
              onClick={handleLogoDefault}
              title="Default logo"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={DEFAULT_NADIR_LOGO_URL}
                alt="Default nadir logo"
                className="size-12 object-contain"
              />
            </button>
            {logoSource === "custom" && values.nadir_logo_path ? (
              <button
                type="button"
                className="flex size-14 items-center justify-center overflow-hidden rounded-md ring-2 ring-foreground"
                title="Custom logo"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={previewLogoUrl}
                  alt="Custom nadir logo"
                  className="size-12 object-contain"
                />
              </button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={applying}
              onClick={() => fileRef.current?.click()}
            >
              Upload your own
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/svg+xml,.svg,.png"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void handleLogoUpload(file);
              }}
            />
          </div>
        </div>
      ) : null}

      {type !== "none" ? (
        <>
          <p className="text-[11px] text-muted-foreground">
            Size, opacity, and rotation are instant. Type, logo, and feather
            regenerate the patch (~250ms debounce on the current scene).
          </p>
          <RangeField
            label="Size"
            hint="instant"
            min={0.1}
            max={1}
            step={0.01}
            value={values.nadir_size}
            disabled={applying}
            onChange={(v) => updateRenderSetting("nadir_size", clamp(v, 0.1, 1))}
            display={`${Math.round(values.nadir_size * 100)}%`}
          />
          <RangeField
            label="Opacity"
            hint="instant"
            min={0.1}
            max={1}
            step={0.01}
            value={values.nadir_opacity}
            disabled={applying}
            onChange={(v) =>
              updateRenderSetting("nadir_opacity", clamp(v, 0.1, 1))
            }
            display={`${Math.round(values.nadir_opacity * 100)}%`}
          />
          <RangeField
            label="Rotation"
            hint="instant"
            min={0}
            max={360}
            step={1}
            value={values.nadir_rotation}
            disabled={applying}
            onChange={(v) =>
              updateRenderSetting("nadir_rotation", clamp(v, 0, 360))
            }
            display={`${Math.round(values.nadir_rotation)}°`}
          />
          <RangeField
            label="Feather"
            hint="regenerates"
            min={0}
            max={1}
            step={0.01}
            value={values.nadir_feather}
            disabled={applying}
            onChange={handleFeather}
            display={`${Math.round(values.nadir_feather * 100)}%`}
          />
          {regenPending ? (
            <p className="text-[11px] text-muted-foreground" role="status">
              Updating current scene…
            </p>
          ) : null}
        </>
      ) : null}

      <div className="space-y-2 border-t pt-3">
        <Button
          type="button"
          className="w-full"
          disabled={applying || scenes.length === 0}
          onClick={() => {
            void handleApplyAll();
          }}
        >
          {applying
            ? `Applying… ${applyProgress?.done ?? 0}/${applyProgress?.total ?? 0}`
            : "Apply to all scenes in this tour"}
        </Button>
        {applying ? (
          <div
            className="h-1.5 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={applyProgress?.done ?? 0}
            aria-valuemin={0}
            aria-valuemax={applyProgress?.total ?? 1}
          >
            <div
              className="h-full bg-foreground transition-[width] duration-150"
              style={{
                width: `${
                  applyProgress && applyProgress.total > 0
                    ? (100 * applyProgress.done) / applyProgress.total
                    : 0
                }%`,
              }}
            />
          </div>
        ) : null}
        <p className="text-xs text-muted-foreground">
          Patches are generated from each scene’s thumbnail. Use Apply to all
          after changing type, logo, or feather.
        </p>
      </div>
    </div>
  );
}

function RangeField({
  label,
  hint,
  min,
  max,
  step,
  value,
  display,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  min: number;
  max: number;
  step: number;
  value: number;
  display: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs">
          {label}
          {hint ? (
            <span className="ml-1 font-normal text-muted-foreground">
              · {hint}
            </span>
          ) : null}
        </Label>
        <span className="text-xs tabular-nums text-muted-foreground">
          {display}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-foreground"
      />
    </div>
  );
}
