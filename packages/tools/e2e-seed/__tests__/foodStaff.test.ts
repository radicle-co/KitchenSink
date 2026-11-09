/**
 * The staff decision the e2e-seed drives (revision 4, F16): it answers a pending publication request as the sandbox
 * `food:admin` pool user, so a flow can reach the approved and declined states without a staff screen. The two things
 * that must not break are that it REFUSES production and that it decides only the request the food names.
 */
import { describe, expect, it, vi } from 'vitest';

import { assertSandboxOrigin, decidePublication, isSandboxOrigin } from '../src/foodStaff.js';

describe('isSandboxOrigin - an ALLOW list, so a lookalike host never receives the staff token', () => {
    it.each([
        'https://food-pr-91.commise.app',
        'https://food.sandbox.commise.app',
        'https://pr-91.sandbox.commise.app',
        'http://localhost:3002',
        'http://127.0.0.1:3002',
    ])('%s is a sandbox', (origin) => {
        expect(isSandboxOrigin(origin)).toBe(true);
    });

    it.each([
        'https://food.commise.app',
        'https://food.commise.app/',
        'https://api.commise.app',
        'https://commise.app',
        'https://food-pr-91.commise.app.evil.example',
        'https://evilcommise.app',
        'https://sandbox.commise.app.attacker.commise.app',
        'https://food-pr-91.commise.app@evil.example',
    ])('%s is NOT', (origin) => {
        expect(isSandboxOrigin(origin)).toBe(false);
    });
});

describe('assertSandboxOrigin', () => {
    it('refuses production with a message naming the origin', () => {
        expect(() => assertSandboxOrigin('https://food.commise.app')).toThrow(/refusing.*food\.commise\.app/u);
    });

    it('refuses an origin that is not a URL', () => {
        expect(() => assertSandboxOrigin('not a url')).toThrow(/refusing/u);
    });

    it('lets a preview through', () => {
        expect(() => assertSandboxOrigin('https://food-pr-91.commise.app')).not.toThrow();
    });
});

describe('decidePublication', () => {
    const ORIGIN = 'https://food-pr-91.commise.app';
    const pending = (foodId: string, id: string) => ({
        request: { id, foodId, versionNumber: 1, status: 'pending' },
        snapshot: {},
        liveName: 'x',
    });

    const fakeFetch = (list: unknown[]) =>
        vi.fn(async (url: string, init?: RequestInit) => {
            const text = url;

            if (init?.method === 'POST') {
                return new Response(JSON.stringify({ id: 'r-2', status: 'approved' }), { status: 200 });
            }

            expect(text).toBe(`${ORIGIN}/api/v1/foods/admin/publication-requests?status=pending`);

            return new Response(JSON.stringify({ requests: list }), { status: 200 });
        });

    it('decides the pending request that names the food, with the bearer token, and no other', async () => {
        const fetchImpl = fakeFetch([pending('f-other', 'r-1'), pending('f-1', 'r-2')]);

        await decidePublication({
            foodOrigin: ORIGIN,
            token: async () => 'tok',
            foodId: 'f-1',
            decision: { approve: true },
            fetch: fetchImpl,
        });

        const post = fetchImpl.mock.calls.find(([, init]) => init?.method === 'POST');

        expect(post?.[0]).toBe(`${ORIGIN}/api/v1/foods/admin/publication-requests/r-2/decision`);
        expect(post?.[1]?.body).toBe(JSON.stringify({ approve: true }));
        expect(post?.[1]?.headers).toMatchObject({ authorization: 'Bearer tok' });
    });

    it('sends a decline with its reason', async () => {
        const fetchImpl = fakeFetch([pending('f-1', 'r-2')]);

        await decidePublication({
            foodOrigin: ORIGIN,
            token: async () => 'tok',
            foodId: 'f-1',
            decision: { approve: false, reason: 'Calories look wrong' },
            fetch: fetchImpl,
        });

        const post = fetchImpl.mock.calls.find(([, init]) => init?.method === 'POST');

        expect(post?.[1]?.body).toBe(JSON.stringify({ approve: false, reason: 'Calories look wrong' }));
    });

    it('throws, deciding nothing, when no pending request names the food', async () => {
        const fetchImpl = fakeFetch([pending('f-other', 'r-1')]);

        await expect(
            decidePublication({
                foodOrigin: ORIGIN,
                token: async () => 'tok',
                foodId: 'f-1',
                decision: { approve: true },
                fetch: fetchImpl,
            }),
        ).rejects.toThrow(/no pending publication request.*f-1/u);
        expect(fetchImpl.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
    });

    it('refuses production before any request is made', async () => {
        const fetchImpl = fakeFetch([]);

        await expect(
            decidePublication({
                foodOrigin: 'https://food.commise.app',
                token: async () => 'tok',
                foodId: 'f-1',
                decision: { approve: true },
                fetch: fetchImpl,
            }),
        ).rejects.toThrow(/refusing/u);
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('surfaces a refusal from the service with its status', async () => {
        const fetchImpl = vi.fn(async () => new Response('{"code":"FORBIDDEN"}', { status: 403 }));

        await expect(
            decidePublication({
                foodOrigin: ORIGIN,
                token: async () => 'tok',
                foodId: 'f-1',
                decision: { approve: true },
                fetch: fetchImpl,
            }),
        ).rejects.toThrow(/403/u);
    });
});
