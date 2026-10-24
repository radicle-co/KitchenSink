import { describe, expect, it, vi } from 'vitest';
import { ChangeResourceRecordSetsCommand, ListResourceRecordSetsCommand } from '@aws-sdk/client-route-53';

import {
    PreviewScopeError,
    deletePreviewDnsRecord,
    isPreviewScopeError,
    prTokenForPreviewRecordName,
    previewHostForPrToken,
    releaseVercelPreviewDomain,
    requirePreviewHost,
    teardownPreviewDomain,
} from '../teardownPreviewDomain';

const ZONE = 'sandbox.commise.app';
const HOSTED_ZONE_ID = 'Z0474040RGDAGYCWHZ7M';

const VERCEL = { token: 'tok', projectId: 'prj_abc', teamId: 'team_xyz' } as const;

/**
 * Names that live in the SAME hosted zone as the previews and must never be a teardown target:
 * the shared sandbox identity service (every preview authenticates against it), the router apex, the
 * `*.sandbox` wildcard alias, and ACM's validation CNAMEs.
 */
const NEVER_TARGETS = [
    'sandbox.commise.app.',
    'commise.app.',
    '\\052.sandbox.commise.app.', // Route 53 renders `*` as the octal escape \052
    '*.sandbox.commise.app',
    'identity.sandbox.commise.app.',
    'registration.identity.sandbox.commise.app.',
    '_615cc209664a1f3cf95b4791c287ae43.sandbox.commise.app.',
    'identity.commise.app.',
    'recipe-sandbox.commise.app.',
];

const rrset = (name: string, value = 'cname.vercel-dns.com'): Record<string, unknown> => ({
    Name: name,
    Type: 'CNAME',
    TTL: 60,
    ResourceRecords: [{ Value: value }],
});

const okResponse = (status = 200, body = '{}'): { ok: boolean; status: number; text: () => Promise<string> } => ({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body),
});

describe('PreviewScopeError', () => {
    it('is identified by its type guard and not confused with an ordinary Error', () => {
        expect(isPreviewScopeError(new PreviewScopeError('nope'))).toBe(true);
        expect(isPreviewScopeError(new Error('nope'))).toBe(false);
        expect(isPreviewScopeError('nope')).toBe(false);
    });
});

describe('previewHostForPrToken — constructing the ONE hostname a PR owns', () => {
    it('builds `pr-{N}.<zone>` from an exact token', () => {
        expect(previewHostForPrToken('pr-73', ZONE)).toBe('pr-73.sandbox.commise.app');
        expect(previewHostForPrToken('pr-1', ZONE)).toBe('pr-1.sandbox.commise.app');
    });

    it('normalizes a fully-qualified zone (trailing dot, mixed case)', () => {
        expect(previewHostForPrToken('pr-73', 'SANDBOX.Commise.App.')).toBe('pr-73.sandbox.commise.app');
    });

    // A token that is anything other than `pr-{N}` is how a teardown ends up pointed at a shared host.
    it.each(['', 'pr-', 'pr', 'PR-73', 'pr-73x', 'pr-73.sandbox', '*', 'identity', 'sandbox', ' pr-73', 'pr-73 '])(
        'refuses the token %j',
        (token) => {
            expect(() => previewHostForPrToken(token, ZONE)).toThrow(PreviewScopeError);
        },
    );

    it.each(['', '.', 'commise', 'sandbox.commise.app/evil'])('refuses the zone %j', (zone) => {
        expect(() => previewHostForPrToken('pr-73', zone)).toThrow(PreviewScopeError);
    });
});

