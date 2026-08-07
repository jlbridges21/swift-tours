export default function EmbedTourNotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-neutral-950 px-6 text-center text-white">
      <p className="text-lg font-medium">Tour not found</p>
      <p className="max-w-sm text-sm text-white/65">
        This embed link is invalid or the tour is no longer public.
      </p>
    </div>
  );
}
