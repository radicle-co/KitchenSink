// ⚠️ DELIBERATE — see docs/architecture/decisions/0001-sandbox-front-end-addressing.md ("Update
// (2026-07-28)") and docs/architecture/decisions/0005-environment-tagging-and-pr-cleanup.md.
//
// Teardown of a per-PR preview's PUBLIC ADDRESS — the half of ADR-0005 that CloudFormation does not own.
//
// A sandbox preview is reachable because two records outside CloudFormation agree: a Route 53 CNAME
// `pr-{N}.sandbox.commise.app → cname.vercel-dns.com`, and a Vercel project-domain binding that claims
// that hostname (plus a per-deployment alias, still created by hand — see the ADR). `teardown-sandbox-pr.sh`
// deletes stacks, log groups and ECR repos; it knew nothing about either of these, so a closed PR left the
// CNAME pointing at a provider where the name is no longer claimed — a textbook subdomain-takeover vector.
//
// Patterns: a Specification pair (`previewHostForPrToken` / `prTokenForPreviewRecordName`) that is the
// single authority on what a PR owns in DNS, two thin Adapters over the Route 53 and Vercel APIs, and a
// Command (`teardownPreviewDomain`) that composes them in the one order that is safe to be interrupted.
//
// ⛔ SCOPE IS THE SECURITY PROPERTY. The preview zone also holds PERMANENT records — the apex
// `sandbox.commise.app`, the `*.sandbox` wildcard alias, and `identity.sandbox.commise.app`, the single
// shared identity service EVERY preview authenticates against (ADR-0005: `Environment=global`, never
// `pr-{N}`). An over-broad host match here would be far worse than the dangling record it fixes, so:
// the only host this module will ever act on is `pr-{N}.<zone>` with `pr-{N}` as the exact FIRST LABEL,
// and both adapters re-assert that themselves rather than trusting their caller.
import {
    ChangeResourceRecordSetsCommand,
    ListResourceRecordSetsCommand,
    type ResourceRecordSet,
    type Route53Client,
} from '@aws-sdk/client-route-53';

/** A PR's DNS label: `pr-` and digits, nothing else. Anchored — this is the whole trust boundary. */
const PR_TOKEN = /^pr-[0-9]+$/u;

const VERCEL_API_BASE_URL = 'https://api.vercel.com';

/** Raised when a token, zone or hostname is outside the `pr-{N}` scope a teardown may act on. */
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
    init: { readonly method: string; readonly headers: Readonly<Record<string, string>> },
) => Promise<HttpResponseLike>;

export interface VercelProjectConfig {
    readonly token: string;
    readonly projectId: string;
    /** Absent for a personal (non-team) project. */
    readonly teamId?: string | undefined;
}

export type DnsOutcome = 'deleted' | 'absent';
export type VercelOutcome = 'released' | 'absent';

/**
 * Normalize a DNS name for comparison: trimmed, lower-cased, trailing root dot removed.
 *
 * Route 53 returns names fully-qualified and lower-cased; callers may pass either form.
 *
 * @param name - A hostname or Route 53 record name.
 * @returns The comparable form.
 */
const normalizeDnsName = (name: string): string => name.trim().toLowerCase().replace(/\.$/u, '');

/**
 * Validate the preview zone previews are carved out of (e.g. `sandbox.commise.app`).
 *
 * @param previewZone - The zone suffix.
 * @returns The normalized zone.
 * @throws PreviewScopeError When it is empty, single-label, or not a bare hostname — any of which would
 *   let a constructed host land somewhere other than the intended zone.
 */
const requirePreviewZone = (previewZone: string): string => {
    const zone = normalizeDnsName(previewZone);

    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/u.test(zone)) {
        throw new PreviewScopeError(`teardown-preview-domain: invalid preview zone '${previewZone}'`);
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
        throw new PreviewScopeError(`teardown-preview-domain: refusing to act on a non pr-{N} token: '${prToken}'`);
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
 * script, a mistaken argument order) still cannot aim a delete at the apex, the wildcard, or the shared
 * identity host. Defence in depth is warranted because the blast radius is every preview at once.
 *
 * @param host - The hostname about to be acted on.
 * @throws PreviewScopeError When its first label is not exactly `pr-{N}`.
 */