describe('requirePreviewHost — the INDEPENDENT guard every adapter re-asserts at its point of action', () => {
    it('accepts exactly `pr-{N}.<zone>`, normalized', () => {
        expect(requirePreviewHost('pr-73.sandbox.commise.app', ZONE)).toBe('pr-73.sandbox.commise.app');
        expect(requirePreviewHost('PR-73.Sandbox.Commise.App.', 'sandbox.commise.app.')).toBe(
            'pr-73.sandbox.commise.app',
        );
    });

    // Its documented promise is that a DIRECT caller — one that bypassed `previewHostForPrToken` — still
    // cannot aim a write at the apex, the wildcard or the shared identity host. A label-only check kept that
    // promise for hosts INSIDE the zone and broke it for `pr-{N}` hosts OUTSIDE it: the Route 53 hosted-zone
    // id constrains what DNS will accept, but nothing constrains the hostname a Vercel domain/alias call is
    // sent, so `pr-1.attacker.example` walked straight through to the API.
    it.each([
        'pr-1.attacker.example',
        'pr-73.commise.app',
        'pr-73.evil.sandbox.commise.app',
        'pr-73.sandbox.commise.app.attacker.example',
        'sandbox.commise.app',
        'identity.sandbox.commise.app',
        '*.sandbox.commise.app',
        'pr-73x.sandbox.commise.app',
        '',
    ])('refuses %j — the host must be `pr-{N}` DIRECTLY under the preview zone', (host) => {
        expect(() => requirePreviewHost(host, ZONE)).toThrow(PreviewScopeError);
    });

    it('refuses a malformed zone before comparing anything against it', () => {
        expect(() => requirePreviewHost('pr-73.sandbox.commise.app', 'commise')).toThrow(PreviewScopeError);
        expect(() => requirePreviewHost('pr-73.sandbox.commise.app', '')).toThrow(PreviewScopeError);
    });

    it('is the SAME predicate as the record-name specification — one matcher, not two', () => {
        // ADR-0005: a second, drifting copy of the scope predicate is the failure mode to avoid.
        for (const host of ['pr-73.sandbox.commise.app', 'pr-1.attacker.example', 'identity.sandbox.commise.app']) {
            const owned = prTokenForPreviewRecordName(host, ZONE) !== undefined;

            expect(owned ? requirePreviewHost(host, ZONE) : () => requirePreviewHost(host, ZONE)).toEqual(
                owned ? host : expect.any(Function),
            );

            if (!owned) {
                expect(() => requirePreviewHost(host, ZONE)).toThrow(PreviewScopeError);
            }
        }
    });
});

describe('prTokenForPreviewRecordName — which PR (if any) owns a Route 53 record', () => {
    it('claims a record whose FIRST LABEL is exactly pr-{N}', () => {
        expect(prTokenForPreviewRecordName('pr-73.sandbox.commise.app.', ZONE)).toBe('pr-73');
        expect(prTokenForPreviewRecordName('PR-73.SANDBOX.COMMISE.APP.', ZONE)).toBe('pr-73');
    });

    // pr-1 vs pr-15: label EQUALITY (not prefix) makes this structurally impossible, in either direction.
    it('never confuses pr-1 with pr-15 or pr-100', () => {
        expect(prTokenForPreviewRecordName('pr-15.sandbox.commise.app.', ZONE)).toBe('pr-15');
        expect(prTokenForPreviewRecordName('pr-100.sandbox.commise.app.', ZONE)).toBe('pr-100');
        expect(prTokenForPreviewRecordName('pr-1.sandbox.commise.app.', ZONE)).toBe('pr-1');
    });

    // ⛔ The regression that matters. `identity.sandbox.commise.app` is the shared, persistent identity
    // service every preview signs in against; the apex and the `*.sandbox` wildcard are the router's.
    it.each(NEVER_TARGETS)('claims nothing for the persistent record %s', (name) => {
        expect(prTokenForPreviewRecordName(name, ZONE)).toBeUndefined();
    });

    it.each([
        'pr-73.commise.app.', // right label, WRONG zone
        'pr-73.sandbox.commise.app.evil.com.', // suffix-confusion attempt
        'xpr-73.sandbox.commise.app.',
        'pr-73-web.sandbox.commise.app.', // a preview host is exactly pr-{N}, never pr-{N}-…
        'pr-73x.sandbox.commise.app.',
        'a.pr-73.sandbox.commise.app.', // pr-73 is not the FIRST label
        'sub.pr-73.sandbox.commise.app.',
    ])('claims nothing for %s', (name) => {
        expect(prTokenForPreviewRecordName(name, ZONE)).toBeUndefined();
    });
});

