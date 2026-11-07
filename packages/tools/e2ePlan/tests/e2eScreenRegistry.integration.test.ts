/**
 * The registry guard: the two coverage tables must describe the tests and screens that really exist, and the graph the
 * selector walks must have no blind spot. Runs over the real tree.
 *
 * A registry row that leaves out a screen its test passes through means that test does not run after a change to
 * that screen. That is the one failure the selector must not have, so every way a row can be wrong is a test here.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { glob } from 'tinyglobby';
import { beforeAll, describe, expect, it } from 'vitest';

import { checkCoverage, parseCoverage, uncoveredRoutes } from '../src/coverageTable.js';
import { buildImportGraph } from '../src/dependencyGraph.js';
import { FLOW_TABLE, loadRepoModels, SPEC_TABLE, WEB_PROFILE } from '../src/repoModels.js';
import { specRoutes } from '../src/specRoutes.js';

const repo = resolve(import.meta.dirname, '../../../..');
const WEB = 'packages/apps/commise/web';

describe('the screen registry, over the real tree', () => {
    let models: Awaited<ReturnType<typeof loadRepoModels>>;

    beforeAll(async () => {
        models = await loadRepoModels(repo);
    });

    it('leaves no import of the web app unfollowed', () => {
        expect(models.web.problems).toEqual([]);
    });

    it('leaves no import of the mobile app, and no Maestro reference, unfollowed', () => {
        expect(models.mobile.problems).toEqual([]);
    });

    it('has a row for every Playwright spec, a spec for every row, and only real screens in a row', async () => {
        const specs = (await glob(`${WEB}/tests/e2e/**/*.spec.ts`, { cwd: repo })).map((file) =>
            file.slice(`${WEB}/tests/e2e/`.length),
        );
        const table = parseCoverage(readFileSync(join(repo, SPEC_TABLE), 'utf8'), SPEC_TABLE);

        expect(checkCoverage({ tests: specs, screens: models.web.screens, table })).toEqual([]);
        expect(specs.length).toBeGreaterThan(0);
    });

    it('has a row for every top-level Maestro flow, a flow for every row, and only real screens in a row', () => {
        const table = parseCoverage(readFileSync(join(repo, FLOW_TABLE), 'utf8'), FLOW_TABLE);

        expect(checkCoverage({ tests: models.mobile.tests, screens: models.mobile.screens, table })).toEqual([]);
        expect(models.mobile.tests.length).toBeGreaterThan(0);
    });

    it('lists, in each spec row, every screen the spec and its helpers navigate to', async () => {
        const graph = await buildImportGraph(repo, WEB_PROFILE);
        const table = parseCoverage(readFileSync(join(repo, SPEC_TABLE), 'utf8'), SPEC_TABLE);
        const specs = (await glob(`${WEB}/tests/e2e/**/*.spec.ts`, { cwd: repo })).sort();
        const visits = specRoutes({
            dir: `${WEB}/tests/e2e`,
            specs,
            definitions: [`${WEB}/tests/e2e/utils/basePath.ts`],
            importsOf: graph.importsOf,
            read: (file) => readFileSync(join(repo, file), 'utf8'),
        });
        const problems = specs.flatMap((spec) => {
            const id = spec.slice(`${WEB}/tests/e2e/`.length);

            return uncoveredRoutes({
                row: table.get(id) ?? new Set(),
                screens: models.web.screens,
                visited: visits.get(spec) ?? { paths: [], dynamic: false },
            }).map((problem) => `${id}: ${problem}`);
        });

        expect(problems).toEqual([]);
    });

    it('derives the screens the app serves, among them the ones the specs name', () => {
        expect(models.web.screens).toEqual(expect.arrayContaining(['/', '/recipes', '/recipes/[id]', '/recipes/new']));
        expect(models.mobile.screens).toEqual(expect.arrayContaining(['HomeScreen', 'RecipeDetailScreen']));
    });
});
