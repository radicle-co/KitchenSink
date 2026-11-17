import { describe, expect, it } from 'vitest';

import { MAX_IMAGE_URL_CHARS } from '../pageCaps.js';
import { creditOf, imageRefsOf, imageUrlOf } from '../pageEvidence.js';

describe('creditOf', () => {
    it('reads authors, publisher, copyright notice, copyright holder and license', () => {
        expect(
            creditOf({
                author: [
                    { '@type': 'Person', name: 'Jane Cook' },
                    { '@type': 'Organization', name: 'Test Kitchen' },
                    'Sam Plain',
                ],
                publisher: { '@type': 'Organization', name: 'Pie Site' },
                copyrightNotice: '© 2026 Pie Site',
                copyrightHolder: { '@type': 'Organization', name: 'Pie Holdings' },
                license: 'https://creativecommons.org/licenses/by/4.0/',
            }),
        ).toEqual({
            authors: ['Jane Cook', 'Test Kitchen', 'Sam Plain'],
            publisher: 'Pie Site',
            copyrightNotice: '© 2026 Pie Site',
            copyrightHolder: 'Pie Holdings',
            license: 'https://creativecommons.org/licenses/by/4.0/',
        });
    });

    it('states nothing when the markup states nothing, and never reads a licence into silence (016 FR-012b)', () => {
        expect(creditOf({ name: 'Pie' })).toEqual({ authors: [] });
    });

    it.each([
        ['a string', 'Jane'],
        ['one node', { name: 'Jane' }],
        ['a list of one', [{ name: 'Jane' }]],
    ])('reads one author given as %s', (_label, author) => {
        expect(creditOf({ author }).authors).toEqual(['Jane']);
    });

    it('drops an author with no name, a blank one, and a duplicate, and reads at most 10', () => {
        expect(creditOf({ author: [{ '@id': '#a' }, '  ', 'Jane', 'Jane', { name: 'Ann' }] }).authors).toEqual([
            'Jane',
            'Ann',
        ]);
        const many = Array.from({ length: 25 }, (_, index) => `Author ${String(index)}`);

        expect(creditOf({ author: many }).authors).toEqual(many.slice(0, 10));
    });

    it('removes markup and decodes entities', () => {
        expect(creditOf({ author: 'Jane &amp; <b>Co</b>' }).authors).toEqual(['Jane & Co']);
    });

    it('leaves out a text field past its bound, and never cuts it short', () => {
        const credit = creditOf({
            author: ['x'.repeat(201), 'Ok'],
            publisher: 'p'.repeat(201),
            copyrightNotice: 'n'.repeat(1_001),
            copyrightHolder: 'h'.repeat(201),
            license: 'l'.repeat(2_001),
        });

        expect(credit).toEqual({ authors: ['Ok'] });
        expect(creditOf({ copyrightNotice: 'n'.repeat(1_000), license: 'l'.repeat(2_000) })).toMatchObject({
            copyrightNotice: 'n'.repeat(1_000),
            license: 'l'.repeat(2_000),
        });
    });

    it('reads a license given as a node by its url, else its id, else its name', () => {
        expect(creditOf({ license: { url: 'https://l.example/a' } }).license).toBe('https://l.example/a');
        expect(creditOf({ license: { '@id': 'https://l.example/b' } }).license).toBe('https://l.example/b');
        expect(creditOf({ license: { name: 'CC BY' } }).license).toBe('CC BY');
    });

    it('reads microdata properties, which arrive as lists', () => {
        expect(
            creditOf({
                author: [{ '@type': ['https://schema.org/Person'], name: ['Jane'] }],
                publisher: [{ name: ['Pie Site'] }],
                license: ['https://l.example/c'],
            }),
        ).toEqual({ authors: ['Jane'], publisher: 'Pie Site', license: 'https://l.example/c' });
    });

    it('reads a __proto__ key as data and pollutes nothing', () => {
        const node: unknown = JSON.parse('{"author":"Jane","__proto__":{"polluted":1}}');

        expect(creditOf(node as Record<string, unknown>)).toEqual({ authors: ['Jane'] });
        expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    });
});

describe('imageRefsOf', () => {
    it.each([
        ['a string', 'https://i.example/a.jpg', ['https://i.example/a.jpg']],
        ['an ImageObject url', { '@type': 'ImageObject', url: 'https://i.example/b.jpg' }, ['https://i.example/b.jpg']],
        ['an ImageObject contentUrl', { contentUrl: 'https://i.example/c.jpg' }, ['https://i.example/c.jpg']],
        [
            'a list',
            ['https://i.example/d.jpg', { url: 'https://i.example/e.jpg' }],
            ['https://i.example/d.jpg', 'https://i.example/e.jpg'],
        ],
        ['microdata lists', [['https://i.example/f.jpg']], ['https://i.example/f.jpg']],
        ['nothing usable', [{}, 5, null, ' '], []],
    ])('reads %s', (_label, image, refs) => {
        expect(imageRefsOf({ image })).toEqual(refs);
    });

    it('reads none from a node with no image', () => {
        expect(imageRefsOf({})).toEqual([]);
    });
});

describe('imageUrlOf', () => {
    const base = 'https://www.example.com/recipe/1/pie/';

    it('takes the first usable absolute http or https address', () => {
        expect(imageUrlOf(['https://i.example/a.jpg', 'https://i.example/b.jpg'], base)).toBe(
            'https://i.example/a.jpg',
        );
        expect(imageUrlOf(['http://i.example/a.jpg'], undefined)).toBe('http://i.example/a.jpg');
    });

    it('makes a relative address absolute against the canonical address', () => {
        expect(imageUrlOf(['/img/a.jpg'], base)).toBe('https://www.example.com/img/a.jpg');
        expect(imageUrlOf(['a.jpg'], base)).toBe('https://www.example.com/recipe/1/pie/a.jpg');
        expect(imageUrlOf(['//cdn.example.net/a.jpg'], base)).toBe('https://cdn.example.net/a.jpg');
    });

    it('drops a relative address when there is no canonical address', () => {
        expect(imageUrlOf(['/img/a.jpg'], undefined)).toBeUndefined();
    });

    it.each([
        'javascript:alert(1)',
        'data:image/png;base64,AAAA',
        'file:///etc/passwd',
        'ftp://i.example/a.jpg',
        'blob:https://x/y',
    ])('refuses %s', (ref) => {
        expect(imageUrlOf([ref], base)).toBeUndefined();
    });

    it('skips a refused address and takes the next', () => {
        expect(imageUrlOf(['javascript:alert(1)', 'https://i.example/ok.jpg'], base)).toBe('https://i.example/ok.jpg');
    });

    it('refuses an address past 2,000 characters, and accepts exactly 2,000', () => {
        const at = (length: number) => `https://i.example/${'x'.repeat(length - 'https://i.example/'.length)}`;

        expect(MAX_IMAGE_URL_CHARS).toBe(2_000);
        expect(imageUrlOf([at(2_001)], base)).toBeUndefined();
        expect(imageUrlOf([at(2_000)], base)).toHaveLength(2_000);
    });

    it('returns nothing for no addresses', () => {
        expect(imageUrlOf([], base)).toBeUndefined();
    });
});
