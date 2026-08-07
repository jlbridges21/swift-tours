"use client";

import { useFormStatus } from "react-dom";

import { signOut } from "@/app/login/actions";
import { Button } from "@/components/ui/button";

function SignOutSubmit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" size="sm" disabled={pending}>
      {pending ? "Signing out…" : "Sign out"}
    </Button>
  );
}

export function SignOutButton() {
  return (
    <form action={signOut}>
      <SignOutSubmit />
    </form>
  );
}
