import { withSentryConfig } from '@sentry/nextjs';
import type { NextConfig } from 'next';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { derivePreviewBasePath } from './src/lib/basePath';

// ⚠️ DELIBERATE — see docs/architecture/decisions/0001-sandbox-front-end-addressing.md
// Per-PR sandbox previews are served under /pr-{N} at one origin (single Clerk azp). basePath is
// build-time only, so each PR build bakes its own prefix here. Do NOT drop the prefix derivation
// or move to per-PR subdomains without reading the ADR.
const previewBasePath = derivePreviewBasePath(process.env);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

const nextConfig: NextConfig = {
    reactStrictMode: true,
    typedRoutes: true,
    // @commise/features-account ships TypeScript source (like the other @commise/features-* packages),
    // so Next must transpile it rather than treating it as pre-built node_modules JS.
    transpilePackages: ['@commise/features-account'],
    // Standalone server output so the app can run off Vercel (ECS) later; traces the monorepo root.
    output: 'standalone',
    outputFileTracingRoot: repoRoot,
    ...(previewBasePath ? { basePath: previewBasePath } : {}),
    // Surface the prefix to runtime code (Clerk middleware, base-path helper) — `basePath` is not
    // readable at runtime. Empty string in production.
    env: { NEXT_PUBLIC_BASE_PATH: previewBasePath },
    // ⚠️ DELIBERATE — re-home the BARE root onto the preview basePath. After OAuth sign-in, Clerk's
    // SSO-callback completes on a full page load before its Next router is wired, so it navigates
    // `forceRedirectUrl` via raw window.location (clerk-js `navigate()` falls to `windowNavigate` when
    // no routerPush exists) instead of the basePath-aware router the password flow uses. A bare '/'
    // (correct for the router branch — it prepends the prefix once) becomes a raw `https://host/`,
    // dropping /pr-{N} and 404ing. We can't satisfy both branches with one `forceRedirectUrl` value
    // (absolute/prefixed values double-prefix in the router branch — clerk-js `M()` hands the router
    // the full URL and Next re-adds basePath), so we fix the DESTINATION here instead. `basePath: false`
    // matches the literal bare root (Next would otherwise prepend the prefix to the source); the query
    // (e.g. ?__clerk_handshake) is forwarded automatically, so the dev-instance handshake completes
    // under the prefix. No-op in production (no basePath; prod Clerk has no dev handshake).
    ...(previewBasePath
        ? {
              redirects: async () => [
                  { source: '/', destination: `${previewBasePath}/`, basePath: false as const, permanent: false },
              ],
          }
        : {}),
};

export default withSentryConfig(nextConfig, {
    org: 'radicle-co',
    project: 'commise-web',
    // Source-map upload at build (Vercel). Token is a build-time env var, never committed (U11).
    authToken: process.env['SENTRY_AUTH_TOKEN'],
    // Tunnel Sentry through a same-origin path to dodge ad blockers — PRODUCTION ONLY. Under a preview
    // basePath the single-origin sandbox router can't route a bare /sentry-tunnel POST (there's no
    // pr-{N} segment to pick the app), and Sentry's injected rewrite doesn't reliably honor basePath
    // (getsentry/sentry-javascript#8293). Previews are internal + low-volume, so we skip the tunnel and
    // let the SDK post direct to Sentry there rather than fight basePath. Kept out of the Clerk matcher.
    ...(previewBasePath ? {} : { tunnelRoute: '/sentry-tunnel' }),
    widenClientFileUpload: true,
    silent: !process.env['CI'],
});
