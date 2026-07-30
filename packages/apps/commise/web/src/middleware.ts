import { clerkMiddleware } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

import { localeFromPathname, negotiateLocale, withLocalePath } from '@/lib/i18n';

// ⚠️ DELIBERATE — this middleware ONLY negotiates + redirects the LOCALE (Next.js App Router i18n:
// `/{locale}/…`). Route PROTECTION is done at the RESOURCE — each protected page reads `auth()` and
// redirects unauthenticated users to `/{locale}/sign-in`. It is deliberately NOT done here via
// `createRouteMatcher` + `auth.protect()`: Clerk deprecated that middleware-gate pattern after a
// middleware route-matching BYPASS advisory (GHSA-vqx2-fgx2-5wq9, 2026-04), so a middleware-only gate
// would be both deprecated and unsafe. `clerkMiddleware` still WRAPS this so server components' `auth()`
// has its context; the callback just does the locale redirect.
//
// Next STRIPS the build-time basePath from `nextUrl.pathname` before middleware runs, so the locale check
// operates on the un-prefixed path (works in both subdomain and legacy path-routed serving). See
// docs/architecture/decisions/0001-sandbox-front-end-addressing.md.
export default clerkMiddleware((_auth, req) => {
    const { pathname } = req.nextUrl;

    // API/tRPC are not locale-namespaced — never locale-redirect them (would 404 the route handler).
    if (pathname.startsWith('/api') || pathname.startsWith('/trpc')) {
        return NextResponse.next();
    }

    // Already locale-prefixed → pass through.
    if (localeFromPathname(pathname)) {
        return NextResponse.next();
    }

    // Locale-less page request → redirect to the negotiated locale's path.
    const url = req.nextUrl.clone();
    url.pathname = withLocalePath(pathname, negotiateLocale(req.headers.get('accept-language')));

    return NextResponse.redirect(url);
});

export const config = {
    // Root-anchored. Next.js compiles `config.matcher` into the middleware manifest and AUTO-PREPENDS the
    // build-time `basePath`, so under a legacy path-routed preview (basePath=/pr-{N}) these patterns match
    // `/pr-{N}/…` automatically; under subdomain serving the basePath is empty. Excludes Next internals,
    // static assets, and the Sentry tunnel so they are never locale-redirected.
    matcher: [
        '/',
        '/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|public/|sentry-tunnel).*)',
        '/(api|trpc)(.*)',
    ],
};
