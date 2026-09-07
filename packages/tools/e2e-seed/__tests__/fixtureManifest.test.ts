/**
 * The manifest is the contract between a TypeScript package, a bash script and twenty-odd YAML flows. These
 * assertions pin the properties every one of those consumers depends on.
 */
import { describe, expect, it } from 'vitest';

import {
    deriveFixtureManifest,
    FIXTURE_ENV_KEYS,
    manifestToEnvLines,
    runScopedTitle,
    SEED_WORLD,
    UNATTACHED_PROBE_INGREDIENT,
} from '../src/fixtureManifest.js';

const RUN = 'gh42-1-maestro';

describe('deriveFixtureManifest', () => {
    it('is deterministic — provision, ~35 resets and teardown must agree without passing state', () => {
        expect(deriveFixtureManifest(RUN)).toEqual(deriveFixtureManifest(RUN));
    });

    it('scopes every title to the run, with the run key LAST', () => {
        // Suffix, not prefix: several flows scroll to a row by its leading words and match unanchored, so a
        // prefix would break every one of them while a suffix keeps the base title matchable.
        for (const recipe of deriveFixtureManifest(RUN).recipes) {
            expect(recipe.title).toBe(`${recipe.baseTitle} ${RUN}`);
            expect(recipe.title.startsWith(recipe.baseTitle)).toBe(true);
        }
    });

    it('gives two runs disjoint titles — the whole reason titles are scoped at all', () => {
        const mine = deriveFixtureManifest(RUN).recipes.map((recipe) => recipe.title);
        const theirs = deriveFixtureManifest('gh99-1-other').recipes.map((recipe) => recipe.title);

        expect(mine.filter((title) => theirs.includes(title))).toEqual([]);
    });

    it('gives the three identities three distinct addresses', () => {
        const manifest = deriveFixtureManifest(RUN);
        const addresses = [manifest.signInEmail, manifest.coAuthorEmail, manifest.erasureEmail];

        expect(new Set(addresses).size).toBe(3);
        expect(addresses.every((address) => address.includes('+clerk_test@'))).toBe(true);
    });

    it('is frozen — a manifest a caller can edit is a manifest that drifts between processes', () => {
        const manifest = deriveFixtureManifest(RUN);

        expect(Object.isFrozen(manifest)).toBe(true);
        expect(Object.isFrozen(manifest.recipes)).toBe(true);
        expect(manifest.recipes.every((recipe) => Object.isFrozen(recipe))).toBe(true);
    });

    it('owns exactly three signer recipes, which is what makes "3 recipes" true', () => {
        // `search-navigation.yaml` and `serving-scale.yaml` both assert `^3 recipes$` on the library screen.
        expect(deriveFixtureManifest(RUN).recipes.filter((recipe) => recipe.owner === 'signer')).toHaveLength(3);
    });

    it('gives the co-author exactly one PUBLIC recipe — a row the signer does not own', () => {
        const coAuthored = deriveFixtureManifest(RUN).recipes.filter((recipe) => recipe.owner === 'coAuthor');

        expect(coAuthored).toHaveLength(1);
        expect(coAuthored[0]?.visibility).toBe('public');
        expect(coAuthored[0]?.baseTitle).toBe('Herb Risotto');
    });

    it('NEVER attaches the discovery probe ingredient to any recipe', () => {
        // `search-navigation.yaml` filters discovery by this name and asserts the feed collapses to "No
        // matching recipes". Attaching it anywhere turns that flow red for a reason no diff explains.
        const attached = SEED_WORLD.flatMap((recipe) => recipe.ingredients.map((line) => line.name));

        expect(attached).not.toContain(UNATTACHED_PROBE_INGREDIENT);
    });

    it('omits `unit` on a unitless line rather than sending an empty string', () => {
        // `seed.ts` writes `''` because the database accepts it; the WRITE schema rejects it. The read
        // projection turns both into an absent unit, so the rendered detail is identical either way.
        const units = SEED_WORLD.flatMap((recipe) => recipe.ingredients.map((line) => line.unit));

        expect(units).not.toContain('');
    });

    it('keeps the scalars `serving-scale.yaml` asserts', () => {
        // That flow's own docblock explains why THIS recipe: doubled, 10/10/20 gives 20/10/30, all
        // distinct — whereas the lamb's 15/30 doubles into a prep that reads the same as its cook time.
        const asparagus = SEED_WORLD.find((recipe) => recipe.baseTitle === 'Asparagus with Green Sauce');

        expect(asparagus).toMatchObject({
            servings: 2,
            prepTimeMinutes: 10,
            cookTimeMinutes: 10,
            totalTimeMinutes: 20,
        });
        expect(asparagus?.ingredients).toHaveLength(5);
    });

    it('gives every recipe real lines and real steps', () => {
        for (const recipe of SEED_WORLD) {
            expect(recipe.ingredients.length).toBeGreaterThan(0);
            expect(recipe.steps.length).toBeGreaterThan(0);
            expect(recipe.ingredients.every((line) => line.quantity > 0)).toBe(true);
            expect(recipe.steps.every((step) => step.instruction.length > 0)).toBe(true);
        }
    });
});

describe('manifestToEnvLines', () => {
    it('emits exactly the registry, one KEY=VALUE per line, nothing else', () => {
        const lines = manifestToEnvLines(deriveFixtureManifest(RUN));

        expect(lines.map((line) => line.split('=')[0]).sort()).toEqual([...Object.values(FIXTURE_ENV_KEYS)].sort());
        expect(lines.every((line) => /^[A-Z0-9_]+=.+$/.test(line))).toBe(true);
    });

    it('carries the run-scoped titles, not the base ones', () => {
        const lines = manifestToEnvLines(deriveFixtureManifest(RUN));

        expect(lines).toContain(`${FIXTURE_ENV_KEYS.risotto}=${runScopedTitle('Herb Risotto', RUN)}`);
    });

    it('never emits an empty value — a blank renders as the literal ${VAR} on screen', () => {
        expect(manifestToEnvLines(deriveFixtureManifest(RUN)).every((line) => line.split('=')[1] !== '')).toBe(true);
    });
});
