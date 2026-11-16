import { describe, expect, it } from 'vitest';

import { detectPageSource } from '../detectPageSource.js';
import { parsePage } from '../pageDocument.js';
import { makeLinkHead, makePage } from '../__fixtures__/pageFixtures.js';

const detect = (links: Parameters<typeof makeLinkHead>[0], nodeLinks: readonly string[] = []) =>
    detectPageSource(parsePage(makePage({ head: makeLinkHead(links) })), nodeLinks);

const found = (url: string, site: string) => ({ kind: 'found', citation: { url, site } });

describe('detectPageSource', () => {
    it('prefers the canonical link, then og:url, then the recipe node url, then its mainEntityOfPage', () => {
        const all = { canonical: 'https://www.a.com/c', ogUrl: 'https://www.a.com/o' };

        expect(detect(all, ['https://www.a.com/n', 'https://www.a.com/m'])).toEqual(
            found('https://www.a.com/c', 'a.com'),
        );
        expect(detect({ ogUrl: all.ogUrl }, ['https://www.a.com/n', 'https://www.a.com/m'])).toEqual(
            found('https://www.a.com/o', 'a.com'),
        );
        expect(detect({}, ['https://www.a.com/n', 'https://www.a.com/m'])).toEqual(
            found('https://www.a.com/n', 'a.com'),
        );
        expect(detect({}, ['https://www.a.com/m'])).toEqual(found('https://www.a.com/m', 'a.com'));
    });

    it('names the site by its registrable domain', () => {
        expect(detect({ canonical: 'https://www.example.co.uk/recipe/1' })).toEqual(
            found('https://www.example.co.uk/recipe/1', 'example.co.uk'),
        );
    });

    it('reads the canonical link whatever else is in rel, and og:url by name or by property', () => {
        const page = parsePage(
            '<head><link rel="alternate" href="https://other.com/x"><link rel="Canonical Alternate" href="https://a.com/c"></head>',
        );

        expect(detectPageSource(page, [])).toEqual(found('https://a.com/c', 'a.com'));
        expect(detectPageSource(parsePage('<meta name="og:url" content="https://a.com/n">'), [])).toEqual(
            found('https://a.com/n', 'a.com'),
        );
    });

    describe('a relative canonical link', () => {
        it('is resolved against the og:url the page also states', () => {
            expect(detect({ canonical: '/recipe/1/pie/', ogUrl: 'https://www.a.com/recipe/1/pie/?x=1' })).toEqual(
                found('https://www.a.com/recipe/1/pie/', 'a.com'),
            );
        });

        it('is resolved against a base element', () => {
            expect(detect({ canonical: 'recipe/1', base: 'https://a.com/' })).toEqual(
                found('https://a.com/recipe/1', 'a.com'),
            );
        });

        it('is no source when nothing on the page says which site it is on', () => {
            expect(detect({ canonical: '/recipe/1/pie/' })).toEqual({ kind: 'none' });
        });
    });

    describe('what is refused', () => {
        it.each([
            ['our own site', 'https://commise.app/recipes/1'],
            ['our own subdomain', 'https://www.commise.app/recipes/1'],
            ['javascript:', 'javascript:alert(1)'],
            ['data:', 'data:text/html,hi'],
            ['an IPv4 address', 'http://192.168.0.1/recipe'],
            ['an IPv6 address', 'http://[::1]/recipe'],
            ['localhost', 'http://localhost:3000/recipe'],
            ['an address with credentials', 'https://user:pw@a.com/x'],
            ['an address that is too long', `https://a.com/${'x'.repeat(3_000)}`],
        ])('refuses %s', (_name, canonical) => {
            expect(detect({ canonical })).toEqual({ kind: 'none' });
        });

        it('skips a refused candidate and takes the next valid one', () => {
            expect(detect({ canonical: 'https://commise.app/x', ogUrl: 'https://a.com/o' })).toEqual(
                found('https://a.com/o', 'a.com'),
            );
            expect(detect({ canonical: 'javascript:alert(1)' }, ['https://a.com/n'])).toEqual(
                found('https://a.com/n', 'a.com'),
            );
        });
    });

    describe('when the candidates name different sites', () => {
        it('gives no source, because a guess is never a statement', () => {
            expect(detect({ canonical: 'https://a.com/c', ogUrl: 'https://b.com/o' })).toEqual({ kind: 'none' });
            expect(detect({ canonical: 'https://a.com/c' }, ['https://b.com/n'])).toEqual({ kind: 'none' });
        });

        it('accepts the same registrable domain on different hosts', () => {
            expect(detect({ canonical: 'https://www.a.com/c', ogUrl: 'https://m.a.com/o' })).toEqual(
                found('https://www.a.com/c', 'a.com'),
            );
        });
    });

    it('gives none for a page with no addresses', () => {
        expect(detectPageSource(parsePage('<p>hi</p>'), [])).toEqual({ kind: 'none' });
    });
});
