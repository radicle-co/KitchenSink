import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

import { withBasePath } from '@/lib/basePath';

// ⚠️ DELIBERATE — see docs/architecture/decisions/0001-sandbox-front-end-addressing.md
// Under sandbox path routing the app is served at /pr-{N}. Next.js STRIPS basePath from
// `nextUrl.pathname` BEFORE middleware runs (verified in next/dist/.../get-next-pathname-info), and
// Clerk's createRouteMatcher matches that stripped pathname — so the protected-route matcher stays
// ROOT-ANCHORED. Adding the /pr-{N} prefix here would make it never match the stripped path and
// SILENTLY turn protected routes public. The `config.matcher` below is evaluated against the full,
// un-stripped path, so IT (and only it) carries the optional `pr-…/` tolerance. Do not swap these
// two, and do not move to per-PR subdomains, without reading the ADR.
const isProtectedRoute = createRouteMatcher(['/profile(.*)', '/account(.*)', '/settings(.*)']);

export default clerkMiddleware(
    async (auth, req) => {
        if (isProtectedRoute(req)) {
            await auth.protect();
        }
    },
    {
        // Bounce signed-out users on protected routes to the app's OWN /sign-in (custom <SignIn> page),
        // not Clerk's hosted Account Portal (the default when signInUrl is unset). Matches the home
        // page's behavior and ClerkProvider's signInUrl in app/layout.tsx.
        //
        // The value MUST carry the basePath via withBasePath. clerkMiddleware builds this redirect as
        // an ABSOLUTE URL and emits it through NextResponse.redirect, which does NOT re-apply Next's
        // basePath (unlike next/navigation's server redirect(), which is why page.tsx uses a bare
        // path). signInUrl is a LOCATOR prop consumed as-is — same category as layout.tsx's
        // withBasePath('/sign-in'). A bare '/sign-in' would 404 under a preview basePath. withBasePath
        // is runtime-aware: a no-op '/sign-in' in production, '/pr-{N}/sign-in' under a preview.
        signInUrl: withBasePath('/sign-in'),
    },
);

export const config = {
    // Root-anchored. Next.js compiles `config.matcher` into the middleware manifest and AUTO-PREPENDS
    // the build-time `basePath`, so under a preview (basePath=/pr-{N}) these patterns match
    // `/pr-{N}/…` automatically — the asset/tunnel exclusions hold for both production and previews
    // with no manual `pr-…/` tolerance. (A leading `(?:…)?` is also invalid Next matcher syntax.)
    matcher: [
        // The bare root. The pattern below only matches a path WITH a segment after `/`; under a
        // preview basePath Next compiles it to `^/pr-{N}/(...)`, so the bare prefix `/pr-{N}` (no
        // trailing slash) would NOT match → clerkMiddleware is skipped → a server `auth()` call throws
        // "can't detect clerkMiddleware()" → 500. This explicit `/` entry (also in Clerk's recommended
        // matcher) covers the root in both production (`/`) and previews (`/pr-{N}`).
        '/',
        '/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|public/|sentry-tunnel).*)',
        '/(api|trpc)(.*)',
    ],
};
