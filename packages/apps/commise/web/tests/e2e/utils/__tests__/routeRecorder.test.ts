// @vitest-environment node
/**
 * The filter of the route recorder: which requests and navigations count as "the spec went to this page".
 *
 * Only the filter is tested here. Whether `framenavigated` fires on a Next App Router client navigation is a fact
 * about the browser and can only be learned from a real run.
 */
import { describe, expect, it } from 'vitest';

import { navigationOf, recordLine, type RecordedRequest } from '../routeRecorder';

const ORIGIN = 'http://localhost:3010';
const request = (overrides: Partial<RecordedRequest> = {}): RecordedRequest => ({
    url: `${ORIGIN}/en/recipes/new`,
    resourceType: 'document',
    headers: {},
    ...overrides,
});
const options = { origin: ORIGIN, prefix: '/en' };

describe('navigationOf', () => {
    it('records a document request as the locale-free path', () => {
        expect(navigationOf(request(), options)).toEqual({ path: '/recipes/new', via: 'document' });
    });

    it('records the app home as /', () => {
        expect(navigationOf(request({ url: `${ORIGIN}/en` }), options)).toEqual({ path: '/', via: 'document' });
        expect(navigationOf(request({ url: `${ORIGIN}/en/` }), options)).toEqual({ path: '/', via: 'document' });
    });

    it('records a React Server Components request, which is how a client-side navigation reaches the server', () => {
        expect(
            navigationOf(
                request({ url: `${ORIGIN}/en/recipes/abc?_rsc=1x2y`, resourceType: 'fetch', headers: { rsc: '1' } }),
                options,
            ),
        ).toEqual({ path: '/recipes/abc', via: 'rsc' });
    });

    it('ignores a prefetch, which loads a page the user has not gone to', () => {
        expect(
            navigationOf(
                request({ resourceType: 'fetch', headers: { rsc: '1', 'next-router-prefetch': '1' } }),
                options,
            ),
        ).toBeUndefined();
    });

    it('ignores the header name in any letter case', () => {
        expect(
            navigationOf(
                request({ resourceType: 'fetch', headers: { RSC: '1', 'Next-Router-Prefetch': '1' } }),
                options,
            ),
        ).toBeUndefined();
    });

    it.each([
        ['an image', { resourceType: 'image' }],
        ['a script', { resourceType: 'script' }],
        ['an API call', { resourceType: 'fetch' }],
        ['a different origin', { url: 'https://clerk.example.com/en/recipes' }],
        ['a path outside the locale', { url: `${ORIGIN}/api/health` }],
        ['a path that only starts with the same letters as the locale', { url: `${ORIGIN}/english/recipes` }],
    ])('ignores %s', (_name, overrides) => {
        expect(navigationOf(request(overrides as Partial<RecordedRequest>), options)).toBeUndefined();
    });

    it('drops the query and the fragment', () => {
        expect(navigationOf(request({ url: `${ORIGIN}/en/discover?query=e#top` }), options)).toEqual({
            path: '/discover',
            via: 'document',
        });
    });
});

describe('recordLine', () => {
    it('writes one JSON object and a newline, saying how the navigation was seen', () => {
        expect(recordLine('home.spec.ts', '/recipes', 'rsc')).toBe(
            '{"spec":"home.spec.ts","path":"/recipes","via":"rsc"}\n',
        );
    });

    it('names the three ways a navigation is seen', () => {
        expect(
            ['document', 'rsc', 'framenavigated'].map((via) => recordLine('a', '/', via as 'document')),
        ).toHaveLength(3);
    });
});
