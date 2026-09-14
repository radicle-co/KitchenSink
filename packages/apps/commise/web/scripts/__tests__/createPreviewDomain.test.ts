/**
 * Creation of a per-PR preview's PUBLIC ADDRESS (issue #94) — the exact mirror of
 * `teardownPreviewDomain.test.ts`.
 *
 * Two properties carry the weight, and each has a test that FAILS if it is broken:
 *
 *  1. **Scope** (ADR-0005 / ADR-0001): the only host that may ever be written is `pr-{N}.<zone>` with
 *     `pr-{N}` as the exact FIRST label. The same hosted zone holds the apex, the `*.sandbox` wildcard,
 *     ACM validation CNAMEs and `identity.sandbox.commise.app` — the single shared identity service every
 *     preview signs in against — so a widened match would take every preview down at once.
 *  2. **Order** (ADR-0001 "Update (2026-07-28)"): the Vercel claim happens BEFORE Route 53 is written, so
 *     an interrupted run can only leave the safe half-state; and the deployment alias happens LAST,
 *     because Vercel refuses it with `400 cert_missing` until a cert exists and refuses the cert with
 *     `449 http_pretest_domain_not_resolving_to_vercel_error` until DNS resolves to Vercel.
 */
import { describe, expect, it, vi } from 'vitest';
import { ChangeResourceRecordSetsCommand, ListResourceRecordSetsCommand } from '@aws-sdk/client-route-53';

import { PreviewScopeError } from '../previewDomainScope';
import {
    PREVIEW_CNAME_TARGET,
    PREVIEW_RECORD_TTL,
    PreviewAliasPendingError,
    aliasPreviewDeployment,
    claimVercelPreviewDomain,
    createPreviewDomain,
    isPreviewAliasPendingError,
    upsertPreviewDnsRecord,
} from '../createPreviewDomain';

const ZONE = 'sandbox.commise.app';
const HOSTED_ZONE_ID = 'Z0474040RGDAGYCWHZ7M';
const HOST = 'pr-73.sandbox.commise.app';
const DEPLOYMENT = 'dpl_CZLpYW9JrqYqYJYPftELYuL26E4M';

const VERCEL = { token: 'tok', projectId: 'prj_abc', teamId: 'team_xyz' } as const;

/**
 * Hosts in the SAME hosted zone / Vercel project that must never be a creation target: the shared sandbox
 * identity service (every preview authenticates against it), the router apex, the `*.sandbox` wildcard
 * alias (Route 53 renders `*` as the octal escape `\052`), and ACM's validation CNAMEs — plus hosts whose
 * FIRST label is a perfectly good `pr-{N}` but which sit OUTSIDE the preview zone. A label-only guard
 * admits those, and the Vercel calls are not constrained by a hosted-zone id the way Route 53's are.
 */
const NEVER_TARGETS = [
    'sandbox.commise.app',
    'commise.app',
    '\\052.sandbox.commise.app',
    '*.sandbox.commise.app',
    'identity.sandbox.commise.app',
    'registration.identity.sandbox.commise.app',
    '_615cc209664a1f3cf95b4791c287ae43.sandbox.commise.app',
    'pr-73x.sandbox.commise.app',
    'pr-.sandbox.commise.app',
    'pr-1.attacker.example',
    'pr-73.commise.app',
    'pr-73.evil.sandbox.commise.app',
    'pr-73.sandbox.commise.app.attacker.example',
    '',
];

/**
 * Tokens that must never resolve to a hostname. `pr-1x` / `PR-1` / `pr-` probe the anchored regex; the
 * separator-bearing ones probe the "could `pr-1` ever reach `pr-15`?" question from both directions.
 */
const REFUSED_TOKENS = [
    '',
    'pr-',
    'pr',
    'PR-1',
    'pr-1x',
    'pr-1.evil.com',
    'pr-1.sandbox',
    'pr-1 pr-15',
    'pr-1,pr-15',
    'pr-15;pr-1',
    'pr-1\npr-15',
    '*',
    '\\052',
    'sandbox',
    'identity',
    ' pr-1',
    'pr-1 ',
];

const rrset = (name: string, overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    Name: name,
    Type: 'CNAME',
    TTL: PREVIEW_RECORD_TTL,
    ResourceRecords: [{ Value: PREVIEW_CNAME_TARGET }],
    ...overrides,
});