const requirePreviewHost = (host: string): string => {
    const normalized = normalizeDnsName(host);
    const [label, ...rest] = normalized.split('.');

    if (label === undefined || !PR_TOKEN.test(label) || rest.length < 2) {
        throw new PreviewScopeError(
            `teardown-preview-domain: refusing to act on '${host}' — not a pr-{N} preview host`,
        );
    }

    return normalized;
};

/**
 * Delete the preview's Route 53 record(s), idempotently.
 *
 * `ListResourceRecordSets` starts at or AFTER the requested name, so the returned page routinely
 * contains the next records in the zone; only rrsets whose name is EXACTLY the preview host are put in
 * the change batch. An already-absent record is a success — a PR that never got a preview domain, and a
 * re-run of a completed teardown, must both be green or the real signal gets ignored.
 *
 * @param client - Route 53 client (or a double).
 * @param hostedZoneId - The zone holding the preview records.
 * @param previewHost - The `pr-{N}.<zone>` host to remove.
 * @returns `'deleted'` when a record was removed, `'absent'` when there was nothing to remove.
 * @throws PreviewScopeError When `previewHost` is not a `pr-{N}` preview host.
 * @sideEffect Deletes DNS records in Route 53.
 */
export async function deletePreviewDnsRecord(
    client: Route53Sender,
    hostedZoneId: string,
    previewHost: string,
): Promise<DnsOutcome> {
    const host = requirePreviewHost(previewHost);
    const startRecordName = `${host}.`;

    const { ResourceRecordSets = [] } = await client.send(
        new ListResourceRecordSetsCommand({
            HostedZoneId: hostedZoneId,
            StartRecordName: startRecordName,
            MaxItems: 10,
        }),
    );

    const owned = ResourceRecordSets.filter(
        (recordSet: ResourceRecordSet) => normalizeDnsName(recordSet.Name ?? '') === host,
    );

    if (owned.length === 0) {
        return 'absent';
    }

    await client.send(
        new ChangeResourceRecordSetsCommand({
            HostedZoneId: hostedZoneId,
            ChangeBatch: {
                Comment: `ADR-0005 teardown: ${host}`,
                Changes: owned.map((recordSet: ResourceRecordSet) => ({
                    Action: 'DELETE' as const,
                    ResourceRecordSet: recordSet,
                })),
            },
        }),
    );

    return 'deleted';
}

/**
 * Release the Vercel project-domain binding for the preview host, idempotently.
 *
 * Removing the project domain is what un-claims the hostname (and drops the per-deployment alias bound
 * through it). A 404 means it was never added, or is already gone — success. Anything else throws with
 * the status and body, because a SILENT failure here is the dangerous outcome: it is what would leave
 * the name claimable while the operator believes teardown succeeded.
 *
 * @param http - `fetch`, or a double.
 * @param config - Vercel token, project and (optional) team.
 * @param previewHost - The `pr-{N}.<zone>` host to release.
 * @returns `'released'` or `'absent'`.
 * @throws PreviewScopeError When `previewHost` is not a `pr-{N}` preview host.
 * @sideEffect Removes a domain from the Vercel project.
 */
