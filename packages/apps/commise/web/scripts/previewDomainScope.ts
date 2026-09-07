// ⚠️ DELIBERATE — see docs/architecture/decisions/0001-sandbox-front-end-addressing.md ("Update
// (2026-07-28)") and docs/architecture/decisions/0005-environment-tagging-and-pr-cleanup.md.
//
// The SINGLE authority on what a per-PR preview owns in DNS and at Vercel, shared by BOTH halves of a
// preview's public-address lifecycle: `createPreviewDomain.ts` (setup) and `teardownPreviewDomain.ts`
// (reclaim). It exists so there is exactly ONE `pr-{N}` matcher for the preview address — ADR-0005 is
// explicit that a second, drifting copy of a scope predicate is the failure mode to avoid, and a creation
// path that could write a host the teardown path cannot recognise would strand it forever.
//
// Patterns: a Specification pair (`previewHostForPrToken` / `prTokenForPreviewRecordName`) plus the Ports
// (`Route53Sender`, `HttpSender`) the two Commands' Adapters are written against, so every AWS/Vercel call
// is injectable and every test runs against a double.
//
// ⛔ SCOPE IS THE SECURITY PROPERTY. The preview zone also holds PERMANENT records — the apex
// `sandbox.commise.app`, the `*.sandbox` wildcard alias, ACM validation CNAMEs, and
// `identity.sandbox.commise.app`, the single shared identity service EVERY preview authenticates against
// (ADR-0005: `Environment=global`, never `pr-{N}`). An over-broad host match would be far worse than the
// dangling record teardown fixes or the missing record creation adds, so: the only host either Command
// will ever act on is `pr-{N}.<zone>` with `pr-{N}` as the exact FIRST LABEL, and every adapter
// re-asserts that itself (`requirePreviewHost`) rather than trusting its caller.
import type { Route53Client } from '@aws-sdk/client-route-53';

/** A PR's DNS label: `pr-` and digits, nothing else. Anchored — this is the whole trust boundary. */
export const PR_TOKEN = /^pr-[0-9]+$/u;

export const VERCEL_API_BASE_URL = 'https://api.vercel.com';

/** Raised when a token, zone or hostname is outside the `pr-{N}` scope a preview command may act on. */
export class PreviewScopeError extends Error {
    public constructor(message: string) {
        super(message);
        this.name = 'PreviewScopeError';
        Object.setPrototypeOf(this, PreviewScopeError.prototype);
    }
}

/**
 * Type guard for {@link PreviewScopeError}.
 *
 * @param error - The value to test.
 * @returns `true` when it is a scope refusal.
 */
export function isPreviewScopeError(error: unknown): error is PreviewScopeError {
    return error instanceof PreviewScopeError;
}

/** Just the `send` surface of the Route 53 client, so callers can inject a double. */
export interface Route53Sender {
    readonly send: Route53Client['send'];
}

/** The minimal HTTP surface used against the Vercel REST API; `globalThis.fetch` satisfies it. */
export interface HttpResponseLike {
    readonly ok: boolean;
    readonly status: number;
    text(): Promise<string>;
}

/** @see HttpResponseLike */
export type HttpSender = (
    url: string,
    init: {
        readonly method: string;
        readonly headers: Readonly<Record<string, string>>;
        /** JSON payload, for the Vercel calls that have one (domain binding, deployment alias). */
        readonly body?: string;
    },
) => Promise<HttpResponseLike>;

export interface VercelProjectConfig {
    readonly token: string;
    readonly projectId: string;
    /** Absent for a personal (non-team) project. */
    readonly teamId?: string | undefined;
}

/**
 * Normalize a DNS name for comparison: trimmed, lower-cased, trailing root dot removed.
 *
 * Route 53 returns names fully-qualified and lower-cased; callers may pass either form.
 *
 * @param name - A hostname or Route 53 record name.
 * @returns The comparable form.
 */
export const normalizeDnsName = (name: string): string => name.trim().toLowerCase().replace(/\.$/u, '');

/**
 * Validate the preview zone previews are carved out of (e.g. `sandbox.commise.app`).
 *
 * @param previewZone - The zone suffix.
 * @returns The normalized zone.
 * @throws PreviewScopeError When it is empty, single-label, or not a bare hostname — any of which would
 *   let a constructed host land somewhere other than the intended zone.
 */
export const requirePreviewZone = (previewZone: string): string => {
    const zone = normalizeDnsName(previewZone);

    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/u.test(zone)) {
        throw new PreviewScopeError(`preview-domain: invalid preview zone '${previewZone}'`);
    }

    return zone;
};

