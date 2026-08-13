/**
 * Service-role Supabase client — SERVER ONLY.
 *
 * SECURITY: This module imports `server-only` so any accidental client-bundle
 * import fails the build. Never re-export `createAdminClient` from a file that
 * is imported by Client Components. Prefer `@/lib/supabase/server` (anon +
 * cookies) for user-scoped work; use this only for staging workers that must
 * bypass RLS after ownership was already verified on the request path.
 */

import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set.");
  }
  if (!key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set (required for staging workers).",
    );
  }

  // Explicit guard: the service role key must never appear under NEXT_PUBLIC_*.
  if (key === process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY must not equal the anon key.",
    );
  }

  return createSupabaseClient<Database>(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
