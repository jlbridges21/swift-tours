"use client";

import { CheckIcon, Loader2Icon, RotateCcwIcon } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type SaveStatusValue = "idle" | "saving" | "saved" | "error";

type MutationResult = { error?: string } | void;

type SaveStatusContextValue = {
  status: SaveStatusValue;
  error: string | null;
  run: (fn: () => Promise<MutationResult>) => Promise<boolean>;
  retry: () => void;
};

const SaveStatusContext = createContext<SaveStatusContextValue | null>(null);

export function SaveStatusProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SaveStatusValue>("idle");
  const [error, setError] = useState<string | null>(null);
  const lastFnRef = useRef<(() => Promise<MutationResult>) | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const run = useCallback(async (fn: () => Promise<MutationResult>) => {
    lastFnRef.current = fn;
    if (savedTimerRef.current) {
      clearTimeout(savedTimerRef.current);
      savedTimerRef.current = null;
    }

    setStatus("saving");
    setError(null);

    try {
      const result = await fn();
      if (result && result.error) {
        setStatus("error");
        setError(result.error);
        return false;
      }

      setStatus("saved");
      savedTimerRef.current = setTimeout(() => {
        setStatus("idle");
        savedTimerRef.current = null;
      }, 2000);
      return true;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Something went wrong.";
      setStatus("error");
      setError(message);
      return false;
    }
  }, []);

  const retry = useCallback(() => {
    if (lastFnRef.current) {
      void run(lastFnRef.current);
    }
  }, [run]);

  const value = useMemo(
    () => ({ status, error, run, retry }),
    [status, error, run, retry],
  );

  return (
    <SaveStatusContext.Provider value={value}>
      {children}
    </SaveStatusContext.Provider>
  );
}

export function useSaveStatus(): SaveStatusContextValue {
  const ctx = useContext(SaveStatusContext);
  if (!ctx) {
    throw new Error("useSaveStatus must be used within SaveStatusProvider");
  }
  return ctx;
}

export function SaveStatusIndicator({ className }: { className?: string }) {
  const { status, error, retry } = useSaveStatus();

  if (status === "idle") {
    return (
      <span className={cn("text-xs text-muted-foreground", className)}>
        {/* reserve space so the bar doesn't jump */}
        &nbsp;
      </span>
    );
  }

  if (status === "saving") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 text-xs text-muted-foreground",
          className,
        )}
      >
        <Loader2Icon className="size-3.5 animate-spin" />
        Saving…
      </span>
    );
  }

  if (status === "saved") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-opacity",
          className,
        )}
      >
        <CheckIcon className="size-3.5" />
        Saved
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 text-xs text-destructive",
        className,
      )}
      title={error ?? undefined}
    >
      <span className="max-w-[140px] truncate">{error ?? "Save failed"}</span>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className="h-6 gap-1 px-1.5 text-destructive"
        onClick={retry}
      >
        <RotateCcwIcon className="size-3" />
        Retry
      </Button>
    </span>
  );
}
