/**
 * The acceptance cases, on real files of the tree: what the selector answers for the changes the owner cares about.
 *
 * These pin the direction of every error: a leaf narrows, a shared primitive widens, documentation selects nothing,
 * and anything the graph cannot attribute selects everything. The file names below are real; a rename fails the
 * test loudly, which is the point.
 */
import { resolve } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { planChange, type Models } from '../src/planChange.js';
import { loadRepoModels } from '../src/repoModels.js';
import type { Plan, TierSelection } from '../src/selection.js';

const repo = resolve(import.meta.dirname, '../../../..');
const WEB = 'packages/apps/commise/web';
const UI = 'packages/apps/commise/ui';

const picked = (selection: TierSelection): readonly string[] =>
    selection.kind === 'some' ? selection.picks.map((pick) => pick.id) : ['<all>'];

describe('the impact of a change, over the real tree', () => {
    let models: Models;
    const plan = (files: readonly string[]): Promise<Plan> =>
        planChange(files, async () => models, { fullSuite: false });

    beforeAll(async () => {
        models = await loadRepoModels(repo);
    });

    it('a leaf component that one screen uses selects that screen`s tests only', async () => {
        const result = await plan([`${WEB}/src/app/[locale]/legal/sources/SourcesContent.tsx`]);
        const ids = picked(result.web);

        expect(result.web.kind).toBe('some');
        expect(ids.length).toBeGreaterThan(0);
        expect(ids.length).toBeLessThan(models.web.tests.length / 4);
        expect(ids).toContain('dataSources.spec.ts');

        for (const id of ids) {
            const row = models.web.coverage.get(id) ?? new Set<string>();

            expect(row.has('/legal/sources') || row.has('*'), `${id} has no reason to run`).toBe(true);
        }

        expect(result.mobile).toEqual({ kind: 'some', picks: [] });
    });

    it('an @commise/ui primitive selects almost every test', async () => {
        const result = await plan([`${UI}/src/button/index.ts`]);

        expect(result.web.kind === 'all' || picked(result.web).length >= models.web.tests.length * 0.9).toBe(true);
        expect(result.mobile.kind === 'all' || picked(result.mobile).length >= models.mobile.tests.length * 0.9).toBe(
            true,
        );
    });

    it('a change to documentation only selects zero', async () => {
        const result = await plan([
            'docs/architecture/decisions/0083-impacted-end-to-end-tests.md',
            'specs/001-commise-recipe-app/spec.md',
            'README.md',
        ]);

        expect(result.web).toEqual({ kind: 'some', picks: [] });
        expect(result.mobile).toEqual({ kind: 'some', picks: [] });
    });

    it('a service file selects the full suite', async () => {
        const result = await plan(['packages/services/identity/src/app.module.ts']);

        expect(result.web.kind).toBe('all');
        expect(result.mobile.kind).toBe('all');
    });

    it('the lockfile selects the full suite, and says so', async () => {
        const result = await plan(['package-lock.json']);

        expect(result.web).toEqual({ kind: 'all', reasons: ['package-lock.json: root configuration'] });
    });

    it('a file nothing imports selects the full suite', async () => {
        const result = await plan([`${WEB}/src/this-file-does-not-exist.ts`]);

        expect(result.web.kind).toBe('all');
    });

    it('a mobile-only screen file does not widen the web tier', async () => {
        const result = await plan(['packages/apps/commise/mobile/src/screens/CollectionsScreen.tsx']);

        expect(result.web).toEqual({ kind: 'some', picks: [] });
        expect(picked(result.mobile)).toEqual(expect.arrayContaining(['recipes/collections']));
    });

    it('a Playwright spec selects itself, and a Maestro sub-flow selects every flow that runs it', async () => {
        const spec = await plan([`${WEB}/tests/e2e/home.spec.ts`]);
        const sub = await plan(['packages/apps/commise/mobile/.maestro/auth/signin.yaml']);

        expect(picked(spec.web)).toEqual(['home.spec.ts']);
        expect(picked(sub.mobile).length).toBeGreaterThan(1);
    });

    describe('probes: each way the selector once skipped a test a change needs', () => {
        it('B1: a package a service or a test tool uses runs the whole suite on BOTH tiers', async () => {
            for (const file of [
                'packages/shared/clerk-verify/src/clerkVerify.ts',
                'packages/tools/e2e-fixtures/src/testPool.ts',
                'packages/shared/recipe-core/src/index.ts',
            ]) {
                const result = await plan([file]);

                expect(result.web.kind, `${file} web`).toBe('all');
                expect(result.mobile.kind, `${file} mobile`).toBe('all');
            }
        });

        it('B1: a tier narrows a file only when it provably belongs to the other platform', async () => {
            const webOnly = await plan([`${WEB}/src/app/[locale]/legal/sources/SourcesContent.tsx`]);
            const mobileOnly = await plan(['packages/apps/commise/mobile/src/screens/CollectionsScreen.tsx']);

            expect(webOnly.mobile).toEqual({ kind: 'some', picks: [] });
            expect(mobileOnly.web).toEqual({ kind: 'some', picks: [] });
        });

        it('B2: a non-markdown file under docs/ feeds a spec, so it runs the whole suite', async () => {
            const result = await plan(['docs/mockups/screens/screenHome.html']);

            expect(result.web.kind).toBe('all');
        });

        it('B2: markdown still selects zero', async () => {
            const result = await plan(['docs/plans/anything.md', 'specs/001-commise-recipe-app/spec.md']);

            expect(result.web).toEqual({ kind: 'some', picks: [] });
        });

        it('B3: an empty change set runs the whole suite, since it looks exactly like a wrong base ref', async () => {
            const result = await plan([]);

            expect(result.web.kind).toBe('all');
            expect(result.mobile.kind).toBe('all');
            expect(JSON.stringify(result.web)).toContain('no changed files');
        });

        it('B4: every flow that runs a sign-in sub-flow passes through the login screen', () => {
            expect(models.mobile.coverage.get('recipes/rating')).toContain('login');
            expect(models.mobile.coverage.get('home')).toContain('login');
        });

        it('B4: a change to the login screen selects the flows that sign in through it', async () => {
            const result = await plan(['packages/apps/commise/mobile/src/screens/login.tsx']);

            expect(picked(result.mobile)).toEqual(expect.arrayContaining(['recipes/rating', 'home']));
        });
    });
});
