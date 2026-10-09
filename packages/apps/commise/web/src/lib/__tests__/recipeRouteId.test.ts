/**
 * The recipe routes' id boundary, as the middleware applies it. A page's own `notFound()` cannot give a 404: every page
 * sits inside `[locale]/loading.tsx`'s Suspense boundary, so the shell has gone out with a 200 before the page body
 * runs (measured on a production build: `/en/recipes/parse` answered 200 with a `noindex` meta). So the middleware
 * rewrites a path that names no recipe to one no route matches, and the app's global not-found answers it with 404.
 */
import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { addRecipeToCollectionRequestSchema } from '@kitchensink/schema-recipe';
import { describe, expect, it } from 'vitest';

import { RECIPES_STATIC_ROUTES, isRecipeRouteId, notARecipeRewrite } from '../recipeRouteId';

const V4 = '0a6c2f4e-8b1d-4c3a-9e2f-1d2c3b4a5f60';
const V7 = '01928f3a-7b2c-7d4e-8f5a-6b7c8d9e0f1a';

describe('isRecipeRouteId', () => {
    it.each([V4, V7, V4.toUpperCase()])('takes the recipe id %s', (id) => {
        expect(isRecipeRouteId(id)).toBe(true);
    });

    it.each(['parse', 'new', 'rec_1', 'local:recipe:abc123', '', `${V4}x`, V4.slice(1)])('refuses %s', (id) => {
        expect(isRecipeRouteId(id)).toBe(false);
    });
});

/**
 * The middleware reads zod's UUID pattern instead of importing the contract (bundle size — see the module doc), so this
 * holds it to the contract's answer over shapes either side could disagree on: a GUID that is no RFC UUID, the nil and
 * max ids, case, versions, and near misses.
 */
describe('isRecipeRouteId — the recipe contract’s id shape', () => {
    const contract = addRecipeToCollectionRequestSchema.shape.recipeId;

    it.each([
        V4,
        V7,
        V4.toUpperCase(),
        '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
        '11111111-1111-1111-1111-111111111111',
        '11111111-1111-0111-8111-111111111111',
        '11111111-1111-9111-8111-111111111111',
        '00000000-0000-0000-0000-000000000000',
        'ffffffff-ffff-ffff-ffff-ffffffffffff',
        `{${V4}}`,
        V4.replaceAll('-', ''),
        ` ${V4}`,
        'parse',
        '',
    ])('agrees with the contract on %j', (candidate) => {
        expect(isRecipeRouteId(candidate)).toBe(contract.safeParse(candidate).success);
    });
});

describe('notARecipeRewrite', () => {
    it.each([
        ['/en/recipes/parse', '/en/_not-a-recipe'],
        ['/en/recipes/parse/edit', '/en/_not-a-recipe'],
        ['/en/recipes/rec_1/versions', '/en/_not-a-recipe'],
        ['/en/recipes/local:recipe:abc', '/en/_not-a-recipe'],
        // A static route's name is not a recipe id below it: `/recipes/new/edit` would otherwise reach `[id]/edit`.
        ['/en/recipes/new/edit', '/en/_not-a-recipe'],
        ['/es/recipes/parse', '/es/_not-a-recipe'],
    ])('sends %s to %s', (pathname, target) => {
        expect(notARecipeRewrite(pathname)).toBe(target);
    });

    it.each([
        '/en/recipes',
        '/en/recipes/',
        '/en/recipes/new',
        `/en/recipes/${V4}`,
        `/en/recipes/${V4}/`,
        `/en/recipes/${V4}/edit`,
        `/en/recipes/${V7}/versions`,
        '/en/collections/parse',
        '/en/discover',
        '/en',
    ])('leaves %s alone', (pathname) => {
        expect(notARecipeRewrite(pathname)).toBeUndefined();
    });
});

/**
 * The static routes beside `[id]` are named in code because the middleware cannot read the app directory. This pins
 * that name list to the directory, both ways: a new static route under `/recipes` that the list misses would be
 * rewritten to the 404, and a name the list keeps after its route is deleted would let a non-id through.
 */
describe('RECIPES_STATIC_ROUTES', () => {
    it('is exactly the static pages under app/[locale]/recipes', () => {
        const root = join(import.meta.dirname, '..', '..', 'app', '[locale]', 'recipes');
        const pages: string[] = [];

        const walk = (dir: string): void => {
            for (const entry of readdirSync(dir)) {
                const path = join(dir, entry);

                if (statSync(path).isDirectory()) {
                    if (
                        !entry.startsWith('[') &&
                        !entry.startsWith('(') &&
                        !entry.startsWith('_') &&
                        entry !== '__tests__'
                    ) {
                        walk(path);
                    }
                } else if (/^page\.(tsx|ts|jsx|js)$/u.test(entry) && dir !== root) {
                    pages.push(relative(root, dir).split(sep).join('/'));
                }
            }
        };

        walk(root);

        expect(new Set(pages)).toEqual(RECIPES_STATIC_ROUTES);
    });
});
