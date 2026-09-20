/**
 * The manifest is the contract between a TypeScript package, a bash script and twenty-odd YAML flows. These
 * assertions pin the properties every one of those consumers depends on.
 */
import {
    consumableSlots,
    maestroShardCapacity,
    maestroSlotForShard,
    POOL_PASSWORD,
    slotFor,
} from '@kitchensink/e2e-fixtures/testPool';
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
/** The shard whose identities these assertions are about; shard 1 is the unsharded tier. */
const SHARD = 1;
/** The erasure subject `provision` leased — a consumable pool slot, resolved at run time, never derived. */
const ERASURE = consumableSlots('maestro')[2]?.email ?? '';

describe('deriveFixtureManifest', () => {
    it('is deterministic — provision, ~35 resets and teardown must agree without passing state', () => {
        expect(deriveFixtureManifest(RUN, SHARD)).toEqual(deriveFixtureManifest(RUN, SHARD));
    });

    it('scopes every title to the run, with the run key LAST', () => {
        // Suffix, not prefix: several flows scroll to a row by its leading words and match unanchored, so a
        // prefix would break every one of them while a suffix keeps the base title matchable.
        for (const recipe of deriveFixtureManifest(RUN, SHARD).recipes) {
            expect(recipe.title).toBe(`${recipe.baseTitle} ${RUN}`);
            expect(recipe.title.startsWith(recipe.baseTitle)).toBe(true);
        }
    });

    it('gives two runs disjoint titles — the whole reason titles are scoped at all', () => {
        const mine = deriveFixtureManifest(RUN, SHARD).recipes.map((recipe) => recipe.title);
        const theirs = deriveFixtureManifest('gh99-1-other', SHARD).recipes.map((recipe) => recipe.title);

        expect(mine.filter((title) => theirs.includes(title))).toEqual([]);
    });

    /**
     * ⛔ REWRITTEN for the fixed pool (owner ruling 2026-09-13): the identities used to be derived from the RUN
     * KEY, three `createUser` calls per run. They are now the Maestro tier's roster slots — the SAME users on every
     * run, serialized by the tier's concurrency group — and only the recipe TITLES stay run-scoped.
     */
    it('signs in as the maestro tier’s fixed pool slots, the same on every run', () => {
        const manifest = deriveFixtureManifest(RUN, SHARD);

        expect(manifest.signInEmail).toBe(maestroSlotForShard('signer', SHARD).email);
        expect(manifest.coAuthorEmail).toBe(maestroSlotForShard('coauthor', SHARD).email);
        expect(deriveFixtureManifest('gh99-1-other', SHARD).signInEmail).toBe(manifest.signInEmail);
        expect(manifest.signInEmail).not.toBe(manifest.coAuthorEmail);
    });

    /**
     * ⛔ EXTENDED for SHARDING. `signInEmail` is the address the DEVICE types into the login form, so two shards
     * whose manifests named one signer would drive their emulators as the same user while holding separate API
     * sessions — and the per-flow reset, which reconciles that signer's library to the manifest, would then
     * delete the sibling shard's fixtures mid-flow. The shard is a REQUIRED parameter for exactly this reason:
     * a default would make the collision the quiet outcome.
     */
    it('⛔ gives each shard its OWN signer and co-author, so two shards never drive one user', () => {
        const capacity = maestroShardCapacity();

        expect(capacity, 'the roster must declare at least two shards for this to be a real assertion').toBe(2);

        const first = deriveFixtureManifest(RUN, 1);
        const second = deriveFixtureManifest(RUN, 2);

        expect(second.signInEmail).not.toBe(first.signInEmail);
        expect(second.coAuthorEmail).not.toBe(first.coAuthorEmail);
        expect(second.signInEmail).not.toBe(first.coAuthorEmail);
        expect(second.coAuthorEmail).not.toBe(first.signInEmail);
    });

    it('keeps shard 1 on the original addresses, so sharding re-provisions no Clerk user', () => {
        expect(deriveFixtureManifest(RUN, 1).signInEmail).toBe(slotFor('maestro', 'signer').email);
        expect(deriveFixtureManifest(RUN, 1).coAuthorEmail).toBe(slotFor('maestro', 'coauthor').email);
    });

    it('⛔ refuses a shard the roster cannot identify rather than wrapping onto shard 1', () => {
        expect(() => deriveFixtureManifest(RUN, maestroShardCapacity() + 1)).toThrow(/poolAdmin/u);
    });

    it('types the password the pool provisions its password-bearing slots with', () => {
        expect(deriveFixtureManifest(RUN, SHARD).password).toBe(POOL_PASSWORD);
    });

    it('is frozen — a manifest a caller can edit is a manifest that drifts between processes', () => {
        const manifest = deriveFixtureManifest(RUN, SHARD);

        expect(Object.isFrozen(manifest)).toBe(true);
        expect(Object.isFrozen(manifest.recipes)).toBe(true);
        expect(manifest.recipes.every((recipe) => Object.isFrozen(recipe))).toBe(true);
    });

    it('owns exactly three signer recipes, which is what makes "3 recipes" true', () => {
        // `searchNavigation.yaml` and `servingScale.yaml` both assert `^3 recipes$` on the library screen.
        expect(deriveFixtureManifest(RUN, SHARD).recipes.filter((recipe) => recipe.owner === 'signer')).toHaveLength(3);
    });

    it('gives the co-author exactly one PUBLIC recipe — a row the signer does not own', () => {
        const coAuthored = deriveFixtureManifest(RUN, SHARD).recipes.filter((recipe) => recipe.owner === 'coAuthor');

        expect(coAuthored).toHaveLength(1);
        expect(coAuthored[0]?.visibility).toBe('public');
        expect(coAuthored[0]?.baseTitle).toBe('Herb Risotto');
    });

    it('NEVER attaches the discovery probe ingredient to any recipe', () => {
        // `searchNavigation.yaml` filters discovery by this name and asserts the feed collapses to "No
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

    it('keeps the scalars `servingScale.yaml` asserts', () => {
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
        const lines = manifestToEnvLines(deriveFixtureManifest(RUN, SHARD), ERASURE);

        expect(lines.map((line) => line.split('=')[0]).sort()).toEqual([...Object.values(FIXTURE_ENV_KEYS)].sort());
        expect(lines.every((line) => /^[A-Z0-9_]+=.+$/.test(line))).toBe(true);
    });

    it('carries the run-scoped titles, not the base ones', () => {
        const lines = manifestToEnvLines(deriveFixtureManifest(RUN, SHARD), ERASURE);

        expect(lines).toContain(`${FIXTURE_ENV_KEYS.risotto}=${runScopedTitle('Herb Risotto', RUN)}`);
    });

    it('carries the LEASED erasure subject, not a derived one', () => {
        expect(manifestToEnvLines(deriveFixtureManifest(RUN, SHARD), ERASURE)).toContain(
            `${FIXTURE_ENV_KEYS.erasureEmail}=${ERASURE}`,
        );
    });

    it('refuses an erasure subject that is not a consumable pool slot — the flow really erases it', () => {
        expect(() => manifestToEnvLines(deriveFixtureManifest(RUN, SHARD), slotFor('maestro', 'signer').email)).toThrow(
            /consumable/u,
        );
        expect(() => manifestToEnvLines(deriveFixtureManifest(RUN, SHARD), 'someone@example.com')).toThrow(
            /consumable/u,
        );
    });

    it('never emits an empty value — a blank renders as the literal ${VAR} on screen', () => {
        expect(
            manifestToEnvLines(deriveFixtureManifest(RUN, SHARD), ERASURE).every((line) => line.split('=')[1] !== ''),
        ).toBe(true);
    });
});
