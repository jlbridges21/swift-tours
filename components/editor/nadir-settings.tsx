"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { updateTourNadir } from "@/app/dashboard/actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  DEFAULT_NADIR_LOGO_URL,
  isNadirType,
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

export type NadirTourFields = Pick<
  Tour,
  | "nadir_type"
  | "nadir_logo_path"
  | "nadir_size"
  | "nadir_opacity"
  | "nadir_rotation"
>;

type NadirSettingsProps = {
  tourId: string;
  userId: string;
  scenes: Scene[];
  values: NadirTourFields;
  onChange: (next: NadirTourFields) => void;
  onScenesChange: (scenes: Scene[]) => void;
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
  values,
  onChange,
  onScenesChange,
  className,
}: NadirSettingsProps) {
  const [pending, startTransition] = useTransition();
  const [applying, setApplying] = useState(false);
  const [applyProgress, setApplyProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [logoMode, setLogoMode] = useState<"default" | "custom">(
    values.nadir_logo_path ? "custom" : "default",
  );
  const fileRef = useRef<HTMLInputElement>(null);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const regenerateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const type: NadirType = isNadirType(values.nadir_type)
    ? values.nadir_type
    : "none";

  useEffect(() => {
    setLogoMode(values.nadir_logo_path ? "custom" : "default");
  }, [values.nadir_logo_path]);

  useEffect(() => {
    return () => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
      if (regenerateTimer.current) clearTimeout(regenerateTimer.current);
    };
  }, []);

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

  async function regenerateAll(
    nextType: NadirType,
    nextLogoPath: string | null,
  ) {
    if (scenes.length === 0) return;
    setApplying(true);
    setApplyProgress({ done: 0, total: scenes.length });

    let done = 0;
    const updated = [...scenes];

    await mapPool(scenes, 3, async (scene, index) => {
      if (nextType === "none") {
        const result = await clearNadirPatchForScene(scene);
        if (!result.error) {
          updated[index] = { ...scene, nadir_patch_path: null };
        }
      } else {
        const result = await uploadNadirPatchForScene({
          userId,
          tourId,
          scene,
          type: nextType,
          logoPath: nextLogoPath,
        });
        if ("path" in result) {
          updated[index] = { ...scene, nadir_patch_path: result.path };
        } else {
          console.error("[nadir] regenerate failed", scene.id, result.error);
        }
      }
      done += 1;
      setApplyProgress({ done, total: scenes.length });
    });

    onScenesChange(updated);
    setApplying(false);
    setApplyProgress(null);
  }

  function scheduleRegenerate(
    nextType: NadirType,
    nextLogoPath: string | null,
  ) {
    if (regenerateTimer.current) clearTimeout(regenerateTimer.current);
    regenerateTimer.current = setTimeout(() => {
      void regenerateAll(nextType, nextLogoPath);
    }, 500);
  }

  function handleTypeChange(next: NadirType) {
    updateLocal({ nadir_type: next });
    persist({ nadir_type: next }, 0);
    scheduleRegenerate(next, values.nadir_logo_path);
  }

  function handleLogoDefault() {
    setLogoMode("default");
    updateLocal({ nadir_logo_path: null });
    persist({ nadir_logo_path: null }, 0);
    if (type === "logo") {
      scheduleRegenerate("logo", null);
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

    setLogoMode("custom");
    updateLocal({ nadir_logo_path: path });
    persist({ nadir_logo_path: path }, 0);
    if (type === "logo") {
      scheduleRegenerate("logo", path);
    }
    toast.success("Logo uploaded");
  }

  async function handleApplyAll() {
    await regenerateAll(type, values.nadir_logo_path);
    toast.success(
      type === "none"
        ? "Nadir patches cleared on all scenes"
        : "Nadir patch applied to all scenes",
    );
  }

  const previewLogoUrl =
    logoMode === "custom" && values.nadir_logo_path
      ? resolveNadirLogoUrl(values.nadir_logo_path)
      : DEFAULT_NADIR_LOGO_URL;

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
                logoMode === "default" && "ring-2 ring-foreground",
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
            {logoMode === "custom" && values.nadir_logo_path ? (
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
          <RangeField
            label="Size"
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
        <p className="text-xs text-muted-foreground">
          Generates a patch per scene from its panorama. Size, opacity, and
          rotation update live without regenerating.
        </p>
      </div>
    </div>
  );
}

function RangeField({
  label,
  min,
  max,
  step,
  value,
  display,
  disabled,
  onChange,
}: {
  label: string;
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
        <Label className="text-xs">{label}</Label>
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
