import { describe, expect, it } from 'vitest';

import { classifyReachability, urlsForPr } from '../cutoverSmoke';

describe('classifyReachability', () => {
    it('classifies a DNS failure as nxdomain (router/DNS gone)', () => {
        expect(classifyReachability({ errorCode: 'ENOTFOUND' })).toMatchObject({ ok: false, kind: 'nxdomain' });
        expect(classifyReachability({ errorCode: 'EAI_AGAIN' })).toMatchObject({ ok: false, kind: 'nxdomain' });
    });

    it('classifies a non-DNS network error as error', () => {
        expect(classifyReachability({ errorCode: 'ECONNRESET' })).toMatchObject({ ok: false, kind: 'error' });
    });

    it.each([
        ['sso-api bounce', 'https://vercel.com/sso-api?url=x&nonce=y'],
        ['login landing', 'https://vercel.com/login?next=%2Fsso-api'],
    ])('classifies a Vercel %s as sso (bypass missing)', (_label, finalUrl) => {
        expect(classifyReachability({ finalUrl, status: 200 })).toMatchObject({ ok: false, kind: 'sso' });
    });

    it('classifies a 404 as notfound (route not registered / app miss)', () => {
        expect(classifyReachability({ finalUrl: 'https://sandbox.commise.app/pr-73/', status: 404 })).toMatchObject({
            ok: false,
            kind: 'notfound',
        });
    });

    it.each([
        ['200 sign-in', 'https://sandbox.commise.app/pr-73/sign-in', 200],
        ['307 app redirect', 'https://sandbox.commise.app/pr-73/', 307],
        ['308 basePath normalize', 'https://pr-73.sandbox.commise.app/pr-73', 308],
        ['raw vercel host serving the app', 'https://commise-abc.vercel.app/pr-73/sign-in', 200],
    ])('classifies %s as app (ok)', (_label, finalUrl, status) => {
        const r = classifyReachability({ finalUrl, status });

        expect(r).toMatchObject({ ok: true, kind: 'app' });
    });

    it('does NOT treat a vercel.com host as the app even at 2xx', () => {
        expect(classifyReachability({ finalUrl: 'https://vercel.com/dashboard', status: 200 })).not.toMatchObject({
            kind: 'app',
        });
    });

    it('classifies an unexpected status (e.g. 500) as error', () => {
        expect(classifyReachability({ finalUrl: 'https://sandbox.commise.app/', status: 500 })).toMatchObject({
            ok: false,
            kind: 'error',
        });
    });
});

describe('urlsForPr', () => {
    it('builds both path and subdomain forms under the base domain', () => {
        expect(urlsForPr(73, 'sandbox.commise.app')).toEqual({
            path: 'https://sandbox.commise.app/pr-73/',
            subdomain: 'https://pr-73.sandbox.commise.app/',
        });
    });
});
