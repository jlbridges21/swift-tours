"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { createTour } from "@/app/dashboard/actions";
import { Button } from "@/components/ui/button";

type NewTourButtonProps = {
  variant?: React.ComponentProps<typeof Button>["variant"];
};

export function NewTourButton({ variant = "default" }: NewTourButtonProps) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant={variant}
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          const result = await createTour();
          if (result?.error) {
            toast.error(result.error);
          }
        });
      }}
    >
      {pending ? "Creating…" : "New tour"}
    </Button>
  );
}
