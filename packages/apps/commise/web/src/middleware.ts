import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

// ⚠️ DELIBERATE — see docs/architecture/decisions/0001-sandbox-front-end-addressing.md
// Under sandbox path routing the app is served at /pr-{N}. Next.js STRIPS basePath from
// `nextUrl.pathname` BEFORE middleware runs (verified in next/dist/.../get-next-pathname-info), and
// Clerk's createRouteMatcher matches that stripped pathname — so the protected-route matcher stays
// ROOT-ANCHORED. Adding the /pr-{N} prefix here would make it never match the stripped path and
// SILENTLY turn protected routes public. The `config.matcher` below is evaluated against the full,
// un-stripped path, so IT (and only it) carries the optional `pr-…/` tolerance. Do not swap these
// two, and do not move to per-PR subdomains, without reading the ADR.
const isProtectedRoute = createRouteMatcher(['/profile(.*)', '/account(.*)', '/settings(.*)']);

export default clerkMiddleware(async (auth, req) => {
    if (isProtectedRoute(req)) {
        await auth.protect();
    }
});

export const config = {
    // Static (build-analyzed) and prefix-tolerant: the optional `pr-…/` segment lets this one value
    // serve both production (no prefix) and previews (/pr-{N}) — it is matched against the full path,
    // so without the tolerance `/pr-{N}/_next/*` and `/pr-{N}/sentry-tunnel` would not be excluded and
    // middleware would run on every asset + intercept Sentry's tunnel.
    matcher: [
        '/((?!(?:pr-[^/]+/)?(?:_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|public/|sentry-tunnel)).*)',
        '/(?:pr-[^/]+/)?(api|trpc)(.*)',
    ],
};
