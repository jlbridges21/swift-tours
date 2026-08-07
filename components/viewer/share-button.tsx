"use client";

import { CheckIcon, Share2Icon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

type ShareButtonProps = {
  title: string;
  text?: string | null;
};

export function ShareButton({ title, text }: ShareButtonProps) {
  const [copied, setCopied] = useState(false);

  async function handleShare() {
    const url = window.location.href;

    if (typeof navigator.share === "function") {
      try {
        await navigator.share({
          title,
          text: text ?? undefined,
          url,
        });
        return;
      } catch (error) {
        // User cancelled or share failed — fall through to clipboard.
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
      }
    }

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const input = document.createElement("input");
        input.value = url;
        document.body.appendChild(input);
        input.select();
        document.execCommand("copy");
        document.body.removeChild(input);
      }
      setCopied(true);
      toast.success("Link copied");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy link");
    }
  }

  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      className="bg-black/55 text-white hover:bg-black/70"
      onClick={() => {
        void handleShare();
      }}
    >
      {copied ? <CheckIcon className="size-4" /> : <Share2Icon className="size-4" />}
      {copied ? "Copied" : "Share"}
    </Button>
  );
}
