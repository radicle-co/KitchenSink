/**
 * Whether a PR's web preview serves the commit the run is testing.
 *
 * Run 38791689080 is why this exists: its eight Playwright shards drove `pr-91.sandbox.commise.app` while that
 * hostname served a Vercel deployment built from 249a376f1, 29 commits behind the commit under test. Seven
 * shards went green and proved nothing about that commit's web UI. A build is not an address: the
 * alias names the deployment the hostname serves (ADR-0060). So the deployed web tier must ask Vercel which deployment the hostname serves,
 * and fail when it is not this commit's.
 *
 * Every row that is not a clean match must come out NOT `current`. A check that let any of them through would
 * report a stale or unknown preview as tested — the defect it exists to stop.
 */
import { describe, expect, it, vi } from 'vitest';

import { PreviewScopeError, type HttpSender } from '../previewDomainScope';
import {
    checkPreviewCurrency,
    describeVerdict,
    judgePreviewCurrency,
    previewHostForRun,
    readServedDeployment,
    type ServedDeploymentReading,
} from '../previewCurrency';

const ZONE = 'sandbox.commise.app';
const HOST = 'pr-91.sandbox.commise.app';
const PROJECT = 'prj_yDuXn801iSWAcDtPXul7awiUCWRV';
const VERCEL = { token: 'tok', projectId: PROJECT, teamId: 'team_xyz' } as const;
const DEPLOYMENT = 'dpl_Am58eVufLRJuExUZJorMp4ZFuff8';
/** The commit pr-91 actually served during run 38791689080. */
const SERVED = '249a376f1ff71e44fec37ab3e6ba40351a7d31b4';
const UNDER_TEST = '52cc6e93b0a1c2d3e4f5a6b7c8d9e0f1a2b3c4d5';

/** The alias body Vercel returned for pr-91 (read-only probe, 2026-10-15), trimmed to what matters. */
const aliasBody = (overrides: Record<string, unknown> = {}): string =>
    JSON.stringify({
        alias: HOST,
        deploymentId: DEPLOYMENT,
        projectId: PROJECT,
        deployment: { id: DEPLOYMENT, url: 'commise-5tmiyghha-radicle-co.vercel.app' },
        ...overrides,
    });

/** The deployment body Vercel returned for that alias, trimmed the same way. */
const deploymentBody = (overrides: Record<string, unknown> = {}, meta: Record<string, unknown> = {}): string =>
    JSON.stringify({
        id: DEPLOYMENT,
        projectId: PROJECT,
        readyState: 'READY',
        meta: { githubCommitSha: SERVED, githubCommitRef: 'chore/code-quality-enforcement-phase-1-2', ...meta },
        ...overrides,
    });

interface Reply {
    readonly status: number;
    readonly body: string;
}

/** An HTTP double that answers the alias and deployment reads, and records every URL it was asked for. */
function vercel(alias: Reply | Error, deployment: Reply | Error = { status: 200, body: deploymentBody() }) {
    const urls: string[] = [];
    const http: HttpSender = vi.fn(async (url: string) => {
        urls.push(url);
        const reply = url.includes('/aliases/') ? alias : deployment;

        if (reply instanceof Error) {
            throw reply;
        }

        return { ok: reply.status >= 200 && reply.status < 300, status: reply.status, text: async () => reply.body };
    });

    return { http, urls };
}

const read = (deployment: Partial<Extract<ServedDeploymentReading, { kind: 'read' }>> = {}) =>
    ({
        kind: 'read',
        deploymentId: DEPLOYMENT,
        projectId: PROJECT,
        readyState: 'READY',
        commitSha: SERVED,
        ...deployment,
    }) as const;

