import { withSentryConfig } from '@sentry/nextjs';
import type { NextConfig } from 'next';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { derivePreviewBasePath } from './src/lib/basePath';
import { derivePreviewAllowedOrigins } from './src/lib/serverActionOrigins';

// ⚠️ DELIBERATE — see docs/architecture/decisions/0001-sandbox-front-end-addressing.md
// Per-PR sandbox previews are served under /pr-{N} at one origin (single Clerk azp). basePath is
// build-time only, so each PR build bakes its own prefix here. Do NOT drop the prefix derivation
// or move to per-PR subdomains without reading the ADR.
const previewBasePath = derivePreviewBasePath(process.env);

// ⚠️ DELIBERATE — see docs/architecture/decisions/0001-sandbox-front-end-addressing.md
// The sandbox router host-swaps the origin, so behind it the Host this app terminates is the Vercel
// deployment host while the browser's Origin is the public preview host. Next 15 rejects that mismatch
// with a 500 on every Server Action; this is the documented reverse-proxy escape hatch. `undefined` in
// production, which keeps the prod config free of any CSRF allowlist. See serverActionOrigins.ts.
const previewAllowedOrigins = derivePreviewAllowedOrigins(process.env);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

const nextConfig: NextConfig = {
    reactStrictMode: true,
    typedRoutes: true,
    // These workspace packages ship TypeScript source (not pre-built JS), so Next must transpile them
    // rather than treating them as opaque node_modules. The recipe list/detail routes pull in the recipe
    // feature UI + its typed client, which in turn depend on the shared i18n and recipe-core packages.
    transpilePackages: [
        '@commise/features-account',
        '@commise/features-recipes',
        '@commise/features-core',
        // The design-system `Button` (and future @commise/ui components) ship as raw `./src` .tsx so the
        // bundler platform-resolves the `.native` leaf — Next must transpile it, not treat it as opaque.
        '@commise/ui',
        '@commise/i18n',
        '@kitchensink/recipe-service-client',
        '@kitchensink/recipe-core',
    ],
    // Those TS-source packages use NodeNext-style `.js` extensions on relative imports (e.g.
    // `export * from './profileClient.js'`), so webpack must resolve a `.js` specifier to its `.ts`/`.tsx`
    // source. Without this, `next build` fails with "Can't resolve './profileClient.js'".
    webpack: (config) => {
        config.resolve.extensionAlias = {
            ...(config.resolve.extensionAlias as Record<string, string[]> | undefined),
            '.js': ['.ts', '.tsx', '.js'],
            '.jsx': ['.tsx', '.jsx'],
        };

        return config;
    },
    // Standalone server output so the app can run off Vercel (ECS) later; traces the monorepo root.
    output: 'standalone',
    outputFileTracingRoot: repoRoot,
    ...(previewAllowedOrigins ? { experimental: { serverActions: { allowedOrigins: previewAllowedOrigins } } } : {}),
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
