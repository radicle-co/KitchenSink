// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';

import Link from '../nextLink.js';

const hrefOf = (name: string): string | null => screen.getByRole('link', { name }).getAttribute('href');

describe('next/link Adapter', () => {
    const cases = [
        { name: 'string href', href: '/en/recipes', expected: '/en/recipes' },
        { name: 'pathname only', href: { pathname: '/en/recipes' }, expected: '/en/recipes' },
        {
            name: 'pathname and object query',
            href: { pathname: '/en/recipes', query: { q: 'soup', page: 2 } },
            expected: '/en/recipes?q=soup&page=2',
        },
        {
            name: 'a repeated query key',
            href: { pathname: '/r', query: { tag: ['a', 'b'] } },
            expected: '/r?tag=a&tag=b',
        },
        { name: 'string query', href: { pathname: '/r', query: 'x=1' }, expected: '/r?x=1' },
        { name: 'search', href: { pathname: '/r', search: '?y=2' }, expected: '/r?y=2' },
        { name: 'hash with its marker', href: { pathname: '/r', hash: '#top' }, expected: '/r#top' },
        { name: 'hash without its marker', href: { pathname: '/r', hash: 'top' }, expected: '/r#top' },
        { name: 'query and hash together', href: { pathname: '/r', query: { a: 1 }, hash: 'h' }, expected: '/r?a=1#h' },
        { name: 'an escaped query value', href: { pathname: '/r', query: { q: 'a b&c' } }, expected: '/r?q=a+b%26c' },
        { name: 'query without a pathname', href: { query: { a: 1 } }, expected: '?a=1' },
        { name: 'an empty object', href: {}, expected: '#' },
    ] as const;

    it.each(cases)('renders $name', ({ href, expected }) => {
        render(<Link href={href}>go</Link>);

        expect(hrefOf('go')).toBe(expected);
    });

    it('strips the props only next understands and forwards the rest', () => {
        const ref = createRef<HTMLAnchorElement>();
        render(
            <Link
                href="/x"
                ref={ref}
                prefetch={false}
                replace
                scroll={false}
                shallow
                passHref
                locale="fr"
                aria-label="Go there"
                className="c"
            >
                go
            </Link>,
        );

        const anchor = screen.getByRole('link', { name: 'Go there' });
        expect(ref.current).toBe(anchor);
        expect(anchor.className).toBe('c');

        for (const stripped of ['prefetch', 'replace', 'scroll', 'shallow', 'passhref', 'locale']) {
            expect(anchor.hasAttribute(stripped)).toBe(false);
        }
    });
});
