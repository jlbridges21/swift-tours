import "server-only";

import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type StagingErrorCode =
  | "UNAUTHORIZED"
  | "BAD_REQUEST"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "STAGING_DISABLED"
  | "PROVIDER_MISCONFIGURED"
  | "RATE_LIMIT"
  | "INTERNAL"
  | "JOB_FAILED";

export function stagingError(
  status: number,
  code: StagingErrorCode,
  error: string,
  extra?: Record<string, unknown>,
) {
  return NextResponse.json({ error, code, ...extra }, { status });
}

function stagingDebug(payload: Record<string, unknown>) {
  if (process.env.NODE_ENV !== "development") return;
  console.info("[staging/auth]", payload);
}

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
    stagingDebug({
      step: "requireUser",
      userId: null,
      authError: error?.message ?? null,
    });
    return {
      supabase,
      user: null as null,
      error: "Unauthorized." as const,
      code: "UNAUTHORIZED" as const,
    };
  }

  return {
    supabase,
    user,
    error: null,
    code: null,
  };
}

export type OwnedTourResult = Awaited<ReturnType<typeof requireOwnedTour>>;

/**
 * Authenticated owner of `tourId`.
 * Distinguishes missing tour (404) from not-owner (403). When the
 * cookie-scoped query returns null, cross-checks with the service role so we
 * can detect “RLS hid an owned row” (JWT not applied to PostgREST).
 */
export async function requireOwnedTour(tourId: string) {
  const auth = await requireUser();
  if (!auth.user) {
    return { ...auth, tour: null };
  }

  const trimmedId = tourId.trim();

  const { data: tour, error } = await auth.supabase
    .from("tours")
    .select("id, owner_id, slug, is_public")
    .eq("id", trimmedId)
    .maybeSingle();

  if (error) {
    stagingDebug({
      step: "requireOwnedTour.query",
      userId: auth.user.id,
      tourId: trimmedId,
      supabaseError: {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
      },
    });
    return {
      ...auth,
      tour: null,
      error: error.message,
      code: "INTERNAL" as const,
    };
  }

  if (tour) {
    if (tour.owner_id !== auth.user.id) {
      stagingDebug({
        step: "requireOwnedTour.wrongOwner",
        userId: auth.user.id,
        tourId: trimmedId,
        tourOwnerId: tour.owner_id,
        isPublic: tour.is_public,
      });
      return {
        ...auth,
        tour: null,
        error: "You do not own this tour." as const,
        code: "FORBIDDEN" as const,
      };
    }
    stagingDebug({
      step: "requireOwnedTour.ok",
      userId: auth.user.id,
      tourId: trimmedId,
    });
    return {
      ...auth,
      tour: { id: tour.id, owner_id: tour.owner_id, slug: tour.slug },
      error: null,
      code: null,
    };
  }

  // Cookie client saw no row. Distinguish missing vs forbidden vs RLS mismatch.
  let adminRow: { id: string; owner_id: string } | null = null;
  let adminError: string | null = null;
  try {
    const admin = createAdminClient();
    const { data, error: aErr } = await admin
      .from("tours")
      .select("id, owner_id")
      .eq("id", trimmedId)
      .maybeSingle();
    adminRow = data;
    adminError = aErr?.message ?? null;
  } catch (err) {
    adminError = err instanceof Error ? err.message : String(err);
  }

  stagingDebug({
    step: "requireOwnedTour.rlsEmpty",
    userId: auth.user.id,
    tourId: trimmedId,
    userScopedTour: null,
    adminRow,
    adminError,
    diagnosis:
      !adminRow
        ? "tour_missing"
        : adminRow.owner_id === auth.user.id
          ? "rls_hid_owned_tour_jwt_not_applied"
          : "not_owner",
  });

  if (!adminRow) {
    return {
      ...auth,
      tour: null,
      error: "Tour not found." as const,
      code: "NOT_FOUND" as const,
    };
  }

  if (adminRow.owner_id !== auth.user.id) {
    return {
      ...auth,
      tour: null,
      error: "You do not own this tour." as const,
      code: "FORBIDDEN" as const,
    };
  }

  // Owned tour exists but RLS returned nothing → session JWT not on DB queries.
  return {
    ...auth,
    tour: null,
    error:
      "Authenticated, but the database did not see your session (RLS hid your tour). Try signing out and back in." as const,
    code: "UNAUTHORIZED" as const,
  };
}
