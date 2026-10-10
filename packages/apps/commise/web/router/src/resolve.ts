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

/**
 * Extract the `pr-{N}` KVS key from the request Host's leftmost label (subdomain routing —
 * `pr-{N}.sandbox.commise.app`), or null when the host is the bare apex or its leftmost label is not a
 * `pr-<digits>` label. This is the migration target: previews addressed by subdomain instead of path.
 *
 * The label is `pr-<digits>` ONLY (digits, matching the backend's `buildPreviewAzpPattern` boundary and
 * real PR numbers), anchored to a FULL leftmost label — `pr-123-x` is a different label, not PR 123.
 * Host is lower-cased (DNS is case-insensitive) and any `:port` suffix stripped before matching. Pure.
 */
export function parsePrKeyFromHost(host: string | undefined): string | null {
    if (!host) {
        return null;
    }

    const hostname = host.toLowerCase().split(':', 1)[0]!;
    const match = hostname.match(/^(pr-\d+)\./);

    return match ? match[1]! : null;
}

export interface RouteDecision {
    /** `origin` → forward to `host` (path unchanged); `notfound` → return 404. */
    kind: 'origin' | 'notfound';
    host?: string;
}

/**
 * The routing-relevant slice of the viewer request: its URI and (for subdomain routing) its Host.
 *
 * @notWireShape A CloudFront Function EVENT, not one of our services' wire shapes. This module compiles into
 *   `router.cff.js` and runs inside CloudFront, where the input is AWS's `event.request` — an API we do not
 *   serve and could not publish a contract for (CODING_STANDARDS §15.3). It is narrowed to the two fields the
 *   pure decision reads so the routing rule is testable without fabricating a whole CFF event.
 */
export interface RouteRequest {
    readonly uri: string;
    readonly host?: string;
}

/**
 * Decide where a request routes. The `pr-{N}` key is taken from the request Host's leftmost label first
 * (subdomain routing — the migration target) and falls back to the URI's `/pr-{N}` path segment (legacy
 * path routing). Both resolve against the SAME injected host getter (CloudFront KVS at the edge; a map in
 * tests), so during the shared-sandbox cutover BOTH addressing modes work and neither breaks. Returns a
 * 404 decision when neither host nor path carries a PR segment or the PR is unknown/closed.
 *
 * Host-first is deterministic on purpose: a subdomain request that also happens to carry a `/pr-{M}` path
 * resolves by its host, never the path.
 */
export async function resolveRoute(
    request: RouteRequest,
    getHost: (key: string) => Promise<string | undefined>,
): Promise<RouteDecision> {
    const key = parsePrKeyFromHost(request.host) ?? parsePrKey(request.uri);

    if (!key) {
        return { kind: 'notfound' };
    }

    const host = await getHost(key);

    if (!host) {
        return { kind: 'notfound' };
    }

    return { kind: 'origin', host };
}

/**
 * The argument for `cf.updateRequestOrigin` — `customOriginConfig` (port/protocol/SNI), not the
 * top-level `originSslProtocols` CloudFormation field, and `hostHeader` (which also drives SNI) set
 * to the target host so Vercel TLS-routes the right deployment. Extracted so the shape is unit-tested
 * (the live `cf` API surface itself is validated by the U4 deploy smoke).
 */
export function buildOriginUpdate(host: string): {
    domainName: string;
    customOriginConfig: { port: number; protocol: string; sslProtocols: string[] };
    hostHeader: string;
} {
    return {
        domainName: host,
        customOriginConfig: { port: 443, protocol: 'https', sslProtocols: ['TLSv1.2'] },
        hostHeader: host,
    };
}