describe('deletePreviewDnsRecord', () => {
    it('deletes the exact preview record it found, echoing the rrset back verbatim', async () => {
        const send = vi.fn().mockResolvedValueOnce({ ResourceRecordSets: [rrset('pr-73.sandbox.commise.app.')] });

        await expect(
            deletePreviewDnsRecord({ send } as never, HOSTED_ZONE_ID, 'pr-73.sandbox.commise.app', ZONE),
        ).resolves.toBe('deleted');

        const [listCmd, changeCmd] = send.mock.calls.map((call) => call[0]);
        expect(listCmd).toBeInstanceOf(ListResourceRecordSetsCommand);
        expect(listCmd.input).toMatchObject({
            HostedZoneId: HOSTED_ZONE_ID,
            StartRecordName: 'pr-73.sandbox.commise.app.',
        });
        expect(changeCmd).toBeInstanceOf(ChangeResourceRecordSetsCommand);
        expect(changeCmd.input.ChangeBatch.Changes).toEqual([
            { Action: 'DELETE', ResourceRecordSet: rrset('pr-73.sandbox.commise.app.') },
        ]);
    });

    // Idempotency: a PR that never got a preview domain (or a re-run of a completed teardown) is a
    // SUCCESS, not a failure — otherwise every close would go red and the real signal would be ignored.
    it('reports `absent` and issues no change when the record is already gone', async () => {
        const send = vi.fn().mockResolvedValueOnce({ ResourceRecordSets: [] });

        await expect(
            deletePreviewDnsRecord({ send } as never, HOSTED_ZONE_ID, 'pr-73.sandbox.commise.app', ZONE),
        ).resolves.toBe('absent');
        expect(send).toHaveBeenCalledTimes(1);
    });

    /**
     * ⛔ THE test for this module. `ListResourceRecordSets` starts AT OR AFTER the requested name, so the
     * page it returns routinely contains the NEXT records in the zone — here the shared identity host.
     * Deleting the page instead of the exact match would take the shared sandbox identity service offline
     * for every preview at once.
     */
    it('deletes ONLY the exact match, never a neighbouring record on the same page', async () => {
        const send = vi.fn().mockResolvedValueOnce({
            ResourceRecordSets: [
                rrset('pr-73.sandbox.commise.app.'),
                rrset('registration.identity.sandbox.commise.app.'),
                rrset('sandbox.commise.app.'),
                rrset('\\052.sandbox.commise.app.'),
            ],
        });

        await deletePreviewDnsRecord({ send } as never, HOSTED_ZONE_ID, 'pr-73.sandbox.commise.app', ZONE);

        const changes = send.mock.calls[1]![0].input.ChangeBatch.Changes;
        expect(changes).toHaveLength(1);
        expect(changes[0].ResourceRecordSet.Name).toBe('pr-73.sandbox.commise.app.');
    });

    it('reports `absent` when the page contains only neighbours', async () => {
        const send = vi
            .fn()
            .mockResolvedValueOnce({ ResourceRecordSets: [rrset('registration.identity.sandbox.commise.app.')] });

        await expect(
            deletePreviewDnsRecord({ send } as never, HOSTED_ZONE_ID, 'pr-73.sandbox.commise.app', ZONE),
        ).resolves.toBe('absent');
        expect(send).toHaveBeenCalledTimes(1);
    });

    // A second, INDEPENDENT guard at the deletion point: even a direct caller that bypassed
    // `previewHostForPrToken` cannot aim this at a shared host. It refuses before any AWS call.
    it.each([
        'sandbox.commise.app',
        'commise.app',
        'identity.sandbox.commise.app',
        '*.sandbox.commise.app',
        '\\052.sandbox.commise.app',
        'pr-73x.sandbox.commise.app',
        'pr-1.attacker.example',
        'pr-73.commise.app',
        'pr-73.evil.sandbox.commise.app',
        '',
    ])('refuses to delete the non-preview host %j without calling AWS', async (host) => {
        const send = vi.fn();

        await expect(deletePreviewDnsRecord({ send } as never, HOSTED_ZONE_ID, host, ZONE)).rejects.toThrow(
            PreviewScopeError,
        );
        expect(send).not.toHaveBeenCalled();
    });
});

