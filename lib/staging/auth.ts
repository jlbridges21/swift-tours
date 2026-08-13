import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * Resolve the signed-in user via the cookie session (anon key + RLS).
 * Never use the service role here — ownership checks must run as the user.
 */
export async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return { supabase, user: null as null, error: "Unauthorized." as const };
  }

  return { supabase, user, error: null };
}

export async function requireOwnedTour(tourId: string) {
  const auth = await requireUser();
  if (!auth.user) {
    return { ...auth, tour: null };
  }

  const { data: tour, error } = await auth.supabase
    .from("tours")
    .select("id, owner_id, slug")
    .eq("id", tourId)
    .maybeSingle();

  if (error) {
    return { ...auth, tour: null, error: error.message };
  }
  if (!tour || tour.owner_id !== auth.user.id) {
    return { ...auth, tour: null, error: "Tour not found." as const };
  }

  return { ...auth, tour, error: null };
}
