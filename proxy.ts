import { type NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     * - /tour and /tour/* (public viewer — no auth session refresh)
     * - /embed and /embed/* (chromeless embeds — no auth session refresh)
     * - common image extensions
     */
    "/((?!_next/static|_next/image|favicon.ico|tour(?:/|$)|embed(?:\\.js|/|$)|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
