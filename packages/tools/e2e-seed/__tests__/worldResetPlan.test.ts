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
const manifest = deriveFixtureManifest(RUN, 1);

/** The recipes the SIGNER is supposed to own. The co-author's risotto is deliberately not among them. */
const signerRecipes = manifest.recipes.filter((r) => r.owner === 'signer');
const signerTitles = signerRecipes.map((r) => r.title);

/** A library row for a manifest title, AT the manifest's visibility — the settled shape of that row. */
const row = (id: string, title: string): WorldSnapshot['recipes'][number] => ({
    id,
    title,
    visibility: signerRecipes.find((recipe) => recipe.title === title)?.visibility ?? 'private',
});

const snapshot = (over: Partial<WorldSnapshot> = {}): WorldSnapshot => ({
    recipes: [],
    collections: [],
    ...over,
});

const settled = (): WorldSnapshot => snapshot({ recipes: signerTitles.map((title, index) => row(`r${index}`, title)) });

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
                    ...signerTitles.map((title, index) => row(`r${index}`, title)),
                    { id: 'made', title: 'Maestro Weeknight Soup', visibility: 'private' },
                    { id: 'cloned', title: `Herb Risotto ${RUN}`, visibility: 'public' },
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
                    row('edited', `${first ?? ''} (edited)`),
                    ...rest.map((title, index) => row(`r${index}`, title)),
                ],
            }),
            manifest,
            'seeded',
        );

        expect(plan.deleteRecipeIds).toEqual(['edited']);
        expect(plan.create.map((recipe) => recipe.title)).toEqual([first]);
    });

    it('restores a recipe an earlier flow left at the WRONG VISIBILITY, by deleting and recreating it', () => {
        // `visibility.yaml` flips the seeded PRIVATE lamb to public and back. A flow that dies between the two
        // legs leaves a row whose TITLE still matches the manifest, so a title-only reconciliation would keep
        // it — and every later flow of the run would open a public lamb the manifest says is private, while the
        // preview's public Discover feed carried it. The row is residue in the same sense a renamed row is.
        const lamb = signerRecipes.find((recipe) => recipe.key === 'lamb');
        const others = signerRecipes.filter((recipe) => recipe.key !== 'lamb');
        expect(lamb?.visibility).toBe('private');

        const plan = planWorldReset(
            snapshot({
                recipes: [
                    { id: 'flipped', title: lamb?.title ?? '', visibility: 'public' },
                    ...others.map((recipe, index) => row(`r${index}`, recipe.title)),
                ],
            }),
            manifest,
            'seeded',
        );

        expect(plan.deleteRecipeIds).toEqual(['flipped']);
        expect(plan.create.map((recipe) => recipe.title)).toEqual([lamb?.title]);
    });

    it('keeps the row at the RIGHT visibility when a same-titled row is at the wrong one', () => {
        // Order must not decide which of two same-titled rows survives: the one that matches the manifest does.
        const lamb = signerRecipes.find((recipe) => recipe.key === 'lamb');
        const others = signerRecipes.filter((recipe) => recipe.key !== 'lamb');

        const plan = planWorldReset(
            snapshot({
                recipes: [
                    { id: 'flipped', title: lamb?.title ?? '', visibility: 'public' },
                    { id: 'right', title: lamb?.title ?? '', visibility: 'private' },
                    ...others.map((recipe, index) => row(`r${index}`, recipe.title)),
                ],
            }),
            manifest,
            'seeded',
        );

        expect(plan.deleteRecipeIds).toEqual(['flipped']);
        expect(plan.create).toEqual([]);
    });

    it('restores a recipe an earlier flow DELETED', () => {
        const plan = planWorldReset(
            snapshot({ recipes: signerTitles.slice(1).map((title, index) => row(`r${index}`, title)) }),
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
                    ...signerTitles.map((title, index) => row(`r${index}`, title)),
                    row('dupe', signerTitles[0] ?? ''),
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
            snapshot({ recipes: signerTitles.map((t, i) => row(`r${i}`, t)), collections: [{ id: 'c1' }] }),
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
        // `recipes/emptyLibrary` is the ONE flow that runs against a genuinely empty library — the
        // first-run screen a new account opens on, which the seeded fixture is exactly what hides.
        const plan = planWorldReset(
            snapshot({ recipes: signerTitles.map((t, i) => row(`r${i}`, t)), collections: [{ id: 'c1' }] }),
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
