// ⚠️ DELIBERATE — see docs/architecture/decisions/0001-sandbox-front-end-addressing.md ("Update
// (2026-07-28)") and docs/architecture/decisions/0005-environment-tagging-and-pr-cleanup.md.
//
// CREATION of a per-PR preview's PUBLIC ADDRESS (issue #94) — the exact mirror of
// `teardownPreviewDomain.ts`, which has reclaimed this address since 2026-07-28 while creation stayed
// hand-made. Teardown being ahead of setup meant a preview only worked if a human remembered three
// separate steps, and ADR-0001 records the consequence: PR #73's alias stayed pinned to one deployment,
// so every later push to that branch kept serving a stale build.
//
// A preview is reachable only when THREE records outside CloudFormation agree:
//   1. a Vercel project-domain binding that CLAIMS `pr-{N}.sandbox.commise.app`,
//   2. a Route 53 `CNAME pr-{N}.sandbox.commise.app → cname.vercel-dns.com` (more specific than the
//      existing `*.sandbox` alias, so it wins), and
//   3. a per-deployment ALIAS binding that hostname to THIS PR's deployment.
// Without (3) the name is claimed and resolving but no deployment answers on it; ADR-0001 also measured
// that a Vercel *branch domain* (`gitBranch`) is NOT a substitute — with it set, deployment protection
// comes back (302 → vercel.com/sso-api); with it cleared, the domain falls back to the PRODUCTION
// deployment. Only an explicit per-deployment alias yields an unprotected, correct preview, which is why
// this Command re-runs on every push rather than relying on any auto-alias.
//
// ⛔ ORDER IS A SAFETY PROPERTY, and two independent constraints point the same way:
//
//   • Security (the mirror of teardown). The dangerous half-state is "DNS resolves to Vercel while nobody
//     claims the name" — a textbook subdomain-takeover window, because anyone may then claim the hostname
//     on their own Vercel account. Teardown therefore deletes DNS FIRST and releases the claim second;
//     creation is the exact inverse: CLAIM FIRST, then create DNS. An interrupted creation can then only
//     leave the SAFE half-state (name claimed by us, nothing resolving), and a Vercel failure aborts
//     BEFORE Route 53 is touched.
//   • Vercel's own API (measured, ADR-0001). `POST /v2/deployments/{id}/aliases` refuses with
//     `400 cert_missing` until a certificate exists, and the certificate cannot be issued until the
//     hostname already resolves to Vercel (`449 http_pretest_domain_not_resolving_to_vercel_error`). So
//     the alias is only *possible* after DNS, which is why it is step 3 and not step 2 — and why a
//     freshly-created record needs a bounded wait before the alias takes. The two constraints agree; there
//     is no tension to trade off.
//
// ⛔ SCOPE IS THE SECURITY PROPERTY — see the header of `previewDomainScope.ts`, which is the SINGLE
// authority both halves of the lifecycle share. The only host this module will ever write is
// `pr-{N}.<zone>` with `pr-{N}` as the exact FIRST LABEL, and all three adapters re-assert that
// themselves rather than trusting their caller: the same hosted zone holds the apex, the `*.sandbox`
// wildcard, ACM validation records and `identity.sandbox.commise.app` — the single SHARED identity
// service every preview signs in against.
//
// Patterns: the shared scope Specification + injected Ports (`previewDomainScope.ts`), three thin
// Adapters (Route 53 UPSERT, Vercel project domain, Vercel deployment alias), and a Command
// (`createPreviewDomain`) that composes them in the one order that is both safe and possible. Every
// outcome is a discriminated string union rather than a boolean, so a re-run reports what it actually
// found instead of merely "true".
import { ChangeResourceRecordSetsCommand, ListResourceRecordSetsCommand } from '@aws-sdk/client-route-53';
import type { ResourceRecordSet } from '@aws-sdk/client-route-53';

import {
    normalizeDnsName,
    previewHostForPrToken,
    requireEnv,
    requirePreviewHost,
    vercelApiUrl,
    type HttpSender,
    type Route53Sender,
    type VercelProjectConfig,
} from './previewDomainScope';

/** Where a Vercel-served custom domain must point. Vercel's documented CNAME target for all projects. */
export const PREVIEW_CNAME_TARGET = 'cname.vercel-dns.com';