const response = (status: number, body = '{}'): { ok: boolean; status: number; text: () => Promise<string> } => ({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body),
});

const okResponse = (body = '{}'): ReturnType<typeof response> => response(200, body);

/** The Route 53 double: one `ListResourceRecordSets` page, then an empty `ChangeResourceRecordSets` ack. */
const route53Returning = (recordSets: Record<string, unknown>[]) =>
    vi
        .fn()
        .mockImplementation(async (command: unknown) =>
            command instanceof ListResourceRecordSetsCommand ? { ResourceRecordSets: recordSets } : {},
        );

describe('the CNAME target is the Vercel edge, spelled exactly', () => {
    // A typo here does not fail loudly: the record is created, resolves to a host we do not control, and
    // the preview simply never works — or worse, resolves to somebody else's name.
    it('points previews at cname.vercel-dns.com with a 60s TTL', () => {
        expect(PREVIEW_CNAME_TARGET).toBe('cname.vercel-dns.com');
        expect(PREVIEW_RECORD_TTL).toBe(60);
    });
});

describe('PreviewAliasPendingError', () => {
    it('is identified by its type guard and not confused with an ordinary Error', () => {
        const err = new PreviewAliasPendingError('waiting', 400, '{"error":{"code":"cert_missing"}}');

        expect(isPreviewAliasPendingError(err)).toBe(true);
        expect(isPreviewAliasPendingError(new Error('waiting'))).toBe(false);
        expect(isPreviewAliasPendingError('waiting')).toBe(false);
        expect(err.status).toBe(400);
        expect(err.body).toContain('cert_missing');
    });
});

describe('claimVercelPreviewDomain — claiming the hostname on OUR project', () => {
    it('POSTs the project domain with the bearer token, team scope and JSON body', async () => {
        const http = vi.fn().mockResolvedValueOnce(okResponse());

        await expect(claimVercelPreviewDomain(http, VERCEL, HOST, ZONE)).resolves.toBe('created');

        const [url, init] = http.mock.calls[0]!;
        expect(url).toBe('https://api.vercel.com/v10/projects/prj_abc/domains?teamId=team_xyz');
        expect(init).toMatchObject({
            method: 'POST',
            headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
        });
        expect(JSON.parse(init.body)).toEqual({ name: HOST });
    });

    it('omits teamId when the project is personal', async () => {
        const http = vi.fn().mockResolvedValueOnce(okResponse());

        await claimVercelPreviewDomain(http, { token: 'tok', projectId: 'prj_abc' }, HOST, ZONE);

        expect(http.mock.calls[0]![0]).toBe('https://api.vercel.com/v10/projects/prj_abc/domains');
    });

    // Idempotency: a re-run (every push re-runs creation) must be GREEN, and the only way to know the
    // conflicting claim is OURS is to ask this project whether it holds the domain.
    it('treats a 409 whose domain is already on THIS project as `existing`', async () => {
        const http = vi
            .fn()
            .mockResolvedValueOnce(response(409, '{"error":{"code":"domain_already_in_use"}}'))
            .mockResolvedValueOnce(okResponse(`{"name":"${HOST}","verified":true}`));

        await expect(claimVercelPreviewDomain(http, VERCEL, HOST, ZONE)).resolves.toBe('existing');
        expect(http.mock.calls[1]![0]).toBe(
            'https://api.vercel.com/v9/projects/prj_abc/domains/pr-73.sandbox.commise.app?teamId=team_xyz',
        );
        expect(http.mock.calls[1]![1]).toMatchObject({ method: 'GET' });
    });

    /**
     * ⛔ The conflict that must NOT be swallowed. A 409 for a name held by a DIFFERENT project/team means
     * somebody else owns the hostname; carrying on would create a CNAME that resolves to Vercel for a name
     * we do not claim — the very subdomain-takeover shape teardown exists to prevent.
     */
    it('FAILS loudly when the 409 domain is not on this project', async () => {
        const http = vi
            .fn()
            .mockResolvedValueOnce(response(409, '{"error":{"code":"domain_already_in_use"}}'))
            .mockResolvedValueOnce(response(404, '{"error":{"code":"not_found"}}'));

        await expect(claimVercelPreviewDomain(http, VERCEL, HOST, ZONE)).rejects.toThrow(
            /409.*another project.*pr-73\.sandbox\.commise\.app/su,
        );
    });

    it('throws with the status and body on any other failure', async () => {
        const http = vi.fn().mockResolvedValueOnce(response(403, '{"error":{"code":"forbidden"}}'));

        await expect(claimVercelPreviewDomain(http, VERCEL, HOST, ZONE)).rejects.toThrow(/403.*forbidden/su);
    });

    it.each(NEVER_TARGETS)('refuses the non-preview host %j without calling Vercel', async (host) => {
        const http = vi.fn();

        await expect(claimVercelPreviewDomain(http, VERCEL, host, ZONE)).rejects.toThrow(PreviewScopeError);
        expect(http).not.toHaveBeenCalled();
    });
});

