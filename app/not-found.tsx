import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <p className="text-sm font-medium tracking-wide text-muted-foreground">
        Swift Tours
      </p>
      <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        That URL doesn&apos;t match anything we know about. It may have been
        moved or never existed.
      </p>
      <Button nativeButton={false} render={<Link href="/" />}>
        Back to home
      </Button>
    </main>
  );
}