/** Short by design: a preview's address is re-pointed on close, and a stale cache is a dead preview. */
export const PREVIEW_RECORD_TTL = 60;

/** How many times the alias is attempted while Vercel is still issuing the certificate. */
const DEFAULT_ALIAS_ATTEMPTS = 12;

/** Wait between alias attempts. 12 × 15s ≈ 3 minutes, which covers observed cert issuance. */
const DEFAULT_ALIAS_DELAY_MS = 15_000;

/**
 * Vercel failures that mean "not yet", not "no".
 *
 * Measured in ADR-0001: immediately after the CNAME is created the certificate does not exist yet, so the
 * alias answers `400 cert_missing`; and while the name has not propagated to Vercel's resolvers the cert
 * request answers `449 http_pretest_domain_not_resolving_to_vercel_error`. Everything else — a bad token,
 * a deployment on another team, an alias held elsewhere — is permanent, and retrying it would burn minutes
 * and then report the wrong cause.
 */
const PROVISIONING_MARKERS = /cert_missing|cert not found|certificate|not_resolving|domain_not_verified/iu;

/** A deployment reference is a `dpl_…` id or a bare deployment host; it lands in an API URL path. */
const DEPLOYMENT_REF = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/u;

export type VercelDomainOutcome = 'created' | 'existing';
export type DnsRecordOutcome = 'created' | 'unchanged';
export type AliasOutcome = 'assigned' | 'moved';

/**
 * Raised when Vercel cannot alias the deployment YET because the domain's certificate is still being
 * provisioned. Distinct from an ordinary failure so the Command can retry this — and only this.
 */
export class PreviewAliasPendingError extends Error {
    public readonly status: number;

    public readonly body: string;

    public constructor(message: string, status: number, body: string) {
        super(message);
        this.name = 'PreviewAliasPendingError';
        this.status = status;
        this.body = body;
        Object.setPrototypeOf(this, PreviewAliasPendingError.prototype);
    }
}

/**
 * Type guard for {@link PreviewAliasPendingError}.
 *
 * @param error - The value to test.
 * @returns `true` when the alias failed only because Vercel is still provisioning.
 */
export function isPreviewAliasPendingError(error: unknown): error is PreviewAliasPendingError {
    return error instanceof PreviewAliasPendingError;
}

/**
 * Validate a Vercel deployment reference before it is interpolated into an API path.
 *
 * @param deployment - A `dpl_…` id or a bare deployment hostname.
 * @returns The trimmed reference.
 * @throws Error When it is empty or contains anything that could escape the URL path segment.
 */
const requireDeploymentRef = (deployment: string): string => {
    const ref = deployment.trim();

    if (!DEPLOYMENT_REF.test(ref)) {
        throw new Error(`create-preview-domain: invalid deployment reference '${deployment}'`);
    }

    return ref;
};

const jsonHeaders = (config: VercelProjectConfig): Record<string, string> => ({
    Authorization: `Bearer ${config.token}`,
    'Content-Type': 'application/json',
});

/**
 * Claim the preview hostname on OUR Vercel project, idempotently.
 *
 * This runs FIRST (see the module header): the claim is what makes the DNS record safe to publish. A 409
 * is ambiguous on its own — the domain may already be on this project (a re-run: success) or held by a
 * DIFFERENT project or team (a hard failure). Rather than pattern-matching Vercel's error codes, the
 * conflict is resolved by ASKING this project whether it holds the domain, which cannot be wrong.
 *
 * @param http - `fetch`, or a double.
 * @param config - Vercel token, project and (optional) team.
 * @param previewHost - The `pr-{N}.<zone>` host to claim.
 * @returns `'created'` on a fresh claim, `'existing'` when this project already held it.
 * @throws PreviewScopeError When `previewHost` is not a `pr-{N}` preview host.
 * @throws Error When the domain belongs to another project, or Vercel fails for any other reason —
 *   proceeding to create DNS for a hostname we do not own is exactly the takeover shape to avoid.
 * @sideEffect Adds a domain to the Vercel project.
 */
