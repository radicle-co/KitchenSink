/**
 * The reset is a RECONCILIATION, not a mutation script: it compares the signer's library to the manifest
 * and emits the difference. Keeping that decision pure is what makes it testable at all — the applier that
 * carries it out talks to a deployed service over HTTP.
 *
 * Every assertion below is written to fail if the planner is subtly wrong, not merely if it is absent.
 */
import { describe, expect, it } from 'vitest';

import { deriveFixtureManifest } from '../src/fixtureManifest.js';
import { planWorldReset, type WorldSnapshot } from '../src/worldResetPlan.js';

const RUN = 'gh42-1-maestro';
const manifest = deriveFixtureManifest(RUN);

/** The titles the SIGNER is supposed to own. The co-author's risotto is deliberately not among them. */
const signerTitles = manifest.recipes.filter((r) => r.owner === 'signer').map((r) => r.title);

const snapshot = (over: Partial<WorldSnapshot> = {}): WorldSnapshot => ({
    recipes: [],
    collections: [],
    ...over,
});

const settled = (): WorldSnapshot =>
    snapshot({ recipes: signerTitles.map((title, index) => ({ id: `r${index}`, title })) });

describe('planWorldReset — seeded mode', () => {
    it('plans nothing at all against a world that already matches', () => {
        const plan = planWorldReset(settled(), manifest, 'seeded');

        // The flat case matters: this runs ~35 times per job, and a plan that recreated the world every
        // time would spend the write throttle and add a minute per flow for no change.
        expect(plan).toEqual({ deleteRecipeIds: [], deleteCollectionIds: [], create: [] });
    });

    it('creates every signer recipe against an empty world, and NEVER the co-author"s', () => {
        const plan = planWorldReset(snapshot(), manifest, 'seeded');

        expect(plan.create.map((recipe) => recipe.title)).toEqual(signerTitles);
        expect(plan.create.every((recipe) => recipe.owner === 'signer')).toBe(true);
        expect(plan.create.map((r) => r.baseTitle)).not.toContain('Herb Risotto');
    });

    it('deletes what a flow left behind — a created recipe, and a clone of the co-author"s', () => {
        const plan = planWorldReset(
            snapshot({
                recipes: [
                    ...signerTitles.map((title, index) => ({ id: `r${index}`, title })),
                    { id: 'made', title: 'Maestro Weeknight Soup' },
                    { id: 'cloned', title: `Herb Risotto ${RUN}` },
                ],
            }),
            manifest,
            'seeded',
        );

        expect([...plan.deleteRecipeIds].sort()).toEqual(['cloned', 'made']);
        expect(plan.create).toEqual([]);
    });

    it('restores a recipe an earlier flow RENAMED, by deleting the renamed row and recreating it', () => {
        // `edit.yaml` suffixes a title with " (edited)". The renamed row is no longer any manifest title,
        // so it goes — and the manifest title is then missing, so it comes back. Both halves, one pass.
        const [first, ...rest] = signerTitles;
        const plan = planWorldReset(
            snapshot({
                recipes: [
                    { id: 'edited', title: `${first ?? ''} (edited)` },
                    ...rest.map((title, index) => ({ id: `r${index}`, title })),
                ],
            }),
            manifest,
            'seeded',
        );

        expect(plan.deleteRecipeIds).toEqual(['edited']);
        expect(plan.create.map((recipe) => recipe.title)).toEqual([first]);
    });

    it('restores a recipe an earlier flow DELETED', () => {
        const plan = planWorldReset(
            snapshot({ recipes: signerTitles.slice(1).map((title, index) => ({ id: `r${index}`, title })) }),
            manifest,
            'seeded',
        );

        expect(plan.deleteRecipeIds).toEqual([]);
        expect(plan.create.map((recipe) => recipe.title)).toEqual([signerTitles[0]]);
    });

    it('keeps ONE row per manifest title and deletes the duplicates', () => {
        // A flow that clones an owned recipe leaves two rows with the same title. Keeping both would make
        // an anchored `tapOn` ambiguous and a count assertion wrong.
        const plan = planWorldReset(
            snapshot({
                recipes: [
                    ...signerTitles.map((title, index) => ({ id: `r${index}`, title })),
                    { id: 'dupe', title: signerTitles[0] ?? '' },
                ],
            }),
            manifest,
            'seeded',
        );

        expect(plan.deleteRecipeIds).toEqual(['dupe']);
        expect(plan.create).toEqual([]);
    });

    it('always clears collections — the seeded world contains none, and the flows assert that', () => {
        const plan = planWorldReset(
            snapshot({ recipes: signerTitles.map((t, i) => ({ id: `r${i}`, title: t })), collections: [{ id: 'c1' }] }),
            manifest,
            'seeded',
        );

        expect(plan.deleteCollectionIds).toEqual(['c1']);
    });

    it('is stable under input order — the same world plans the same way however it is listed', () => {
        const forwards = planWorldReset(settled(), manifest, 'seeded');
        const world = settled();
        const backwards = planWorldReset({ ...world, recipes: [...world.recipes].reverse() }, manifest, 'seeded');

        expect(backwards).toEqual(forwards);
    });
});

describe('planWorldReset — empty mode', () => {
    it('deletes everything and creates nothing', () => {
        // `recipes/empty-library` is the ONE flow that runs against a genuinely empty library — the
        // first-run screen a new account opens on, which the seeded fixture is exactly what hides.
        const plan = planWorldReset(
            snapshot({ recipes: signerTitles.map((t, i) => ({ id: `r${i}`, title: t })), collections: [{ id: 'c1' }] }),
            manifest,
            'empty',
        );

        expect(plan.create).toEqual([]);
        expect(plan.deleteRecipeIds).toHaveLength(signerTitles.length);
        expect(plan.deleteCollectionIds).toEqual(['c1']);
    });

    it('plans nothing against a world that is already empty', () => {
        expect(planWorldReset(snapshot(), manifest, 'empty')).toEqual({
            deleteRecipeIds: [],
            deleteCollectionIds: [],
            create: [],
        });
    });
});
