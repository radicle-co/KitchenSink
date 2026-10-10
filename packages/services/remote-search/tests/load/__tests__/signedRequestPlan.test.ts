/**
 * The plan of signed requests `remoteSearch.load.js` sends (ADR-0055 points 2 and 7), built by `prepareSignedUrls.ts`
 * before a run.
 *
 * Each case names what the scenario's assertions depend on. A warm-up request stores an answer, a hit request asks
 * the same term under an id of its own, and a probe must reach the function as a miss. A plan that broke any of these
 * would make the scenario measure something other than what its report says.
 */
import { describe, expect, it } from 'vitest';

import { isCanonicalSearchTerm } from '@kitchensink/schema-food';

import {
    REMOTE_SEARCH_RID_HEADER,
    remoteSearchPath,
    remoteSearchQuerySchema,
} from '../../../src/search/remoteSearch.schema.js';
import { planSignedRequests, type PlanInput, type UrlSigner } from '../signedRequestPlan.js';

const ORIGIN = 'https://remote-search-pr-91.commise.app';
const EXPIRES_AT = '2026-10-03T12:00:00.000Z';

/**
 * A request id generator that counts, so every id is distinct and predictable.
 *
 * @returns The generator.
 */
function countingRids(): () => string {
    let next = 0;

    return () => {
        next += 1;

        return `loadtestrid${String(next).padStart(8, '0')}`;
    };
}

/** A signer that records what it signed and appends a marker, as `getSignedUrl` appends its parameters. */
function recordingSigner(): { readonly sign: UrlSigner; readonly signed: { url: string; expiresAt: string }[] } {
    const signed: { url: string; expiresAt: string }[] = [];

    return {
        signed,
        sign: (url, expiresAt) => {
            signed.push({ url: url.href, expiresAt });

            return `${url.href}&Signature=signed`;
        },
    };
}

/**
 * A plan input, with overrides.
 *
 * @param overrides - Fields to replace.
 * @returns The input.
 */
function makeInput(overrides: Partial<PlanInput> = {}): PlanInput {
    return {
        origin: ORIGIN,
        stage: 'pr-91',
        expiresAt: EXPIRES_AT,
        warmTerms: ['egg', 'butter'],
        probeTerms: ['load probe abcdefghij', 'load probe klmnopqrst', 'load probe uvwxyzabcd'],
        newRid: countingRids(),
        ...overrides,
    };
}

/**
 * The query a signed URL was built with, read from the URL the signer received.
 *
 * @param url - The unsigned URL.
 * @returns Its parameters, in order.
 */
function queryOf(url: string): readonly (readonly [string, string])[] {
    return [...new URL(url).searchParams.entries()];
}

