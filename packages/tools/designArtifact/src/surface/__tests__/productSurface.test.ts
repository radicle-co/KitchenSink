import { existsSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { COMMISE_ROOT, PACKAGE_ROOT } from '../../config.js';
import { CHROME_SURFACE, PRODUCT_SURFACE, SHIM_SURFACE, SURFACE_HOOKS } from '../productSurface.js';

const PRODUCT_NAMES = [
    'RecipeCard',
    'RecipeDiscoveryCard',
    'RecentRecipeGrid',
    'RecipeHero',
    'NutritionFigure',
    'ProfileRow',
    'ProfileGroup',
    'IngredientRow',
    'EditorHeader',
    'EditorSection',
    'EditorActionBar',
    'PublishLine',
];

describe('productSurface registry', () => {
    it('registers the twelve product components on both platforms, in the documented order', () => {
        expect(PRODUCT_SURFACE.web.map((c) => c.name)).toEqual(PRODUCT_NAMES);
        expect(PRODUCT_SURFACE.native.map((c) => c.name)).toEqual(PRODUCT_NAMES);
    });

    it('points web at the plain source and native at the .native sibling', () => {
        for (const component of PRODUCT_SURFACE.web) {
            expect(component.file).toMatch(new RegExp(`/${component.name}\\.tsx$`, 'u'));
        }

        for (const component of PRODUCT_SURFACE.native) {
            expect(component.file).toMatch(new RegExp(`/${component.name}\\.native\\.tsx$`, 'u'));
        }
    });

    it('registers the chrome: web sidebar and tab bar, native tab bar', () => {
        expect(CHROME_SURFACE.web.map((c) => c.name)).toEqual(['HomeSidebar', 'HomeTabBar']);
        expect(CHROME_SURFACE.native.map((c) => c.name)).toEqual(['HomeTabBar']);
        expect(CHROME_SURFACE.web.every((c) => c.file.includes('/web/src/components/home/chrome/'))).toBe(true);
        expect(CHROME_SURFACE.native.every((c) => c.file.includes('/mobile/src/components/home/chrome/'))).toBe(true);
    });

    it('registers useSnackbar as a hook both platforms need', () => {
        expect(SURFACE_HOOKS).toEqual([
            { name: 'useSnackbar', file: expect.stringMatching(/\/ui\/src\/snackbar\/useSnackbar\.ts$/u) },
        ]);
    });

    it('registers the two artifact-only native components the canvas boards mount, from the shims', () => {
        expect(SHIM_SURFACE.web).toEqual([]);
        expect(SHIM_SURFACE.native).toEqual([
            { name: 'SafeAreaProvider', file: expect.stringMatching(/\/src\/shims\/safeAreaContext\.tsx$/u) },
            { name: 'ScrollFrame', file: expect.stringMatching(/\/src\/shims\/scrollFrame\.tsx$/u) },
        ]);
    });

    it('keeps every registered file inside the Commise tree and on disk (a moved file fails here, not mid-build)', () => {
        const all = [
            ...PRODUCT_SURFACE.web,
            ...PRODUCT_SURFACE.native,
            ...CHROME_SURFACE.web,
            ...CHROME_SURFACE.native,
            ...SURFACE_HOOKS,
        ];

        for (const { file } of all) {
            expect(file.startsWith(`${COMMISE_ROOT}/`)).toBe(true);
            expect(existsSync(file), file).toBe(true);
        }

        for (const { file } of SHIM_SURFACE.native) {
            expect(file.startsWith(`${PACKAGE_ROOT}/src/shims/`)).toBe(true);
            expect(existsSync(file), file).toBe(true);
        }
    });
});