export async function claimVercelPreviewDomain(
    http: HttpSender,
    config: VercelProjectConfig,
    previewHost: string,
): Promise<VercelDomainOutcome> {
    const host = requirePreviewHost(previewHost);
    const project = encodeURIComponent(config.projectId);

    const response = await http(vercelApiUrl(`/v10/projects/${project}/domains`, config), {
        method: 'POST',
        headers: jsonHeaders(config),
        body: JSON.stringify({ name: host }),
    });

    if (response.ok) {
        return 'created';
    }

    if (response.status === 409) {
        const existing = await http(
            vercelApiUrl(`/v9/projects/${project}/domains/${encodeURIComponent(host)}`, config),
            { method: 'GET', headers: { Authorization: `Bearer ${config.token}` } },
        );

        if (existing.ok) {
            return 'existing';
        }

        throw new Error(
            `create-preview-domain: Vercel answered 409 and this project does not hold the domain (${existing.status}), so another project or team has claimed ${host} — resolve the ownership conflict before this preview can be addressed`,
        );
    }

    throw new Error(
        `create-preview-domain: Vercel refused to claim ${host} — ${response.status} ${await response.text()}`,
    );
}

/**
 * Point the preview host at Vercel with a `CNAME`, idempotently.
 *
 * `UPSERT` is itself idempotent, but the zone is READ first for two reasons that matter: to report
 * `'unchanged'` truthfully on the re-run every push performs, and to refuse rather than clobber a record
 * of a different type sitting at the same name (a CNAME cannot coexist with one, and Route 53 would answer
 * an opaque `InvalidChangeBatch`). `ListResourceRecordSets` starts at or AFTER the requested name, so the
 * page routinely contains the NEXT records in the zone — including the shared identity host — and only an
 * EXACT name match is ever considered.
 *
 * @param client - Route 53 client (or a double).
 * @param hostedZoneId - The zone that holds the preview records.
 * @param previewHost - The `pr-{N}.<zone>` host to publish.
 * @returns `'created'` when the record was written, `'unchanged'` when it already matched exactly.
 * @throws PreviewScopeError When `previewHost` is not a `pr-{N}` preview host.
 * @throws Error When a record of another type already occupies the name.
 * @sideEffect Writes a DNS record in Route 53.
 */
export async function upsertPreviewDnsRecord(
    client: Route53Sender,
    hostedZoneId: string,
    previewHost: string,
): Promise<DnsRecordOutcome> {
    const host = requirePreviewHost(previewHost);

    const { ResourceRecordSets = [] } = await client.send(
        new ListResourceRecordSetsCommand({
            HostedZoneId: hostedZoneId,
            StartRecordName: `${host}.`,
            MaxItems: 10,
        }),
    );

    const existing = ResourceRecordSets.filter(
        (recordSet: ResourceRecordSet) => normalizeDnsName(recordSet.Name ?? '') === host,
    );

    const conflicting = existing.find((recordSet: ResourceRecordSet) => recordSet.Type !== 'CNAME');

    if (conflicting) {
        throw new Error(
            `create-preview-domain: ${host} already holds a conflicting ${conflicting.Type} record, which cannot coexist with the CNAME a Vercel preview needs — remove it by hand and re-run`,
        );
    }

    const alreadyCorrect = existing.some(
        (recordSet: ResourceRecordSet) =>
            recordSet.TTL === PREVIEW_RECORD_TTL &&
            recordSet.ResourceRecords?.length === 1 &&
            normalizeDnsName(recordSet.ResourceRecords[0]?.Value ?? '') === PREVIEW_CNAME_TARGET,
    );

    if (alreadyCorrect) {
        return 'unchanged';
    }

    await client.send(
        new ChangeResourceRecordSetsCommand({
            HostedZoneId: hostedZoneId,
            ChangeBatch: {
                Comment: `ADR-0001 preview address: ${host}`,
                Changes: [
                    {
                        Action: 'UPSERT' as const,
                        ResourceRecordSet: {
                            Name: `${host}.`,
                            Type: 'CNAME' as const,
                            TTL: PREVIEW_RECORD_TTL,
                            ResourceRecords: [{ Value: PREVIEW_CNAME_TARGET }],
                        },
                    },
                ],
            },
        }),
    );

    return 'created';
}

