import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function AuthCodeErrorPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold tracking-tight">Authentication error</h1>
      <p className="max-w-sm text-center text-sm text-muted-foreground">
        Something went wrong confirming your sign-in link. Try again or request a
        new email.
      </p>
      <Link href="/login">
        <Button type="button">Back to sign in</Button>
      </Link>
    </main>
  );
}
