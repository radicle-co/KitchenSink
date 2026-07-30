// ⚠️ DELIBERATE — see docs/architecture/decisions/0001-sandbox-front-end-addressing.md
// A sandbox preview is served through the CloudFront router, whose origin request policy is
// ALL_VIEWER_EXCEPT_HOST_HEADER: the Host the Next app terminates is the per-PR *Vercel deployment*
// host, not the public preview origin the browser used. Next 15 rejects a Server Action whose `Origin`
// does not equal that Host (`isCsrfOriginAllowed` in next/dist/server/app-render/csrf-protection) with a
// 500 BEFORE it even looks the action id up, so EVERY Server Action fails behind the router. The
// documented escape hatch for exactly this ("you have a reverse proxy in front of your app") is
// `experimental.serverActions.allowedOrigins`, which this module derives.
//
// Scope, deliberately: ONE host — the public origin THIS build is served from. Never a wildcard. Next
// does support `*` (one label) and `**` (trailing labels) here, but a pattern would let any other
// preview's origin drive this build's actions, which buys nothing (the host is known at build time).

/**
 * The shared sandbox preview domain. Previews are addressed as `pr-{N}.{SANDBOX_PREVIEW_DOMAIN}`
 * (subdomain mode) or `{SANDBOX_PREVIEW_DOMAIN}/pr-{N}` (the legacy path form). Hard-coded here for the
 * same reason `sandbox-web-preview.yml` hard-codes it: it is the router's single deployed identity, not
 * a per-build input.
 */
export const SANDBOX_PREVIEW_DOMAIN = 'sandbox.commise.app';

/** PR ids are decimal digits. Anchored so nothing can smuggle a label separator or a Next glob in. */
const PR_ID_PATTERN = /^\d+$/;

/**
 * The hosts allowed to drive this build's Server Actions despite not matching the proxied `Host`, or
 * `undefined` when there is nothing to allow (production, or a build with no PR context) so the emitted
 * Next config carries no allowlist at all.
 *
 * Mirrors `derivePreviewBasePath`'s switch: `SANDBOX_PREVIEW_MODE === 'subdomain'` means the preview is
 * served at the root of `pr-{N}.sandbox.commise.app`; any other value (unset, `path`, a typo) fail-safes
 * to the path-routed apex, `sandbox.commise.app`. A PR id that is not decimal digits yields `undefined`
 * rather than an unbounded host — this value is a CSRF allowlist, so it fails closed. Pure.
 */
export function derivePreviewAllowedOrigins(env: Record<string, string | undefined>): string[] | undefined {
    const prId = env['VERCEL_GIT_PULL_REQUEST_ID'];

    if (!prId || !PR_ID_PATTERN.test(prId)) {
        return undefined;
    }

    if (env['SANDBOX_PREVIEW_MODE'] === 'subdomain') {
        return [`pr-${prId}.${SANDBOX_PREVIEW_DOMAIN}`];
    }

    return [SANDBOX_PREVIEW_DOMAIN];
}