/**
 * Bind the preview hostname to THIS PR's deployment — the step ADR-0001 flags as load-bearing.
 *
 * Runs LAST, and only once DNS exists: Vercel refuses the alias until a certificate has been issued, and
 * refuses the certificate until the hostname resolves to Vercel. Those two refusals are transient, so they
 * are raised as {@link PreviewAliasPendingError} for the Command to retry; every other failure is
 * permanent and surfaces the status and body immediately.
 *
 * @param http - `fetch`, or a double.
 * @param config - Vercel token, project and (optional) team.
 * @param deployment - The deployment id (`dpl_…`) or bare deployment host to serve on this hostname.
 * @param previewHost - The `pr-{N}.<zone>` host to bind.
 * @returns `'assigned'` for a first binding, `'moved'` when it was re-pointed from an earlier deployment.
 * @throws PreviewScopeError When `previewHost` is not a `pr-{N}` preview host.
 * @throws PreviewAliasPendingError When Vercel is still provisioning the certificate.
 * @throws Error When the deployment reference is malformed, or Vercel fails permanently.
 * @sideEffect Assigns a Vercel alias.
 */
export async function aliasPreviewDeployment(
    http: HttpSender,
    config: VercelProjectConfig,
    deployment: string,
    previewHost: string,
): Promise<AliasOutcome> {
    const host = requirePreviewHost(previewHost);
    const ref = requireDeploymentRef(deployment);

    const response = await http(vercelApiUrl(`/v2/deployments/${encodeURIComponent(ref)}/aliases`, config), {
        method: 'POST',
        headers: jsonHeaders(config),
        body: JSON.stringify({ alias: host }),
    });

    if (!response.ok) {
        const body = await response.text();
        const message = `create-preview-domain: Vercel refused to alias ${host} to ${ref} — ${response.status} ${body}`;

        if (response.status === 449 || (response.status === 400 && PROVISIONING_MARKERS.test(body))) {
            throw new PreviewAliasPendingError(message, response.status, body);
        }

        throw new Error(message);
    }

    return (await readOldDeploymentId(response.text())) === undefined ? 'assigned' : 'moved';
}

/**
 * Read Vercel's `oldDeploymentId` out of an alias response, tolerating an unexpected body.
 *
 * The alias SUCCEEDED by the time this runs; the field only distinguishes a first binding from a
 * re-pointing, so an unparseable body must not turn a success into a failure.
 *
 * @param bodyText - The response body promise.
 * @returns The previous deployment id, or `undefined`.
 */
const readOldDeploymentId = async (bodyText: Promise<string>): Promise<string | undefined> => {
    try {
        const parsed: unknown = JSON.parse(await bodyText);

        if (typeof parsed === 'object' && parsed !== null) {
            const value = (parsed as { oldDeploymentId?: unknown }).oldDeploymentId;

            return typeof value === 'string' && value.length > 0 ? value : undefined;
        }

        return undefined;
    } catch {
        return undefined;
    }
};

/**
 * Wait, so a freshly-created CNAME has time to reach Vercel's resolvers and yield a certificate.
 *
 * @param ms - Milliseconds to wait.
 * @returns A promise that settles after the delay.
 * @sideEffect Schedules a timer.
 */
const wait = (ms: number): Promise<void> =>
    new Promise((resolve) => {
        setTimeout(resolve, ms);
    });

export interface PreviewDomainCreationDeps {
    readonly route53: Route53Sender;
    readonly http: HttpSender;
    /** Injected so the suite needs no timers; defaults to a real delay. */
    readonly sleep?: (ms: number) => Promise<void>;
}

export interface PreviewDomainCreationOptions {
    readonly prToken: string;
    readonly previewZone: string;
    readonly hostedZoneId: string;
    readonly vercel: VercelProjectConfig;
    /** The deployment this hostname must serve — a `dpl_…` id or a bare deployment host. */
    readonly deployment: string;
    readonly aliasAttempts?: number;
    readonly aliasDelayMs?: number;
}

export interface PreviewDomainCreationResult {
    readonly host: string;
    readonly deployment: string;
    readonly vercelDomain: VercelDomainOutcome;
    readonly dns: DnsRecordOutcome;
    readonly alias: AliasOutcome;
    /** How many alias attempts it took — >1 means the certificate was still being issued. */
    readonly aliasAttempts: number;
}