describe('judgePreviewCurrency — the decision, over every reading', () => {
    const rows: readonly (readonly [string, string, ServedDeploymentReading, 'current' | 'stale' | 'unverifiable'])[] =
        [
            ['served commit equals the commit under test', SERVED, read(), 'current'],
            ['served commit equals it, in another case', SERVED.toUpperCase(), read(), 'current'],
            ['served commit is older (run 38791689080)', UNDER_TEST, read(), 'stale'],
            ['the deployment carries no githubCommitSha', SERVED, read({ commitSha: undefined }), 'unverifiable'],
            ['the deployment names a short sha', SERVED, read({ commitSha: SERVED.slice(0, 9) }), 'unverifiable'],
            ['the alias is on another Vercel project', SERVED, read({ projectId: 'prj_armoury' }), 'unverifiable'],
            ['the deployment is not READY', SERVED, read({ readyState: 'ERROR' }), 'unverifiable'],
            ['the Vercel read failed', SERVED, { kind: 'failed', reason: 'alias read answered 500' }, 'unverifiable'],
            ['the expected sha is empty', '', read({ commitSha: '' }), 'unverifiable'],
            ['the expected sha is not a commit', 'refs/pull/91/merge', read(), 'unverifiable'],
        ];

    it.each(rows)('%s', (_label, expectedSha, reading, kind) => {
        expect(judgePreviewCurrency({ host: HOST, expectedSha, projectId: PROJECT, reading }).kind).toBe(kind);
    });

    it('carries both shas on a stale verdict', () => {
        expect(
            judgePreviewCurrency({ host: HOST, expectedSha: UNDER_TEST, projectId: PROJECT, reading: read() }),
        ).toEqual({ kind: 'stale', host: HOST, deploymentId: DEPLOYMENT, servedSha: SERVED, expectedSha: UNDER_TEST });
    });
});

describe('readServedDeployment — the alias, then the deployment it points at', () => {
    it('reads the alias for the exact host, then that deployment, on our team', async () => {
        const { http, urls } = vercel({ status: 200, body: aliasBody() });

        expect(await readServedDeployment(http, VERCEL, HOST, ZONE)).toEqual(read());
        expect(urls).toEqual([
            `https://api.vercel.com/v4/aliases/${HOST}?teamId=team_xyz`,
            `https://api.vercel.com/v13/deployments/${DEPLOYMENT}?teamId=team_xyz`,
        ]);
    });

    it('sends the token as a bearer and never in the URL', async () => {
        const { http, urls } = vercel({ status: 200, body: aliasBody() });

        await readServedDeployment(http, VERCEL, HOST, ZONE);

        expect(vi.mocked(http).mock.calls[0]?.[1].headers['Authorization']).toBe('Bearer tok');
        expect(urls.join(' ')).not.toContain('tok');
    });

    it('reads a deployment with no meta as having no commit', async () => {
        const { http } = vercel(
            { status: 200, body: aliasBody() },
            { status: 200, body: JSON.stringify({ id: DEPLOYMENT, projectId: PROJECT, readyState: 'READY' }) },
        );

        expect(await readServedDeployment(http, VERCEL, HOST, ZONE)).toEqual(read({ commitSha: undefined }));
    });

    interface FailureRow {
        readonly label: string;
        readonly alias: Reply | Error;
        readonly deployment?: Reply | Error;
    }

    const aliasOk: Reply = { status: 200, body: aliasBody() };
    const failures: readonly FailureRow[] = [
        { label: 'the hostname has no alias (404)', alias: { status: 404, body: '' } },
        { label: 'the token is refused (401)', alias: { status: 401, body: '{"error":{"code":"forbidden"}}' } },
        { label: 'Vercel is failing (500)', alias: { status: 500, body: 'oops' } },
        { label: 'the request never completes', alias: new Error('ECONNRESET') },
        { label: 'the alias body is not JSON', alias: { status: 200, body: '<html>' } },
        {
            label: 'the alias body names no deployment',
            alias: { status: 200, body: aliasBody({ deploymentId: undefined }) },
        },
        { label: 'the deployment read fails', alias: aliasOk, deployment: { status: 500, body: '' } },
        { label: 'the deployment read throws', alias: aliasOk, deployment: new Error('ETIMEDOUT') },
        { label: 'the deployment body is not JSON', alias: aliasOk, deployment: { status: 200, body: 'nope' } },
        {
            label: 'the deployment is a different one than the alias named',
            alias: aliasOk,
            deployment: { status: 200, body: deploymentBody({ id: 'dpl_other' }) },
        },
    ];

    it.each(failures)('fails closed when $label', async ({ alias, deployment }) => {
        const { http } = vercel(alias, deployment);
        const reading = await readServedDeployment(http, VERCEL, HOST, ZONE);

        expect(reading.kind).toBe('failed');
        expect(JSON.stringify(reading)).not.toContain('tok');
    });

    it('refuses a host outside the preview scope before any request', async () => {
        const { http } = vercel({ status: 200, body: aliasBody() });

        for (const host of ['identity.sandbox.commise.app', 'pr-91.attacker.example', 'pr-91.commise.app']) {
            await expect(readServedDeployment(http, VERCEL, host, ZONE)).rejects.toThrow(PreviewScopeError);
        }

        expect(http).not.toHaveBeenCalled();
    });
});