/**
 * The ONE hostname a PR owns.
 *
 * @param prToken - The PR token, which must be exactly `pr-{N}`.
 * @param previewZone - The preview zone, e.g. `sandbox.commise.app`.
 * @returns `pr-{N}.<zone>`, normalized.
 * @throws PreviewScopeError When the token is not exactly `pr-{N}` or the zone is malformed. Refusing
 *   here is what stops a stray argument (`sandbox`, `*`, an empty string) from resolving to a shared host.
 */
export function previewHostForPrToken(prToken: string, previewZone: string): string {
    if (!PR_TOKEN.test(prToken)) {
        throw new PreviewScopeError(`preview-domain: refusing to act on a non pr-{N} token: '${prToken}'`);
    }

    return `${prToken}.${requirePreviewZone(previewZone)}`;
}

/**
 * The inverse: which PR (if any) owns a Route 53 record name.
 *
 * Ownership is decided by LABEL EQUALITY — the record must be `<label>.<zone>` with `<label>` exactly
 * `pr-{N}`. That is stricter than the `pr-{N}` / `pr-{N}-…` rule teardown uses for resource *names*
 * (`.github/scripts/pr-scope.sh`), because a preview host is only ever the bare token; and being an
 * equality rather than a prefix is what makes `pr-1` structurally unable to claim `pr-15`. The apex, the
 * `*` wildcard (which Route 53 renders as `\052`), ACM validation records and `identity.sandbox.…` all
 * fail it.
 *
 * @param recordName - A Route 53 record name.
 * @param previewZone - The preview zone.
 * @returns The owning `pr-{N}` token, or `undefined` when no PR owns the record.
 */
export function prTokenForPreviewRecordName(recordName: string, previewZone: string): string | undefined {
    const zone = requirePreviewZone(previewZone);
    const name = normalizeDnsName(recordName);
    const suffix = `.${zone}`;

    if (!name.endsWith(suffix)) {
        return undefined;
    }

    const label = name.slice(0, -suffix.length);

    return PR_TOKEN.test(label) ? label : undefined;
}

/**
 * Second, INDEPENDENT scope guard, asserted at each point of action.
 *
 * `previewHostForPrToken` already constrains the happy path; this exists so a direct caller (a future
 * script, a mistaken argument order) still cannot aim a write or a delete at the apex, the wildcard, or
 * the shared identity host. Defence in depth is warranted because the blast radius is every preview at
 * once.
 *
 * It takes the ZONE, not just the host, and that is the whole guard. An earlier form checked only the
 * first label, which kept the promise for hosts INSIDE the zone and broke it for `pr-{N}` hosts outside it:
 * Route 53 refuses a name outside the hosted zone on its own, but nothing constrains the hostname a Vercel
 * domain or alias call is sent, so `pr-1.attacker.example` walked straight through to that API. The
 * predicate is {@link prTokenForPreviewRecordName} — the SAME specification the reaper uses to decide what a
 * PR owns — so there is one matcher (ADR-0005), not a drifting second copy.
 *
 * @param host - The hostname about to be acted on.
 * @param previewZone - The preview zone the host must sit DIRECTLY under.
 * @returns The normalized host.
 * @throws PreviewScopeError When the host is not exactly `pr-{N}.<zone>`, or the zone is malformed.
 */
export const requirePreviewHost = (host: string, previewZone: string): string => {
    const normalized = normalizeDnsName(host);

    if (prTokenForPreviewRecordName(normalized, previewZone) === undefined) {
        throw new PreviewScopeError(
            `preview-domain: refusing to act on '${host}' — not a pr-{N} host directly under '${previewZone}'`,
        );
    }

    return normalized;
};

/**
 * Build a Vercel REST URL, applying the team scope when the project belongs to a team.
 *
 * @param path - The absolute API path, already percent-encoded where needed.
 * @param config - The Vercel project config.
 * @returns The full URL.
 */
export const vercelApiUrl = (path: string, config: VercelProjectConfig): string => {
    const url = new URL(path, VERCEL_API_BASE_URL);

    if (config.teamId) {
        url.searchParams.set('teamId', config.teamId);
    }

    return url.toString();
};

/**
 * Read a required environment variable.
 *
 * @param key - The variable name.
 * @returns Its value.
 * @throws Error When unset or blank — a preview-address command must fail loudly rather than silently
 *   skip one of its halves.
 */
export const requireEnv = (key: string): string => {
    const value = process.env[key];

    if (!value) {
        throw new Error(`preview-domain: ${key} is required`);
    }

    return value;
};
