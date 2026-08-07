"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { updateTour } from "@/app/dashboard/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { TourListItem } from "@/lib/queries/tours";

type TourSettingsDialogProps = {
  tour: TourListItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function TourSettingsDialog({
  tour,
  open,
  onOpenChange,
}: TourSettingsDialogProps) {
  const [title, setTitle] = useState(tour.title);
  const [description, setDescription] = useState(tour.description ?? "");
  const [isPublic, setIsPublic] = useState(tour.is_public);
  const [pending, startTransition] = useTransition();

  function handleOpenChange(next: boolean) {
    if (next) {
      setTitle(tour.title);
      setDescription(tour.description ?? "");
      setIsPublic(tour.is_public);
    }
    onOpenChange(next);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await updateTour(tour.id, {
        title,
        description: description.trim() ? description.trim() : null,
        is_public: isPublic,
      });

      if (result.error) {
        toast.error(result.error);
        return;
      }

      toast.success("Tour updated");
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tour settings</DialogTitle>
          <DialogDescription>
            Update the title, description, and visibility.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor={`title-${tour.id}`}>Title</Label>
            <Input
              id={`title-${tour.id}`}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
              disabled={pending}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`description-${tour.id}`}>Description</Label>
            <Textarea
              id={`description-${tour.id}`}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
              disabled={pending}
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor={`public-${tour.id}`} className="flex-1 font-normal">
              Public — anyone with the link can view
            </Label>
            <Switch
              id={`public-${tour.id}`}
              checked={isPublic}
              onCheckedChange={setIsPublic}
              disabled={pending}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