describe('previewHostForRun — the host Playwright drives is the host this checks', () => {
    it('derives the host from the stage, and accepts the origin that names it', () => {
        expect(previewHostForRun('pr-91', ZONE, `https://${HOST}`)).toBe(HOST);
        expect(previewHostForRun('pr-91', ZONE, `https://${HOST}/`)).toBe(HOST);
    });

    it.each([
        ['another PR', 'https://pr-9.sandbox.commise.app'],
        ['the apex', 'https://commise.app'],
        ['plain http', `http://${HOST}`],
        ['not a URL', HOST],
        ['a path-routed preview', 'https://sandbox.commise.app/pr-91'],
    ])('refuses a web origin naming %s', (_label, origin) => {
        expect(() => previewHostForRun('pr-91', ZONE, origin)).toThrow(PreviewScopeError);
    });

    it('refuses a stage that is not a preview', () => {
        expect(() => previewHostForRun('prod', ZONE, 'https://commise.app')).toThrow(PreviewScopeError);
    });
});

describe('checkPreviewCurrency — the composed check', () => {
    const options = (expectedSha: string) => ({
        prToken: 'pr-91',
        previewZone: ZONE,
        webOrigin: `https://${HOST}`,
        expectedSha,
        vercel: VERCEL,
    });

    it('is current when the preview serves the commit under test', async () => {
        const { http } = vercel({ status: 200, body: aliasBody() });

        expect((await checkPreviewCurrency(http, options(SERVED))).kind).toBe('current');
    });

    it('is stale when it serves an older commit — run 38791689080', async () => {
        const { http } = vercel({ status: 200, body: aliasBody() });

        expect((await checkPreviewCurrency(http, options(UNDER_TEST))).kind).toBe('stale');
    });

    it('asks Vercel nothing when the expected sha is not a commit', async () => {
        const { http } = vercel({ status: 200, body: aliasBody() });

        expect((await checkPreviewCurrency(http, options(''))).kind).toBe('unverifiable');
        expect(http).not.toHaveBeenCalled();
    });

    it('is unverifiable when Vercel cannot answer', async () => {
        const { http } = vercel(new Error('ENOTFOUND api.vercel.com'));

        expect((await checkPreviewCurrency(http, options(SERVED))).kind).toBe('unverifiable');
    });
});

describe('describeVerdict — what the log says', () => {
    it('names both shas, the host and the remedy on a stale preview', () => {
        const text = describeVerdict(
            { kind: 'stale', host: HOST, deploymentId: DEPLOYMENT, servedSha: SERVED, expectedSha: UNDER_TEST },
            'pr-91',
        );

        expect(text).toMatch(/^::error::/u);
        expect(text).toContain(SERVED);
        expect(text).toContain(UNDER_TEST);
        expect(text).toContain(HOST);
        expect(text).toContain('Sandbox Up');
        expect(text).toContain('ADR-0060');
        // Vercel builds each push's head, and a build can fail (pr-91's newest, 1f7977313, ended in ERROR on
        // 2026-10-15). Sandbox Up cannot alias a failed build, so the remedy has to say which case is which.
        expect(text).toMatch(/READY/u);
        expect(text).toMatch(/failed/u);
    });

    it('is an error, with the reason, when the preview cannot be checked', () => {
        const text = describeVerdict({ kind: 'unverifiable', host: HOST, reason: 'alias read answered 401' }, 'pr-91');

        expect(text).toMatch(/^::error::/u);
        expect(text).toContain('alias read answered 401');
    });

    it('is a notice, not an error, when the preview is current', () => {
        const text = describeVerdict({ kind: 'current', host: HOST, deploymentId: DEPLOYMENT, sha: SERVED }, 'pr-91');

        expect(text).not.toContain('::error::');
        expect(text).toContain(SERVED);
    });
});