describe('planSignedRequests', () => {
    it('warms each term once with an admitted request on the search path', () => {
        const { sign, signed } = recordingSigner();
        const plan = planSignedRequests(makeInput(), sign);

        expect(plan.warm.map((request) => request.term)).toEqual(['egg', 'butter']);

        for (const request of plan.warm) {
            const unsigned = signed.find((entry) => request.url === `${entry.url}&Signature=signed`);

            expect(unsigned, request.term).toBeDefined();
            expect(new URL(unsigned?.url ?? '').origin).toBe(ORIGIN);
            expect(new URL(unsigned?.url ?? '').pathname).toBe(remoteSearchPath('usda'));
            expect(queryOf(unsigned?.url ?? '')).toEqual([
                ['q', request.term],
                ['admit', '1'],
                ['rid', request.rid],
            ]);
        }
    });

    it('asks each warmed term again unadmitted, under an id of its own and with no expectation of who stored it', () => {
        const plan = planSignedRequests(makeInput(), recordingSigner().sign);

        expect(plan.hits.map((request) => request.term)).toEqual(['egg', 'butter']);

        for (const [index, hit] of plan.hits.entries()) {
            const warm = plan.warm[index];

            // The stored answer may be an earlier run's, so the plan cannot know whose id a hit will echo.
            expect(hit).not.toHaveProperty('storedBy');
            expect(hit.rid).not.toBe(warm?.rid);
            expect(queryOf(hit.url.replace('&Signature=signed', ''))).toEqual([
                ['q', hit.term],
                ['admit', '0'],
                ['rid', hit.rid],
            ]);
        }
    });

    it('probes each probe term once, unadmitted, so the function answers it as a miss', () => {
        const plan = planSignedRequests(makeInput(), recordingSigner().sign);

        expect(plan.probes.map((request) => request.term)).toEqual([
            'load probe abcdefghij',
            'load probe klmnopqrst',
            'load probe uvwxyzabcd',
        ]);

        for (const probe of plan.probes) {
            expect(queryOf(probe.url.replace('&Signature=signed', ''))).toEqual([
                ['q', probe.term],
                ['admit', '0'],
                ['rid', probe.rid],
            ]);
        }
    });

    it('signs every request, and nothing else, to expire when the plan says', () => {
        const { sign, signed } = recordingSigner();
        const plan = planSignedRequests(makeInput(), sign);
        const requests = [...plan.warm, ...plan.hits, ...plan.probes];

        expect(signed).toHaveLength(requests.length);
        expect(new Set(signed.map((entry) => entry.expiresAt))).toEqual(new Set([EXPIRES_AT]));
        expect(requests.every((request) => request.url.endsWith('&Signature=signed'))).toBe(true);
        expect(plan.expiresAt).toBe(EXPIRES_AT);
    });

    it('gives every request an id of its own that the contract admits', () => {
        const plan = planSignedRequests(makeInput(), recordingSigner().sign);
        const rids = [...plan.warm, ...plan.hits, ...plan.probes].map((request) => request.rid);

        expect(rids).toHaveLength(7);
        expect(new Set(rids).size).toBe(rids.length);

        for (const rid of rids) {
            expect(remoteSearchQuerySchema.shape.rid.safeParse(rid).success, rid).toBe(true);
        }
    });

    it('tells the scenario which header echoes the request id, and what it measured', () => {
        const plan = planSignedRequests(makeInput(), recordingSigner().sign);

        expect(plan.ridHeader).toBe(REMOTE_SEARCH_RID_HEADER);
        expect(plan.origin).toBe(ORIGIN);
        expect(plan.stage).toBe('pr-91');
    });

    it.each<[string, Partial<PlanInput>, RegExp]>([
        ['a plaintext origin', { origin: 'http://remote-search-pr-91.commise.app' }, /https/u],
        ['an origin with a path', { origin: `${ORIGIN}/v1` }, /origin/u],
        ['no warm term', { warmTerms: [] }, /warm/u],
        ['no probe term', { probeTerms: [] }, /probe/u],
        ['a warm term twice', { warmTerms: ['egg', 'egg'] }, /twice/u],
        ['a probe term twice', { probeTerms: ['load probe abcdefghij', 'load probe abcdefghij'] }, /twice/u],
        ['a probe term that is also warmed', { probeTerms: ['egg'] }, /warm/u],
        ['a term that is not canonical', { warmTerms: ['Egg'] }, /canonical/u],
        ['a request id the contract refuses', { newRid: () => 'short' }, /request id/u],
        ['a request id issued twice', { newRid: () => 'loadtestrid00000001' }, /request id/u],
    ])('refuses %s', (_case, overrides, message) => {
        expect(() => planSignedRequests(makeInput(overrides), recordingSigner().sign)).toThrow(message);
    });

    it('builds only canonical terms into the fixtures above (non-vacuity of the canonical refusal)', () => {
        const input = makeInput();

        expect([...input.warmTerms, ...input.probeTerms].every((term) => isCanonicalSearchTerm(term))).toBe(true);
        expect(isCanonicalSearchTerm('Egg')).toBe(false);
    });
});