export async function releaseVercelPreviewDomain(
    http: HttpSender,
    config: VercelProjectConfig,
    previewHost: string,
): Promise<VercelOutcome> {
    const host = requirePreviewHost(previewHost);
    const url = new URL(
        `/v9/projects/${encodeURIComponent(config.projectId)}/domains/${encodeURIComponent(host)}`,
        VERCEL_API_BASE_URL,
    );

    if (config.teamId) {
        url.searchParams.set('teamId', config.teamId);
    }

    const response = await http(url.toString(), {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${config.token}` },
    });

    if (response.status === 404) {
        return 'absent';
    }

    if (!response.ok) {
        throw new Error(
            `teardown-preview-domain: Vercel refused to release ${host} — ${response.status} ${await response.text()}`,
        );
    }

    return 'released';
}

export interface PreviewDomainTeardownDeps {
    readonly route53: Route53Sender;
    readonly http: HttpSender;
}

export interface PreviewDomainTeardownOptions {
    readonly prToken: string;
    readonly previewZone: string;
    readonly hostedZoneId: string;
    readonly vercel: VercelProjectConfig;
}

export interface PreviewDomainTeardownResult {
    readonly host: string;
    readonly dns: DnsOutcome;
    readonly vercel: VercelOutcome;
}

/**
 * Remove a preview's public address: DNS first, then the Vercel claim.
 *
 * **The order is the safety property.** The takeover window is "CNAME still points at
 * `cname.vercel-dns.com` while no Vercel account claims the name". Deleting DNS first means an
 * interrupted run — a throttle, a cancelled job, an expired token — can only ever leave the SAFE
 * half-state (domain still claimed, name no longer resolving). Doing it the other way round would
 * manufacture the exact vector this exists to close, so a DNS failure aborts before Vercel is touched.
 *
 * @param deps - Injected Route 53 and HTTP senders.
 * @param options - The PR token, preview zone, hosted zone and Vercel project.
 * @returns What each half did.
 * @throws PreviewScopeError When the token is outside `pr-{N}` scope.
 * @sideEffect Deletes a Route 53 record and a Vercel project domain.
 */
export async function teardownPreviewDomain(
    deps: PreviewDomainTeardownDeps,
    options: PreviewDomainTeardownOptions,
): Promise<PreviewDomainTeardownResult> {
    const host = previewHostForPrToken(options.prToken, options.previewZone);
    const dns = await deletePreviewDnsRecord(deps.route53, options.hostedZoneId, host);
    const vercel = await releaseVercelPreviewDomain(deps.http, options.vercel, host);

    return { host, dns, vercel };
}

/**
 * Read a required environment variable.
 *
 * @param key - The variable name.
 * @returns Its value.
 * @throws Error When unset or blank — teardown must fail loudly rather than skip the DNS half.
 */
const requireEnv = (key: string): string => {
    const value = process.env[key];

    if (!value) {
        throw new Error(`teardown-preview-domain: ${key} is required`);
    }

    return value;
};

/**
 * CLI entry: `PR_TOKEN`, `PREVIEW_ZONE`, `PREVIEW_HOSTED_ZONE_ID`, `VERCEL_TOKEN`, `VERCEL_PROJECT_ID`
 * and (optional) `VERCEL_TEAM_ID` from the environment.
 *
 * @returns Nothing.
 * @sideEffect Performs the teardown and logs the outcome.
 */
async function main(): Promise<void> {
    const { Route53Client } = await import('@aws-sdk/client-route-53');

    const result = await teardownPreviewDomain(
        { route53: new Route53Client({}), http: globalThis.fetch },
        {
            prToken: requireEnv('PR_TOKEN'),
            previewZone: requireEnv('PREVIEW_ZONE'),
            hostedZoneId: requireEnv('PREVIEW_HOSTED_ZONE_ID'),
            vercel: {
                token: requireEnv('VERCEL_TOKEN'),
                projectId: requireEnv('VERCEL_PROJECT_ID'),
                teamId: process.env['VERCEL_TEAM_ID'],
            },
        },
    );

    console.log(`[preview-domain] ${result.host}: route53=${result.dns}, vercel-domain=${result.vercel}`);
}

// Run only when invoked directly (not when imported by tests).
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
    main().catch((err: unknown) => {
        console.error(err);
        process.exit(1);
    });
}
