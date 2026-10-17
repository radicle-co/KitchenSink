/**
 * The middleware matcher skips a request whose path names a static file (`[^?]*\.(?:html?|css|…)`), so `clerkMiddleware`
 * never runs for it and a page that reaches `auth()` throws — a 500 for `/en/collections/cover.png`. The page-side
 * guard, `isStaticAssetPath`, must therefore answer EXACTLY as the matcher does.
 *
 * The matcher is a build-time literal Next reads statically, so it cannot import the guard's list. This suite is what
 * holds the two equal: it takes the extension alternation OUT of `config.matcher`, compares it to the guard's list, and
 * then runs both over a table of paths (the clause is unanchored, so `.png/anything` and `.pngx` are skipped too).
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@clerk/nextjs/server', () => ({ clerkMiddleware: (handler: unknown) => handler }));
vi.mock('next/server', () => ({ NextResponse: {} }));

const { config } = await import('@/middleware');
const { STATIC_ASSET_EXTENSIONS, isStaticAssetPath } = await import('@/lib/staticAssetPath');

/** The page-matching clause of the matcher: the one that carries the extension exclusion. */
const pageMatcher = config.matcher.find((entry) => entry.includes('(?!'));

/** Whether Next would run the middleware for `pathname`: the matcher's regex, anchored as path-to-regexp anchors it. */
function middlewareRuns(pathname: string): boolean {
    return new RegExp(`^${pageMatcher}$`, 'u').test(pathname);
}

describe('the matcher the guard is held to', () => {
    it('is found, and carries an extension clause (so the suite is not vacuous)', () => {
        expect(pageMatcher).toBeDefined();
        expect(pageMatcher).toMatch(/\\\.\(\?:/u);
    });

    it('lists the SAME extensions as the guard, in the same order', () => {
        const alternation = /\[\^\?\]\*\\\.\(\?:(.+)\)\)\.\*\)$/u.exec(pageMatcher ?? '')?.[1];

        expect(alternation?.split('|')).toEqual([...STATIC_ASSET_EXTENSIONS]);
    });
});

describe('isStaticAssetPath answers as the middleware matcher does', () => {
    const paths = [
        '/en/collections/cover.png',
        '/en/collections/cover.PNG',
        '/en/collections/cover.png/more',
        '/en/collections/cover.pngx',
        '/x.png/recipes',
        '/en/legal/sources.html',
        '/en/legal/sources.htm',
        '/en/a.css',
        '/en/a.js',
        '/en/a.jsx',
        '/en/a.json',
        '/en/a.jpeg',
        '/en/a.jpg',
        '/en/a.webp',
        '/en/a.gif',
        '/en/a.svg',
        '/en/a.ttf',
        '/en/a.woff',
        '/en/a.woff2',
        '/en/a.ico',
        '/en/a.csv',
        '/en/a.doc',
        '/en/a.docx',
        '/en/a.xls',
        '/en/a.xlsx',
        '/en/a.zip',
        '/en/a.webmanifest',
        '/en/a.txt',
        '/en/a.xml',
        '/en/a.pdf',
        '/en/collections/0a6c2f4e-8b1d-4c3a-9e2f-1d2c3b4a5f60',
        '/en/collections/col_dinners',
        '/en/recipes/new',
        '/en',
        '/',
    ] as const;

    it.each(paths)('%s', (pathname) => {
        expect(isStaticAssetPath(pathname)).toBe(!middlewareRuns(pathname));
    });

    it('covers every extension the matcher lists (a new one added to the matcher fails the table above)', () => {
        for (const extension of STATIC_ASSET_EXTENSIONS) {
            const concrete = extension.replace('(?!on)', '').replace('?', '');

            expect(isStaticAssetPath(`/en/x.${concrete}`), extension).toBe(true);
            expect(middlewareRuns(`/en/x.${concrete}`), extension).toBe(false);
        }
    });

    it('reads the path only: a file name in the query string is not a file request', () => {
        expect(isStaticAssetPath('/en/discover?q=cover.png')).toBe(false);
        expect(middlewareRuns('/en/discover?q=cover.png')).toBe(true);
    });
});
