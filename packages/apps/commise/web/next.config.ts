import { withSentryConfig } from '@sentry/nextjs';
import type { NextConfig } from 'next';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { derivePreviewBasePath } from './src/lib/base-path';

// ⚠️ DELIBERATE — see docs/architecture/decisions/0001-sandbox-front-end-addressing.md
// Per-PR sandbox previews are served under /pr-{N} at one origin (single Clerk azp). basePath is
// build-time only, so each PR build bakes its own prefix here. Do NOT drop the prefix derivation
// or move to per-PR subdomains without reading the ADR.
const previewBasePath = derivePreviewBasePath(process.env);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

const nextConfig: NextConfig = {
    reactStrictMode: true,
    typedRoutes: true,
    // Standalone server output so the app can run off Vercel (ECS) later; traces the monorepo root.
    output: 'standalone',
    outputFileTracingRoot: repoRoot,
    ...(previewBasePath ? { basePath: previewBasePath } : {}),
    // Surface the prefix to runtime code (Clerk middleware, base-path helper) — `basePath` is not
    // readable at runtime. Empty string in production.
    env: { NEXT_PUBLIC_BASE_PATH: previewBasePath },
};

export default withSentryConfig(nextConfig, {
    org: 'radicle-co',
    project: 'commise-web',
    // Source-map upload at build (Vercel). Token is a build-time env var, never committed (U11).
    authToken: process.env['SENTRY_AUTH_TOKEN'],
    // Proxy Sentry through the app to dodge ad blockers. Kept out of the Clerk matcher (see middleware).
    tunnelRoute: '/sentry-tunnel',
    widenClientFileUpload: true,
    silent: !process.env['CI'],
});
