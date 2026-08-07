import Link from "next/link";

export default function PublicTourNotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-neutral-950 px-6 text-center text-white">
      <p className="text-sm font-medium tracking-wide text-white/50">
        Swift Tours
      </p>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">
        This tour isn&apos;t available
      </h1>
      <p className="mt-2 max-w-md text-sm text-white/65">
        It may have been deleted or set to unlisted. Ask the owner for a new
        link if you still need access.
      </p>
      <Link
        href="/"
        className="mt-8 text-sm font-medium text-white underline-offset-4 hover:underline"
      >
        Back to Swift Tours
      </Link>
    </div>
  );
}