describe('upsertPreviewDnsRecord', () => {
    it('UPSERTs exactly one CNAME for the preview host', async () => {
        const send = route53Returning([]);

        await expect(upsertPreviewDnsRecord({ send } as never, HOSTED_ZONE_ID, HOST, ZONE)).resolves.toBe('created');

        const [listCmd, changeCmd] = send.mock.calls.map((call) => call[0]);
        expect(listCmd).toBeInstanceOf(ListResourceRecordSetsCommand);
        expect(listCmd.input).toMatchObject({
            HostedZoneId: HOSTED_ZONE_ID,
            StartRecordName: 'pr-73.sandbox.commise.app.',
        });
        expect(changeCmd).toBeInstanceOf(ChangeResourceRecordSetsCommand);
        expect(changeCmd.input.HostedZoneId).toBe(HOSTED_ZONE_ID);
        expect(changeCmd.input.ChangeBatch.Changes).toEqual([
            {
                Action: 'UPSERT',
                ResourceRecordSet: {
                    Name: 'pr-73.sandbox.commise.app.',
                    Type: 'CNAME',
                    TTL: 60,
                    ResourceRecords: [{ Value: 'cname.vercel-dns.com' }],
                },
            },
        ]);
    });

    // Re-running creation on every push must not churn the zone (and must report the truth).
    it('reports `unchanged` and issues no change when the exact record already exists', async () => {
        const send = route53Returning([rrset('pr-73.sandbox.commise.app.')]);

        await expect(upsertPreviewDnsRecord({ send } as never, HOSTED_ZONE_ID, HOST, ZONE)).resolves.toBe('unchanged');
        expect(send).toHaveBeenCalledTimes(1);
    });

    it('tolerates Route 53 returning the CNAME value fully-qualified', async () => {
        const send = route53Returning([
            rrset('pr-73.sandbox.commise.app.', { ResourceRecords: [{ Value: 'CNAME.vercel-dns.com.' }] }),
        ]);

        await expect(upsertPreviewDnsRecord({ send } as never, HOSTED_ZONE_ID, HOST, ZONE)).resolves.toBe('unchanged');
    });

    it('re-points a CNAME that currently targets something else', async () => {
        const send = route53Returning([
            rrset('pr-73.sandbox.commise.app.', { ResourceRecords: [{ Value: 'd111.cloudfront.net' }] }),
        ]);

        await expect(upsertPreviewDnsRecord({ send } as never, HOSTED_ZONE_ID, HOST, ZONE)).resolves.toBe('created');
        expect(send.mock.calls[1]![0].input.ChangeBatch.Changes[0].Action).toBe('UPSERT');
    });

    it('re-points a CNAME whose TTL drifted', async () => {
        const send = route53Returning([rrset('pr-73.sandbox.commise.app.', { TTL: 300 })]);

        await expect(upsertPreviewDnsRecord({ send } as never, HOSTED_ZONE_ID, HOST, ZONE)).resolves.toBe('created');
    });

    /**
     * ⛔ THE test for this adapter. `ListResourceRecordSets` starts at or AFTER the requested name, so the
     * page it returns routinely contains the NEXT records in the zone — including the shared identity host.
     * Reading the page as "the record already exists" would report `unchanged` and never create the
     * preview's record; writing a change for any of them would touch shared infrastructure.
     */
    it('ignores neighbouring records on the same page, and writes only the preview host', async () => {
        const send = route53Returning([
            rrset('registration.identity.sandbox.commise.app.'),
            rrset('sandbox.commise.app.'),
            rrset('\\052.sandbox.commise.app.'),
            rrset('pr-730.sandbox.commise.app.'),
        ]);

        await expect(upsertPreviewDnsRecord({ send } as never, HOSTED_ZONE_ID, HOST, ZONE)).resolves.toBe('created');

        const changes = send.mock.calls[1]![0].input.ChangeBatch.Changes;
        expect(changes).toHaveLength(1);
        expect(changes[0].ResourceRecordSet.Name).toBe('pr-73.sandbox.commise.app.');
    });

    /**
     * A record of a DIFFERENT type at the exact preview name cannot coexist with a CNAME; Route 53 would
     * answer an opaque `InvalidChangeBatch`. Refusing here names the actual problem, and — more
     * importantly — never silently replaces a record somebody else put there on purpose.
     */
    it.each(['A', 'AAAA', 'TXT'])('refuses to overwrite an existing %s record at the preview name', async (type) => {
        const send = route53Returning([
            rrset('pr-73.sandbox.commise.app.', { Type: type, AliasTarget: { DNSName: 'd111.cloudfront.net' } }),
        ]);

        const call = upsertPreviewDnsRecord({ send } as never, HOSTED_ZONE_ID, HOST, ZONE);

        await expect(call).rejects.toThrow(new RegExp(`conflicting ${type} record`, 'u'));
        await expect(call).rejects.toThrow(/pr-73\.sandbox\.commise\.app/u);
        expect(send).toHaveBeenCalledTimes(1);
    });

    // A second, INDEPENDENT guard at the point of action: even a caller that bypassed
    // `previewHostForPrToken` cannot aim a write at a shared host. It refuses before any AWS call.
    it.each(NEVER_TARGETS)('refuses to write the non-preview host %j without calling AWS', async (host) => {
        const send = vi.fn();

        await expect(upsertPreviewDnsRecord({ send } as never, HOSTED_ZONE_ID, host, ZONE)).rejects.toThrow(
            PreviewScopeError,
        );
        expect(send).not.toHaveBeenCalled();
    });
});

