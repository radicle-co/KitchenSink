/**
 * The name-level walk over the real tree (ADR-0086): a barrel no longer carries every change of its package to every
 * app file that imports any name from it. These assert screens and roots, which are the graph's own answer, and not
 * flow counts, which move with the registry rows.
 */
import { resolve } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { buildImportGraph, type ImportGraph } from '../src/dependencyGraph.js';
import { parseBindings } from '../src/moduleBindings.js';
import { planChange, type Models } from '../src/planChange.js';
import { MOBILE_PROFILE, loadRepoModels } from '../src/repoModels.js';
import { readFileSync } from 'node:fs';

const repo = resolve(import.meta.dirname, '../../../..');
const APPS = 'packages/apps/commise';
const NATIVE_ROW = `${APPS}/features/recipes/src/detail/IngredientCheckRow.native.tsx`;
const WEB_ROW = `${APPS}/features/recipes/src/detail/IngredientCheckRow.tsx`;
const BARREL = `${APPS}/features/recipes/src/index.ts`;
const ROUTES = `${APPS}/mobile/src/navigation/routes.ts`;

describe('a leaf behind the recipes package barrel', () => {
    let models: Models;

    beforeAll(async () => {
        models = await loadRepoModels(repo);
    });

    const plan = (files: readonly string[]) => planChange(files, async () => models, { fullSuite: false });

    it('reaches the detail screen and no root on mobile', () => {
        const reached = models.mobile.reachFile(NATIVE_ROW);

        expect(reached?.roots).toEqual([]);
        expect([...(reached?.screens ?? [])]).toContain('RecipeDetailScreen');
    });

    it('selects a strict, non-empty subset of the Maestro flows, with the detail flows in it', async () => {
        const result = await plan([NATIVE_ROW]);

        expect(result.mobile.kind).toBe('some');

        const ids = result.mobile.kind === 'some' ? result.mobile.picks.map((pick) => pick.id) : [];

        expect(ids.length).toBeGreaterThan(0);
        expect(ids.length).toBeLessThan(models.mobile.tests.length);
        expect(ids.some((id) => models.mobile.coverage.get(id)?.has('RecipeDetailScreen'))).toBe(true);
    });

    it('selects a strict subset of the web specs for the web twin, and no flow', async () => {
        const result = await plan([WEB_ROW]);

        expect(result.web.kind).toBe('some');
        expect(result.web.kind === 'some' ? result.web.picks.length : 0).toBeLessThan(models.web.tests.length);
        expect(result.mobile).toEqual({ kind: 'some', picks: [] });
    });

    it('does not make a mobile-only leaf run the whole web tier', async () => {
        const result = await plan([`${APPS}/ui/src/text/Text.native.tsx`]);

        expect(result.web).toEqual({ kind: 'some', picks: [] });
    });
});

describe('negative control: a name the navigation takes from the barrel', () => {
    let graph: ImportGraph;
    let models: Models;

    beforeAll(async () => {
        [graph, models] = await Promise.all([buildImportGraph(repo, MOBILE_PROFILE), loadRepoModels(repo)]);
    });

    /** The file that declares a name `routes.ts` takes from the barrel, found at run time from the two parses. */
    function declaringFile(): string {
        const taken = parseBindings(readFileSync(resolve(repo, ROUTES), 'utf8'), ROUTES).bySpecifier.get(
            '@commise/features-recipes',
        )?.uses;
        const barrel = parseBindings(readFileSync(resolve(repo, BARREL), 'utf8'), BARREL);

        expect(taken, 'routes.ts no longer imports from the recipes barrel').not.toBe('all');

        for (const [specifier, binding] of barrel.bySpecifier) {
            const passed = binding.reexports;
            const source = graph.specifiersOf(BARREL).get(specifier);

            if (
                passed instanceof Map &&
                source !== undefined &&
                [...passed.values()].flat().some((name) => taken instanceof Set && taken.has(name))
            ) {
                return source;
            }
        }

        throw new Error('no file behind the barrel declares a name routes.ts takes');
    }

    it('still selects the whole mobile tier, because the navigation uses it', async () => {
        const result = await planChange([declaringFile()], async () => models, { fullSuite: false });

        expect(result.mobile.kind).toBe('all');
    });
});
