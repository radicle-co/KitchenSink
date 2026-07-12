// ⚠️ DELIBERATE — see docs/architecture/decisions/0001-sandbox-front-end-addressing.md
// Sandbox PR previews are served under a path prefix (/pr-{N}) behind one origin so they share a
// single Clerk azp. `basePath` is build-time only, so each PR build bakes its own prefix and the
// app must carry it on every URL Next does NOT auto-prefix (Clerk URL props, client redirects).
// Do not remove the prefixing or switch to per-PR subdomains without reading the ADR.

/**
 * Build-time derivation of the per-PR base path. On Vercel the PR id comes from
 * `VERCEL_GIT_PULL_REQUEST_ID`; off-Vercel an explicit `PREVIEW_BASE_PATH` wins. Production
 * (neither set) gets an empty string → no basePath. Consumed by `next.config.ts`.
 *
 * ADR-0001 subdomain cutover: when `SANDBOX_PREVIEW_MODE` is exactly `subdomain`, previews are served at
 * the ROOT of `pr-{N}.sandbox.commise.app` (topologically identical to production), so this returns `''`
 * regardless of the PR id — which makes basePath, the SSO-callback redirect, and every `withBasePath(…)`
 * call degrade to a no-op automatically. Any other value (unset, `path`, a typo) is fail-safe and keeps
 * the current path-routing posture. The default MUST stay path routing until the human-gated cutover.
 */
export function derivePreviewBasePath(env: Record<string, string | undefined> = process.env): string {
    if (env['SANDBOX_PREVIEW_MODE'] === 'subdomain') {
        return '';
    }

    const explicit = env['PREVIEW_BASE_PATH'];

    if (explicit) {
        return explicit;
    }

    const prId = env['VERCEL_GIT_PULL_REQUEST_ID'];

    return prId ? `/pr-${prId}` : '';
}

/**
 * The runtime base path, inlined at build via `next.config.ts` `env`. Empty in production. Use this
 * (not `basePath`, which is not readable at runtime) when constructing paths for Clerk URL props or
 * raw client redirects that Next does not prefix automatically.
 */
export const BASE_PATH = process.env['NEXT_PUBLIC_BASE_PATH'] ?? '';

/** Prefix an absolute app path with the current base path. No-op when there is no prefix. */
export function withBasePath(path: string): string {
    if (!BASE_PATH) {
        return path;
    }

    return `${BASE_PATH}${path.startsWith('/') ? path : `/${path}`}`;
}
