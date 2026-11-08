import { describe, expect, it } from 'vitest';

import { matchRoute, webRegistry } from '../src/webRoutes.js';

const APP = 'web/src/app';
const file = (path: string): string => `${APP}/${path}`;

const registry = webRegistry({
    appDir: APP,
    extraRoots: ['web/src/middleware.ts'],
    files: [
        'appDocument.tsx',
        'globals.css',
        'global-error.tsx',
        '[locale]/layout.tsx',
        '[locale]/error.tsx',
        '[locale]/page.tsx',
        '[locale]/recipes/page.tsx',
        '[locale]/recipes/loading.tsx',
        '[locale]/recipes/error.tsx',
        '[locale]/recipes/new/page.tsx',
        '[locale]/recipes/[id]/page.tsx',
        '[locale]/recipes/[id]/edit/page.tsx',
        '[locale]/recipes/[id]/edit/loading.tsx',
        '[locale]/legal/sources/page.tsx',
        '[locale]/legal/sources/SourcesContent.tsx',
        '[locale]/sign-in/[[...sign-in]]/page.tsx',
        '[locale]/__tests__/layout.test.tsx',
        '[locale]/legal/sources/__tests__/page.test.ts',
    ].map(file),
});

describe('webRegistry', () => {
    it('makes one screen per page, named by its route without the locale', () => {
        expect([...registry.screens].sort()).toEqual([
            '/',
            '/legal/sources',
            '/recipes',
            '/recipes/[id]',
            '/recipes/[id]/edit',
            '/recipes/new',
            '/sign-in/[[...sign-in]]',
        ]);
    });

    it('gives a screen its own page and the boundaries of every folder above it', () => {
        const editEntries = [...registry.terminals.screenEntries]
            .filter(([, screens]) => screens.includes('/recipes/[id]/edit'))
            .map(([path]) => path)
            .sort();

        expect(editEntries).toEqual(
            [
                '[locale]/recipes/[id]/edit/loading.tsx',
                '[locale]/recipes/[id]/edit/page.tsx',
                '[locale]/recipes/error.tsx',
                '[locale]/recipes/loading.tsx',
            ].map(file),
        );
    });

    it('lets a boundary reach every screen below it', () => {
        expect(registry.terminals.screenEntries.get(file('[locale]/recipes/loading.tsx'))).toEqual(
            expect.arrayContaining(['/recipes', '/recipes/new', '/recipes/[id]', '/recipes/[id]/edit']),
        );
    });

    it('treats the root layout, the app folder files and the extra roots as roots', () => {
        expect([...registry.terminals.roots].sort()).toEqual(
            ['appDocument.tsx', 'globals.css', 'global-error.tsx', '[locale]/layout.tsx', '[locale]/error.tsx']
                .map(file)
                .concat('web/src/middleware.ts')
                .sort(),
        );
    });

    it('does not make an entry of a file that is neither a page nor a boundary, or of a test', () => {
        expect(registry.terminals.screenEntries.has(file('[locale]/legal/sources/SourcesContent.tsx'))).toBe(false);
        expect(registry.terminals.screenEntries.has(file('[locale]/__tests__/layout.test.tsx'))).toBe(false);
    });

    it('makes a boundary with no page below it a root rather than dropping it', () => {
        const orphan = webRegistry({ appDir: APP, extraRoots: [], files: [file('[locale]/ghost/loading.tsx')] });

        expect([...orphan.terminals.roots]).toEqual([file('[locale]/ghost/loading.tsx')]);
    });

    it('drops a route group from the route name', () => {
        const grouped = webRegistry({ appDir: APP, extraRoots: [], files: [file('[locale]/(auth)/login/page.tsx')] });

        expect(grouped.screens).toEqual(['/login']);
    });

    it.each([
        '[locale]/@modal/page.tsx',
        '[locale]/(.)photo/page.tsx',
        '[locale]/api/thing/route.ts',
        '[locale]/recipes/@side/default.tsx',
    ])('treats %s as app-wide, since it cannot be mapped to one screen, rather than refusing to plan', (path) => {
        const mapped = webRegistry({
            appDir: APP,
            extraRoots: [],
            files: [file(path), file('[locale]/recipes/page.tsx')],
        });

        expect(mapped.terminals.roots.has(file(path))).toBe(true);
        expect(mapped.screens).toEqual(['/recipes']);
    });

    it('keeps the screens around one that cannot be mapped', () => {
        const mixed = webRegistry({
            appDir: APP,
            extraRoots: [],
            files: [
                file('[locale]/@modal/page.tsx'),
                file('[locale]/recipes/page.tsx'),
                file('[locale]/recipes/loading.tsx'),
            ],
        });

        expect(mixed.terminals.screenEntries.get(file('[locale]/recipes/loading.tsx'))).toEqual(['/recipes']);
    });
});

describe('matchRoute', () => {
    const screens = registry.screens;

    it.each([
        ['/', '/'],
        ['/recipes', '/recipes'],
        ['/recipes/new', '/recipes/new'],
        ['/recipes/abc-123', '/recipes/[id]'],
        ['/recipes/abc-123/edit', '/recipes/[id]/edit'],
        ['/sign-in', '/sign-in/[[...sign-in]]'],
        ['/sign-in/factor-one', '/sign-in/[[...sign-in]]'],
        ['/legal/sources', '/legal/sources'],
        ['/recipes?query=e#top', '/recipes'],
        ['/recipes/__dynamic__/edit', '/recipes/[id]/edit'],
    ])('sends %s to %s', (path, screen) => {
        expect(matchRoute(screens, path)).toBe(screen);
    });

    it('prefers the static segment over the dynamic one', () => {
        expect(matchRoute(['/recipes/[id]', '/recipes/new'], '/recipes/new')).toBe('/recipes/new');
        expect(matchRoute(['/recipes/new', '/recipes/[id]'], '/recipes/new')).toBe('/recipes/new');
    });

    it('answers nothing for a path no screen serves', () => {
        expect(matchRoute(screens, '/this-page-does-not-exist')).toBeUndefined();
        expect(matchRoute(screens, '/recipes/a/b/c')).toBeUndefined();
    });

    it('matches a required catch-all only with at least one segment', () => {
        expect(matchRoute(['/docs/[...slug]'], '/docs')).toBeUndefined();
        expect(matchRoute(['/docs/[...slug]'], '/docs/a/b')).toBe('/docs/[...slug]');
    });
});