/**
 * Provision a preview's public address: claim the name, publish DNS, then alias the deployment.
 *
 * **The order is the safety property** and is justified twice over in the module header — the claim must
 * precede DNS so an interrupted run cannot leave a record resolving to an unclaimed Vercel name, and the
 * alias must follow DNS because Vercel cannot issue the certificate it requires until the hostname
 * resolves. Consequently a Vercel-claim failure aborts before Route 53 is touched, and a DNS failure
 * aborts before the alias is attempted.
 *
 * Idempotent by construction: it is re-run on every push (that is what keeps the alias off a stale
 * deployment), so an already-claimed domain, an already-correct record and a re-pointed alias are all
 * SUCCESS — reported distinctly rather than as a boolean.
 *
 * @param deps - Injected Route 53 / HTTP senders and (optionally) the delay used between alias attempts.
 * @param options - The PR token, preview zone, hosted zone, Vercel project and target deployment.
 * @returns What each of the three steps did.
 * @throws PreviewScopeError When the token or zone is outside `pr-{N}` scope — before any call is made.
 * @throws PreviewAliasPendingError When the certificate never appears within the attempt budget.
 * @sideEffect Creates a Vercel project domain, a Route 53 record and a Vercel alias.
 */
export async function createPreviewDomain(
    deps: PreviewDomainCreationDeps,
    options: PreviewDomainCreationOptions,
): Promise<PreviewDomainCreationResult> {
    const host = previewHostForPrToken(options.prToken, options.previewZone);
    const deployment = requireDeploymentRef(options.deployment);
    const attempts = options.aliasAttempts ?? DEFAULT_ALIAS_ATTEMPTS;
    const delayMs = options.aliasDelayMs ?? DEFAULT_ALIAS_DELAY_MS;
    const sleep = deps.sleep ?? wait;

    const vercelDomain = await claimVercelPreviewDomain(deps.http, options.vercel, host);
    const dns = await upsertPreviewDnsRecord(deps.route53, options.hostedZoneId, host);

    for (let attempt = 1; ; attempt++) {
        try {
            const alias = await aliasPreviewDeployment(deps.http, options.vercel, deployment, host);

            return { host, deployment, vercelDomain, dns, alias, aliasAttempts: attempt };
        } catch (err) {
            if (!isPreviewAliasPendingError(err)) {
                throw err;
            }

            if (attempt >= attempts) {
                throw new PreviewAliasPendingError(
                    `create-preview-domain: ${host} could not be aliased to ${deployment} after ${attempts} attempts — Vercel is still provisioning the certificate for it (last: ${err.status} ${err.body}). Confirm the CNAME resolves to ${PREVIEW_CNAME_TARGET} and re-run.`,
                    err.status,
                    err.body,
                );
            }

            await sleep(delayMs);
        }
    }
}

/**
 * CLI entry: `PR_TOKEN`, `PREVIEW_ZONE`, `PREVIEW_HOSTED_ZONE_ID`, `VERCEL_TOKEN`, `VERCEL_PROJECT_ID`,
 * `VERCEL_DEPLOYMENT` and (optional) `VERCEL_TEAM_ID` from the environment — the same contract as
 * `teardownPreviewDomain.ts`, plus the deployment this address must serve.
 *
 * @returns Nothing.
 * @sideEffect Provisions the preview address and logs the outcome.
 */
async function main(): Promise<void> {
    const { Route53Client } = await import('@aws-sdk/client-route-53');

    const result = await createPreviewDomain(
        { route53: new Route53Client({}), http: globalThis.fetch },
        {
            prToken: requireEnv('PR_TOKEN'),
            previewZone: requireEnv('PREVIEW_ZONE'),
            hostedZoneId: requireEnv('PREVIEW_HOSTED_ZONE_ID'),
            deployment: requireEnv('VERCEL_DEPLOYMENT'),
            vercel: {
                token: requireEnv('VERCEL_TOKEN'),
                projectId: requireEnv('VERCEL_PROJECT_ID'),
                teamId: process.env['VERCEL_TEAM_ID'],
            },
        },
    );

    console.log(
        `[preview-domain] https://${result.host}/ → ${result.deployment}: vercel-domain=${result.vercelDomain}, route53=${result.dns}, alias=${result.alias} (${result.aliasAttempts} attempt(s))`,
    );
}

// Run only when invoked directly (not when imported by tests).
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
    main().catch((err: unknown) => {
        console.error(err);
        process.exit(1);
    });
}
