// ⚠️ DELIBERATE — see docs/architecture/decisions/0001-sandbox-front-end-addressing.md
// This is the parse/decide core of the single-origin sandbox router. The CloudFront Function shell
// (router.cff.js) bundles it and performs the runtime side effects (updateRequestOrigin + bypass
// header). The URI is forwarded UNCHANGED — the per-PR app owns its /pr-{N} prefix (host-swap only).
// Do not "simplify" to a prefix-stripping proxy without reading the ADR.

/** Extract the `pr-{N}` KVS key from a request URI, or null if the path has no PR segment. */
export function parsePrKey(uri: string): string | null {
    const match = uri.match(/^\/(pr-[^/]+)(?:\/|$)/);

    return match ? match[1]! : null;
}

export interface RouteDecision {
    /** `origin` → forward to `host` (path unchanged); `notfound` → return 404. */
    kind: 'origin' | 'notfound';
    host?: string;
}

/**
 * Decide where a request routes: parse the `pr-{N}` segment, look its upstream host up via the
 * injected getter (CloudFront KVS at the edge; a map in tests), and route there — or 404 when the
 * path has no PR segment or the PR is unknown/closed.
 */
export async function resolveRoute(
    uri: string,
    getHost: (key: string) => Promise<string | undefined>,
): Promise<RouteDecision> {
    const key = parsePrKey(uri);

    if (!key) {
        return { kind: 'notfound' };
    }

    const host = await getHost(key);

    if (!host) {
        return { kind: 'notfound' };
    }

    return { kind: 'origin', host };
}