describe('releaseVercelPreviewDomain', () => {
    it('DELETEs the project domain with the bearer token and team scope', async () => {
        const http = vi.fn().mockResolvedValueOnce(okResponse());

        await expect(releaseVercelPreviewDomain(http, VERCEL, 'pr-73.sandbox.commise.app', ZONE)).resolves.toBe(
            'released',
        );

        const [url, init] = http.mock.calls[0]!;
        expect(url).toBe(
            'https://api.vercel.com/v9/projects/prj_abc/domains/pr-73.sandbox.commise.app?teamId=team_xyz',
        );
        expect(init).toMatchObject({ method: 'DELETE', headers: { Authorization: 'Bearer tok' } });
    });

    it('omits teamId when the project is personal', async () => {
        const http = vi.fn().mockResolvedValueOnce(okResponse());

        await releaseVercelPreviewDomain(
            http,
            { token: 'tok', projectId: 'prj_abc' },
            'pr-73.sandbox.commise.app',
            ZONE,
        );

        expect(http.mock.calls[0]![0]).toBe(
            'https://api.vercel.com/v9/projects/prj_abc/domains/pr-73.sandbox.commise.app',
        );
    });

    it('treats a 404 as already released (idempotent)', async () => {
        const http = vi.fn().mockResolvedValueOnce(okResponse(404, '{"error":{"code":"not_found"}}'));

        await expect(releaseVercelPreviewDomain(http, VERCEL, 'pr-73.sandbox.commise.app', ZONE)).resolves.toBe(
            'absent',
        );
    });

    // A silent failure here is the dangerous one — it is what leaves the hostname claimable.
    it('throws with the status and body on any other failure', async () => {
        const http = vi.fn().mockResolvedValueOnce(okResponse(403, '{"error":{"code":"forbidden"}}'));

        await expect(releaseVercelPreviewDomain(http, VERCEL, 'pr-73.sandbox.commise.app', ZONE)).rejects.toThrow(
            /403.*forbidden/su,
        );
    });

    it.each([
        'sandbox.commise.app',
        'identity.sandbox.commise.app',
        '*.sandbox.commise.app',
        'pr-1.attacker.example',
        'pr-73.commise.app',
        'pr-73.evil.sandbox.commise.app',
    ])('refuses the non-preview host %j without calling Vercel', async (host) => {
        const http = vi.fn();

        await expect(releaseVercelPreviewDomain(http, VERCEL, host, ZONE)).rejects.toThrow(PreviewScopeError);
        expect(http).not.toHaveBeenCalled();
    });
});

describe('teardownPreviewDomain — the order is the safety property', () => {
    const options = { prToken: 'pr-73', previewZone: ZONE, hostedZoneId: HOSTED_ZONE_ID, vercel: VERCEL } as const;

    it('removes DNS BEFORE releasing the Vercel domain', async () => {
        const order: string[] = [];
        const send = vi.fn().mockImplementation(async (command: unknown) => {
            order.push(command instanceof ChangeResourceRecordSetsCommand ? 'dns-delete' : 'dns-list');

            return { ResourceRecordSets: [rrset('pr-73.sandbox.commise.app.')] };
        });
        const http = vi.fn().mockImplementation(async () => {
            order.push('vercel-release');

            return okResponse();
        });

        const result = await teardownPreviewDomain({ route53: { send } as never, http }, options);

        expect(order).toEqual(['dns-list', 'dns-delete', 'vercel-release']);
        expect(result).toEqual({ host: 'pr-73.sandbox.commise.app', dns: 'deleted', vercel: 'released' });
    });

    /**
     * The whole point of the ordering. Releasing the Vercel domain while the CNAME still points at
     * `cname.vercel-dns.com` is the subdomain-takeover window: anyone can then claim the hostname on
     * their own Vercel account. So a DNS failure must abort BEFORE Vercel is touched — the only
     * half-state teardown may leave is the safe one (domain still claimed, name no longer resolving).
     */
    it('does NOT release the Vercel domain when the DNS delete fails', async () => {
        const send = vi.fn().mockRejectedValueOnce(new Error('Route 53 throttled'));
        const http = vi.fn();

        await expect(teardownPreviewDomain({ route53: { send } as never, http }, options)).rejects.toThrow(
            /Route 53 throttled/u,
        );
        expect(http).not.toHaveBeenCalled();
    });

    it('refuses a malformed PR token before any call is made', async () => {
        const send = vi.fn();
        const http = vi.fn();

        await expect(
            teardownPreviewDomain({ route53: { send } as never, http }, { ...options, prToken: 'sandbox' }),
        ).rejects.toThrow(PreviewScopeError);
        expect(send).not.toHaveBeenCalled();
        expect(http).not.toHaveBeenCalled();
    });
});