describe('aliasPreviewDeployment — the step ADR-0001 says is load-bearing', () => {
    it('POSTs the alias for the deployment, with the team scope', async () => {
        const http = vi.fn().mockResolvedValueOnce(okResponse(`{"uid":"ali_1","alias":"${HOST}"}`));

        await expect(aliasPreviewDeployment(http, VERCEL, DEPLOYMENT, HOST, ZONE)).resolves.toBe('assigned');

        const [url, init] = http.mock.calls[0]!;
        expect(url).toBe(`https://api.vercel.com/v2/deployments/${DEPLOYMENT}/aliases?teamId=team_xyz`);
        expect(init).toMatchObject({
            method: 'POST',
            headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
        });
        expect(JSON.parse(init.body)).toEqual({ alias: HOST });
    });

    // The defect ADR-0001 records: PR #73's alias stayed pinned to one build, so every later push served
    // the stale one. Re-pointing is the NORMAL case on a push, and worth reporting distinctly.
    it('reports `moved` when the alias was re-pointed from an earlier deployment', async () => {
        const http = vi.fn().mockResolvedValueOnce(okResponse(`{"uid":"ali_1","oldDeploymentId":"dpl_previous"}`));

        await expect(aliasPreviewDeployment(http, VERCEL, DEPLOYMENT, HOST, ZONE)).resolves.toBe('moved');
    });

    it('still succeeds when the response body is not the JSON we expect', async () => {
        const http = vi.fn().mockResolvedValueOnce(okResponse('not json'));

        await expect(aliasPreviewDeployment(http, VERCEL, DEPLOYMENT, HOST, ZONE)).resolves.toBe('assigned');
    });

    it('accepts a bare deployment host as the deployment reference', async () => {
        const http = vi.fn().mockResolvedValueOnce(okResponse());

        await aliasPreviewDeployment(http, VERCEL, 'commise-abc123-radicle-co.vercel.app', HOST, ZONE);

        expect(http.mock.calls[0]![0]).toBe(
            'https://api.vercel.com/v2/deployments/commise-abc123-radicle-co.vercel.app/aliases?teamId=team_xyz',
        );
    });

    // Measured in ADR-0001: the alias is refused until Vercel has issued a cert, and the cert is refused
    // until the hostname resolves to Vercel. Both are TRANSIENT immediately after the CNAME is created.
    //
    // `deployment_not_ready` is a THIRD transient cause on a different axis — the DEPLOYMENT is still
    // building, rather than the DOMAIN still being provisioned — and it took PR #91's `Publish sandbox
    // preview address` job red on the real API: this exact body, matched by no marker, so the command
    // failed after 14 seconds without retrying once. The `preview-domain` job runs on every non-closed PR
    // event, concurrently with Vercel's build, so racing an unfinished deployment is the NORMAL case, not
    // an edge one.
    it.each([
        [400, '{"error":{"code":"cert_missing"}}'],
        [400, '{"error":{"code":"not_found","message":"cert not found"}}'],
        [449, '{"error":{"code":"http_pretest_domain_not_resolving_to_vercel_error"}}'],
        [400, '{"error":{"code":"deployment_not_ready","message":"The deployment `readyState` is not `READY`"}}'],
    ])('classifies %i %s as still-provisioning', async (status, body) => {
        const http = vi.fn().mockResolvedValueOnce(response(status, body));

        await expect(aliasPreviewDeployment(http, VERCEL, DEPLOYMENT, HOST, ZONE)).rejects.toThrow(
            PreviewAliasPendingError,
        );
    });

    // A permissions/ownership failure is NOT transient; retrying it would just burn ten minutes and then
    // report the wrong cause.
    it.each([
        [403, '{"error":{"code":"forbidden"}}'],
        [404, '{"error":{"code":"deployment_not_found"}}'],
        [409, '{"error":{"code":"alias_in_use_by_another_team"}}'],
    ])('does NOT classify %i as still-provisioning', async (status, body) => {
        const http = vi.fn().mockResolvedValueOnce(response(status, body));
        const call = aliasPreviewDeployment(http, VERCEL, DEPLOYMENT, HOST, ZONE);

        await expect(call).rejects.toThrow(new RegExp(`${status}`, 'su'));
        await expect(call).rejects.not.toThrow(PreviewAliasPendingError);
    });

    it.each(NEVER_TARGETS)('refuses to alias the non-preview host %j without calling Vercel', async (host) => {
        const http = vi.fn();

        await expect(aliasPreviewDeployment(http, VERCEL, DEPLOYMENT, host, ZONE)).rejects.toThrow(PreviewScopeError);
        expect(http).not.toHaveBeenCalled();
    });

    // CI reads this from a third-party action's output. A false refusal would leave the preview with no
    // address at all, so a scheme prefix and a trailing slash are tolerated — and nothing else is.
    it.each(['https://commise-abc123-radicle-co.vercel.app', 'https://commise-abc123-radicle-co.vercel.app/'])(
        'tolerates the scheme-prefixed deployment host %j',
        async (deployment) => {
            const http = vi.fn().mockResolvedValueOnce(okResponse());

            await aliasPreviewDeployment(http, VERCEL, deployment, HOST, ZONE);

            expect(http.mock.calls[0]![0]).toBe(
                'https://api.vercel.com/v2/deployments/commise-abc123-radicle-co.vercel.app/aliases?teamId=team_xyz',
            );
        },
    );

    // The reference lands in the URL path, so anything that could escape it is refused before the call.
    it.each([
        '',
        '   ',
        '../projects/prj_abc',
        'dpl_a/aliases',
        'dpl a',
        'dpl_a?teamId=other',
        'https://evil.com/path',
        'https://',
    ])('refuses the deployment reference %j without calling Vercel', async (deployment) => {
        const http = vi.fn();

        await expect(aliasPreviewDeployment(http, VERCEL, deployment, HOST, ZONE)).rejects.toThrow(
            /deployment reference/u,
        );
        expect(http).not.toHaveBeenCalled();
    });
});

