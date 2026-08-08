// ⚠️ DELIBERATE — see docs/architecture/decisions/0001-sandbox-front-end-addressing.md ("Update
// (2026-07-28)") and docs/architecture/decisions/0005-environment-tagging-and-pr-cleanup.md.
//
// Teardown of a per-PR preview's PUBLIC ADDRESS — the half of ADR-0005 that CloudFormation does not own.
//
// A sandbox preview is reachable because three records outside CloudFormation agree: a Route 53 CNAME
// `pr-{N}.sandbox.commise.app → cname.vercel-dns.com`, a Vercel project-domain binding that claims that
// hostname, and a per-deployment alias. `createPreviewDomain.ts` provisions all three; this reclaims them.
// `teardown-sandbox-pr.sh` deletes stacks, log groups and ECR repos; it knew nothing about any of them, so
// a closed PR left the CNAME pointing at a provider where the name is no longer claimed — a textbook
// subdomain-takeover vector. (Releasing the project domain drops the alias bound through it, so there is
// no separate un-alias step.)
//
// Patterns: the shared scope Specification + Ports live in `previewDomainScope.ts` (ONE authority for both
// halves of the lifecycle — a creation path that wrote a host this could not recognise would strand it);
// here are two thin Adapters over the Route 53 and Vercel APIs, and a Command (`teardownPreviewDomain`)
// that composes them in the one order that is safe to be interrupted.
//
// ⛔ SCOPE IS THE SECURITY PROPERTY — see the header of `previewDomainScope.ts`. The only host this module
// will ever act on is `pr-{N}.<zone>` with `pr-{N}` as the exact FIRST LABEL, and both adapters re-assert
// that themselves rather than trusting their caller.
import {
    ChangeResourceRecordSetsCommand,
    ListResourceRecordSetsCommand,
    type ResourceRecordSet,
} from '@aws-sdk/client-route-53';

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

// The scope Specification is re-exported so this module stays the single import site for a caller that
// only cares about teardown, and so ADR-0005's documented entry points keep resolving here.
export {
    PR_TOKEN,
    PreviewScopeError,
    isPreviewScopeError,
    normalizeDnsName,
    prTokenForPreviewRecordName,
    previewHostForPrToken,
    requirePreviewHost,
    requirePreviewZone,
} from './previewDomainScope';
export type { HttpResponseLike, HttpSender, Route53Sender, VercelProjectConfig } from './previewDomainScope';

export type DnsOutcome = 'deleted' | 'absent';
export type VercelOutcome = 'released' | 'absent';

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
    const url = vercelApiUrl(
        `/v9/projects/${encodeURIComponent(config.projectId)}/domains/${encodeURIComponent(host)}`,
        config,
    );

    const response = await http(url, {
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
 * **The order is the safety property, and it is the exact MIRROR of `createPreviewDomain`.** The takeover
 * window is "CNAME still points at `cname.vercel-dns.com` while no Vercel account claims the name".
 * Deleting DNS first means an interrupted run — a throttle, a cancelled job, an expired token — can only
 * ever leave the SAFE half-state (domain still claimed, name no longer resolving). Doing it the other way
 * round would manufacture the exact vector this exists to close, so a DNS failure aborts before Vercel is
 * touched. (Creation runs the same two steps in the opposite order for the same reason: claim first, then
 * resolve.)
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
