import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

import { BASE_PATH } from '@/lib/base-path';

// ⚠️ DELIBERATE — see docs/architecture/decisions/0001-sandbox-front-end-addressing.md
// Under sandbox path routing the app is served at /pr-{N}. Next does NOT apply `basePath` to the
// middleware matcher, so protection patterns are built WITH the runtime prefix (BASE_PATH) and the
// static `config.matcher` is made prefix-tolerant. Dropping the prefix here silently turns protected
// routes public — do NOT "simplify" the matcher back to root-anchored patterns without reading the ADR.
const isProtectedRoute = createRouteMatcher([
    `${BASE_PATH}/profile(.*)`,
    `${BASE_PATH}/account(.*)`,
    `${BASE_PATH}/settings(.*)`,
]);

export default clerkMiddleware(async (auth, req) => {
    if (isProtectedRoute(req)) {
        await auth.protect();
    }
});

export const config = {
    // Static (build-analyzed, so it cannot interpolate the per-PR prefix) and prefix-tolerant: the
    // optional `pr-…/` segment lets this one value serve both production (no prefix) and previews
    // (/pr-{N}). `sentry-tunnel` stays excluded so Clerk never intercepts Sentry's tunnel route.
    matcher: [
        '/((?!(?:pr-[^/]+/)?(?:_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|public/|sentry-tunnel)).*)',
        '/(?:pr-[^/]+/)?(api|trpc)(.*)',
    ],
};
