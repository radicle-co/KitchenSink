import { describe, expect, it } from 'vitest';

import { UI_SRC } from '../src/config.js';
import { discoverSurface } from '../src/surface/discoverSurface.js';

describe('discoverSurface over the real source tree', () => {
    const surface = discoverSurface();

    it('finds the design-system leaves and the registered product, chrome and hook entries on the web surface', () => {
        const names = surface.web.map((entry) => entry.name);

        expect(names).toEqual(
            expect.arrayContaining([
                'Button',
                'Chip',
                'Sheet',
                'RecipeCard',
                'PublishLine',
                'HomeSidebar',
                'HomeTabBar',
                'useSnackbar',
            ]),
        );
    });

    it('finds the native leaves, including ones the web surface has no counterpart for', () => {
        const names = surface.native.map((entry) => entry.name);

        expect(names).toEqual(
            expect.arrayContaining(['Button', 'Modal', 'BottomSheetPanel', 'RecipeCard', 'HomeTabBar']),
        );
        expect(names).not.toContain('HomeSidebar');
    });

    it('adds SafeAreaProvider and ScrollFrame to the native surface only, from the shims', () => {
        const native = surface.native.filter((entry) => ['SafeAreaProvider', 'ScrollFrame'].includes(entry.name));

        expect(native.map((entry) => entry.name)).toEqual(['SafeAreaProvider', 'ScrollFrame']);
        expect(native.every((entry) => entry.file.includes('/src/shims/'))).toBe(true);
        expect(surface.web.map((entry) => entry.name)).not.toContain('SafeAreaProvider');
        expect(surface.web.map((entry) => entry.name)).not.toContain('ScrollFrame');
    });

    it('publishes the product values a card reads on both surfaces, as values rather than components', () => {
        for (const entries of [surface.web, surface.native]) {
            const values = entries.filter((entry) => entry.kind === 'value');

            expect(values.map((entry) => entry.name)).toEqual([
                'offlineNoticeMessages',
                'recipeFormMessages',
                'recipeMessages',
                'seedLineKey',
            ]);
        }
    });

    it('never publishes the same name twice on one surface', () => {
        for (const entries of [surface.web, surface.native]) {
            const names = entries.map((entry) => entry.name);

            expect(new Set(names).size).toBe(names.length);
        }
    });

    it('serves native leaves from .native.tsx only, and web leaves from plain .tsx only, under @commise/ui', () => {
        for (const entry of surface.web.filter((e) => e.file.startsWith(`${UI_SRC}/`) && e.file.endsWith('x'))) {
            expect(entry.file, entry.name).not.toMatch(/\.native\.tsx$/u);
        }

        for (const entry of surface.native.filter((e) => e.file.startsWith(`${UI_SRC}/`) && e.file.endsWith('x'))) {
            expect(entry.file, entry.name).toMatch(/\.native\.tsx$/u);
        }
    });

    it.each(['testing', 'tokens', 'theme', 'backIntercept'])('leaves %s out of both surfaces', (directory) => {
        for (const entry of [...surface.web, ...surface.native]) {
            expect(entry.file.startsWith(`${UI_SRC}/${directory}/`), entry.file).toBe(false);
        }
    });
});
