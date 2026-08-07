# Deploy notes — Swift Tours

## Environment

Set these on Vercel (Project → Settings → Environment Variables):

| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon / public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only; never expose to the browser |
| `NEXT_PUBLIC_SITE_URL` | Canonical origin for share/embed snippets, e.g. `https://tours.example.com` — **no trailing slash**. Required once you use a custom domain so iframe/`embed.js` URLs are not the `*.vercel.app` host. |

After changing `NEXT_PUBLIC_SITE_URL`, redeploy so `/embed.js` embeds the new origin fallback.

## Embeds

- Public tours are embeddable at `/embed/{slug}` with optional chrome query params.
- Framing is allowed via `Content-Security-Policy: frame-ancestors *` on `/embed/*` (see `next.config.ts`). There is **no** `X-Frame-Options` on that route.
- Domain allowlisting for embeds is a future option; today any site may frame a public tour.
- Apply migration `0004_tour_view_referrer.sql` so embedded views can store a truncated referrer.

## Migrations

Apply new SQL under `supabase/migrations/` in order, then regenerate types:

```bash
npx supabase gen types typescript --project-id zqzctlekmvunyhdxihvf > types/database.ts
```