describe('createPreviewDomain — the order is the safety property', () => {
    const options = {
        prToken: 'pr-73',
        previewZone: ZONE,
        hostedZoneId: HOSTED_ZONE_ID,
        vercel: VERCEL,
        deployment: DEPLOYMENT,
    } as const;

    /**
     * Records every call in sequence. `dns-list` / `dns-upsert` are distinguished by command type, and the
     * Vercel calls by URL, so the assertion is on the real cross-provider ORDER rather than on counts.
     */
    const tracingDeps = (
        recordSets: Record<string, unknown>[] = [],
        httpResponses: ReturnType<typeof response>[] = [],
    ) => {
        const order: string[] = [];
        const send = vi.fn().mockImplementation(async (command: unknown) => {
            if (command instanceof ListResourceRecordSetsCommand) {
                order.push('dns-list');

                return { ResourceRecordSets: recordSets };
            }

            order.push('dns-upsert');

            return {};
        });
        const queue = [...httpResponses];
        const http = vi.fn().mockImplementation(async (url: string) => {
            order.push(url.includes('/aliases') ? 'vercel-alias' : 'vercel-domain');

            return queue.shift() ?? okResponse();
        });

        return { order, send, http, sleep: vi.fn().mockResolvedValue(undefined) };
    };

    it('claims the Vercel domain FIRST, then writes DNS, and aliases the deployment LAST', async () => {
        const { order, send, http, sleep } = tracingDeps();

        const result = await createPreviewDomain({ route53: { send } as never, http, sleep }, options);

        expect(order).toEqual(['vercel-domain', 'dns-list', 'dns-upsert', 'vercel-alias']);
        expect(result).toEqual({
            host: HOST,
            deployment: DEPLOYMENT,
            vercelDomain: 'created',
            dns: 'created',
            alias: 'assigned',
            aliasAttempts: 1,
        });
    });

    /**
     * ⛔ The whole point of the ordering. A CNAME pointing at `cname.vercel-dns.com` for a hostname that no
     * Vercel account claims IS the subdomain-takeover window (anyone may then claim it on their own
     * account). So the Vercel claim must land first, and a Vercel failure must abort BEFORE Route 53 is
     * touched — the only half-state creation may leave is the safe one (claimed, not yet resolving).
     */
    it('does NOT touch Route 53 when the Vercel claim fails', async () => {
        const send = vi.fn();
        const http = vi.fn().mockResolvedValueOnce(response(403, '{"error":{"code":"forbidden"}}'));

        await expect(createPreviewDomain({ route53: { send } as never, http }, options)).rejects.toThrow(
            /403.*forbidden/su,
        );
        expect(send).not.toHaveBeenCalled();
    });

    it('does NOT touch Route 53 when the hostname is claimed by another project', async () => {
        const send = vi.fn();
        const http = vi
            .fn()
            .mockResolvedValueOnce(response(409, '{"error":{"code":"domain_already_in_use"}}'))
            .mockResolvedValueOnce(response(404, '{}'));

        await expect(createPreviewDomain({ route53: { send } as never, http }, options)).rejects.toThrow(
            /another project/u,
        );
        expect(send).not.toHaveBeenCalled();
    });

    // The alias cannot succeed before DNS exists (`449` / `400 cert_missing`), so a DNS failure must not
    // be followed by a pointless ten-minute alias retry loop that reports the wrong cause.
    it('does NOT attempt the alias when the DNS write fails', async () => {
        const send = vi.fn().mockRejectedValueOnce(new Error('Route 53 throttled'));
        const http = vi.fn().mockResolvedValueOnce(okResponse());

        await expect(createPreviewDomain({ route53: { send } as never, http }, options)).rejects.toThrow(
            /Route 53 throttled/u,
        );
        expect(http).toHaveBeenCalledTimes(1);
        expect(http.mock.calls[0]![0]).not.toContain('/aliases');
    });

    it.each(REFUSED_TOKENS)('refuses the PR token %j before any call is made', async (prToken) => {
        const send = vi.fn();
        const http = vi.fn();

        await expect(
            createPreviewDomain({ route53: { send } as never, http }, { ...options, prToken }),
        ).rejects.toThrow(PreviewScopeError);
        expect(send).not.toHaveBeenCalled();
        expect(http).not.toHaveBeenCalled();
    });

    it.each(['', '.', 'commise', 'sandbox.commise.app/evil'])(
        'refuses the preview zone %j before any call is made',
        async (previewZone) => {
            const send = vi.fn();
            const http = vi.fn();

            await expect(
                createPreviewDomain({ route53: { send } as never, http }, { ...options, previewZone }),
            ).rejects.toThrow(PreviewScopeError);
            expect(send).not.toHaveBeenCalled();
            expect(http).not.toHaveBeenCalled();
        },
    );

    // pr-1 vs pr-15: the host is built by label equality, so neither can ever address the other's record.
    it('writes pr-1 to pr-1 only, never pr-15', async () => {
        const { send, http, sleep } = tracingDeps([rrset('pr-15.sandbox.commise.app.')]);

        const result = await createPreviewDomain(
            { route53: { send } as never, http, sleep },
            { ...options, prToken: 'pr-1' },
        );

        expect(result.host).toBe('pr-1.sandbox.commise.app');
        expect(send.mock.calls[1]![0].input.ChangeBatch.Changes[0].ResourceRecordSet.Name).toBe(
            'pr-1.sandbox.commise.app.',
        );
        expect(JSON.parse(http.mock.calls[0]![1].body)).toEqual({ name: 'pr-1.sandbox.commise.app' });
    });

    // Every push re-runs creation. The second run must be green and must SAY that nothing changed.
    it('is idempotent: an existing domain, an unchanged record and a re-pointed alias are all success', async () => {
        const { order, send, http, sleep } = tracingDeps(
            [rrset('pr-73.sandbox.commise.app.')],
            [
                response(409, '{"error":{"code":"domain_already_in_use"}}'),
                okResponse(`{"name":"${HOST}"}`),
                okResponse('{"oldDeploymentId":"dpl_previous"}'),
            ],
        );

        const result = await createPreviewDomain({ route53: { send } as never, http, sleep }, options);

        expect(result).toEqual({
            host: HOST,
            deployment: DEPLOYMENT,
            vercelDomain: 'existing',
            dns: 'unchanged',
            alias: 'moved',
            aliasAttempts: 1,
        });
        expect(order).toEqual(['vercel-domain', 'vercel-domain', 'dns-list', 'vercel-alias']);
    });

    /**
     * Without this the automation cannot work on a FIRST creation at all: the CNAME is seconds old, so
     * Vercel has not issued the cert yet and the alias answers `400 cert_missing`. Bounded, and the wait is
     * injected so the suite needs no timers.
     */
    it('retries the alias while Vercel is still provisioning the certificate', async () => {
        const { order, send, http, sleep } = tracingDeps(
            [],
            [
                okResponse(),
                response(400, '{"error":{"code":"cert_missing"}}'),
                response(449, '{"error":{"code":"http_pretest_domain_not_resolving_to_vercel_error"}}'),
                okResponse('{"uid":"ali_1"}'),
            ],
        );

        const result = await createPreviewDomain(
            { route53: { send } as never, http, sleep },
            { ...options, aliasAttempts: 4, aliasDelayMs: 1_500 },
        );

        expect(result.alias).toBe('assigned');
        expect(result.aliasAttempts).toBe(3);
        expect(order).toEqual([
            'vercel-domain',
            'dns-list',
            'dns-upsert',
            'vercel-alias',
            'vercel-alias',
            'vercel-alias',
        ]);
        expect(sleep).toHaveBeenCalledTimes(2);
        expect(sleep).toHaveBeenCalledWith(1_500);
    });

    it('fails loudly, naming the certificate, when the alias never becomes possible', async () => {
        const { http, send, sleep } = tracingDeps(
            [],
            [
                okResponse(),
                response(400, '{"error":{"code":"cert_missing"}}'),
                response(400, '{"error":{"code":"cert_missing"}}'),
                response(400, '{"error":{"code":"cert_missing"}}'),
            ],
        );

        await expect(
            createPreviewDomain(
                { route53: { send } as never, http, sleep },
                { ...options, aliasAttempts: 3, aliasDelayMs: 10 },
            ),
        ).rejects.toThrow(/3 attempts.*certificate/su);
        expect(sleep).toHaveBeenCalledTimes(2);
    });

    it('does NOT retry an alias failure that is not a provisioning delay', async () => {
        const { http, send, sleep } = tracingDeps([], [okResponse(), response(403, '{"error":{"code":"forbidden"}}')]);

        await expect(
            createPreviewDomain({ route53: { send } as never, http, sleep }, { ...options, aliasAttempts: 5 }),
        ).rejects.toThrow(/403/u);
        expect(sleep).not.toHaveBeenCalled();
    });
});
