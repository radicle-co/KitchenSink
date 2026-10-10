/**
 * THE MAESTRO FIXTURE WORLD AGREES WITH THE SEED THE FLOWS CITE.
 *
 * A deployed Maestro run creates `SEED_WORLD` (`@kitchensink/e2e-seed`) over HTTP, but the flows were written against
 * recipe-service's `seed.ts` and cite it as the authority for what they assert: `servingScale.yaml`'s 2 servings and
 * 10/10/20 minutes, `listDetail.yaml`'s lamb, the "3 recipes" several flows wait for. So this asserts two things:
 *
 *   - every `SEED_WORLD` recipe agrees with the `seed.ts` recipe of the same title on every field its definition
 *     declares. The compared set is that TYPE's fields, not a list kept here: the fixture world's reason to change is
 *     what the flows assert, so its fields are the flows' reading set, and a field added to it is compared at once;
 *   - the signer's library is the same in both: no `seed.ts` recipe outside `SEED_WORLD` belongs to the signer.
 *
 * Where the two differ by design is recorded in `fixtureManifest.ts`'s header. Of those differences only the unit rule
 * touches a compared field, and {@link seedProjection} applies it.
 *
 * `seed.ts` is IMPORTED rather than parsed: importing it connects to nothing, because its CLI runs only when the file
 * is executed directly.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { SEED_WORLD, type FixtureOwner, type FixtureRecipeDefinition } from '@kitchensink/e2e-seed';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import {
    SEED_OWNER_FREE,
    SEED_OWNER_PRO,
    SEED_RECIPE_INGREDIENT_LINES,
    SEED_RECIPE_STEPS,
    SEED_RECIPES,
    type SeedRecipe,
    type SeedRecipeIngredientLine,
    type SeedRecipeStep,
} from '../../../services/recipe-service/src/database/seed.js';
import { parse, repoRoot } from './serviceSources.js';

const FIXTURE_FILE = 'packages/tools/e2e-seed/src/fixtureManifest.ts';
const SEED_FILE = 'packages/services/recipe-service/src/database/seed.ts';

/**
 * Which `seed.ts` owner each fixture identity stands for. Nothing in code binds them: `recipes/listDetail.yaml`'s
 * header states the signer is the FREE owner, and the co-author owns the risotto, which `seed.ts` gives to PRO.
 */
const SEED_OWNER_OF: Readonly<Record<FixtureOwner, string>> = { signer: SEED_OWNER_FREE, coAuthor: SEED_OWNER_PRO };

/** The `seed.ts` half of the comparison. */
interface SeedWorld {
    readonly recipes: readonly SeedRecipe[];
    readonly lines: readonly SeedRecipeIngredientLine[];
    readonly steps: readonly SeedRecipeStep[];
}

/** A recipe as both worlds can state it: the fixture definition, less its key, with the owner as a name. */
type RecipeProjection = Omit<FixtureRecipeDefinition, 'key' | 'owner'> & { readonly owner: string };

const TREE_SEED: SeedWorld = { recipes: SEED_RECIPES, lines: SEED_RECIPE_INGREDIENT_LINES, steps: SEED_RECIPE_STEPS };

/** The fixture identity a `seed.ts` owner id stands for, or the id itself when it stands for none. Pure. */
function ownerName(ownerId: string): string {
    return Object.entries(SEED_OWNER_OF).find(([, id]) => id === ownerId)?.[0] ?? ownerId;
}

/** A fixture recipe, projected. Pure. */
function fixtureProjection(definition: FixtureRecipeDefinition): RecipeProjection {
    const { key: _key, ...projection } = definition;

    return projection;
}

/**
 * A `seed.ts` recipe, projected: its lines in array order (`sort_order` is a line's position), its steps in
 * `stepNumber` order, and an empty unit read as an absent one. Pure.
 */
function seedProjection(recipe: SeedRecipe, seed: SeedWorld): RecipeProjection {
    return {
        baseTitle: recipe.title,
        owner: ownerName(recipe.ownerId),
        description: recipe.description,
        visibility: recipe.visibility,
        servings: recipe.servings,
        prepTimeMinutes: recipe.prepTimeMinutes,
        cookTimeMinutes: recipe.cookTimeMinutes,
        totalTimeMinutes: recipe.totalTimeMinutes,
        ingredients: seed.lines
            .filter((line) => line.recipeId === recipe.id)
            .map((line) => ({
                name: line.ingredient.name,
                quantity: line.quantity,
                unit: line.unit === '' ? undefined : line.unit,
            })),
        steps: seed.steps
            .filter((step) => step.recipeId === recipe.id)
            .toSorted((a, b) => a.stepNumber - b.stepNumber)
            .map((step) => ({ instruction: step.instruction, timerSeconds: step.timerSeconds })),
    };
}

/**
 * Every scalar in a value, keyed by its path (`ingredients[1].unit`). An absent key and an `undefined` one read alike.
 * Pure.
 */
function leaves(value: unknown, at = '', into = new Map<string, unknown>()): ReadonlyMap<string, unknown> {
    if (Array.isArray(value)) {
        const items: readonly unknown[] = value;

        items.forEach((item, index) => leaves(item, `${at}[${index}]`, into));
    } else if (typeof value === 'object' && value !== null) {
        for (const [key, item] of Object.entries(value)) {
            leaves(item, at === '' ? key : `${at}.${key}`, into);
        }
    } else {
        into.set(at, value);
    }

    return into;
}

const shown = (value: unknown): string => (value === undefined ? 'absent' : JSON.stringify(value));

/**
 * Every disagreement between the fixture world and `seed.ts`, one message per scalar, each naming both files.
 *
 * @param fixture - The recipes the deployed run seeds.
 * @param seed - recipe-service's local seed.
 * @returns The disagreements; empty when the worlds agree. Pure.
 */
function worldDivergences(fixture: readonly FixtureRecipeDefinition[], seed: SeedWorld): readonly string[] {
    const fixtureTitles = new Set(fixture.map((definition) => definition.baseTitle));

    const fieldDivergences = fixture.flatMap((definition) => {
        const counterpart = seed.recipes.find((recipe) => recipe.title === definition.baseTitle);

        if (counterpart === undefined) {
            return [`${definition.baseTitle}: present in ${FIXTURE_FILE}'s SEED_WORLD, absent from ${SEED_FILE}`];
        }

        const ours = leaves(fixtureProjection(definition));
        const theirs = leaves(seedProjection(counterpart, seed));

        return [...new Set([...ours.keys(), ...theirs.keys()])]
            .filter((at) => ours.get(at) !== theirs.get(at))
            .map(
                (at) =>
                    `${definition.baseTitle}: ${at} is ${shown(ours.get(at))} in ${FIXTURE_FILE} ` +
                    `but ${shown(theirs.get(at))} in ${SEED_FILE}`,
            );
    });

    const signerOnlyInSeed = seed.recipes
        .filter((recipe) => !fixtureTitles.has(recipe.title) && recipe.ownerId === SEED_OWNER_OF.signer)
        .map(
            (recipe) =>
                `${recipe.title}: in the signer's library in ${SEED_FILE}, absent from ${FIXTURE_FILE}'s ` +
                `SEED_WORLD, so the two give the signer different recipe counts`,
        );

    return [...fieldDivergences, ...signerOnlyInSeed];
}

/** The names a module declares as top-level `export const`. Pure. */
function exportedConsts(file: string, contents: string): ReadonlySet<string> {
    return new Set(
        parse({ file, contents })
            .statements.filter(ts.isVariableStatement)
            .filter((statement) =>
                (ts.getModifiers(statement) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword),
            )
            .flatMap((statement) => statement.declarationList.declarations)
            .flatMap((declaration) => (ts.isIdentifier(declaration.name) ? [declaration.name.text] : [])),
    );
}

describe('the Maestro fixture world and seed.ts agree on what the flows read', () => {
    it('names the files that declare what it reads, so a message points at the right place', () => {
        const declared = (file: string): ReadonlySet<string> =>
            exportedConsts(file, readFileSync(path.join(repoRoot, file), 'utf8'));

        expect([...declared(FIXTURE_FILE)]).toContain('SEED_WORLD');
        expect([...declared(SEED_FILE)]).toEqual(
            expect.arrayContaining([
                'SEED_OWNER_FREE',
                'SEED_OWNER_PRO',
                'SEED_RECIPES',
                'SEED_RECIPE_INGREDIENT_LINES',
                'SEED_RECIPE_STEPS',
            ]),
        );
    });

    it('has a fixture world to compare, so the agreement below is not vacuous', () => {
        expect(SEED_WORLD.length).toBeGreaterThan(0);
    });

    it('finds no divergence', () => {
        expect(worldDivergences(SEED_WORLD, TREE_SEED)).toEqual([]);
    });
});

describe('worldDivergences detects the divergences it exists to detect', () => {
    const lamb = {
        key: 'lamb',
        owner: 'signer',
        baseTitle: 'Lamb',
        description: 'Grilled lamb.',
        visibility: 'private',
        servings: 4,
        prepTimeMinutes: 15,
        cookTimeMinutes: 30,
        totalTimeMinutes: 45,
        ingredients: [
            { name: 'Chops', quantity: 8, unit: undefined },
            { name: 'Oil', quantity: 3, unit: 'tbsp' },
        ],
        steps: [
            { instruction: 'Marinate.', timerSeconds: undefined },
            { instruction: 'Grill.', timerSeconds: 480 },
        ],
    } as const satisfies FixtureRecipeDefinition;

    const seedLamb: SeedRecipe = {
        id: 'lamb-id',
        ownerId: SEED_OWNER_FREE,
        title: 'Lamb',
        description: 'Grilled lamb.',
        prepTimeMinutes: 15,
        cookTimeMinutes: 30,
        totalTimeMinutes: 45,
        servings: 4,
        visibility: 'private',
    };
    const seedDuck: SeedRecipe = { ...seedLamb, id: 'duck-id', ownerId: SEED_OWNER_PRO, title: 'Duck' };
    const line = (id: string, recipeId: string, name: string, quantity: number, unit: string) =>
        ({
            id,
            recipeId,
            ingredient: { id: `${id}-binding`, name },
            quantity,
            unit,
        }) satisfies SeedRecipeIngredientLine;
    const seedWorld: SeedWorld = {
        recipes: [seedLamb, seedDuck],
        lines: [
            line('l1', 'lamb-id', 'Chops', 8, ''),
            line('d1', 'duck-id', 'Duck breast', 2, ''),
            line('l2', 'lamb-id', 'Oil', 3, 'tbsp'),
        ],
        steps: [
            { recipeId: 'lamb-id', stepNumber: 2, instruction: 'Grill.', timerSeconds: 480 },
            { recipeId: 'duck-id', stepNumber: 1, instruction: 'Sear.' },
            { recipeId: 'lamb-id', stepNumber: 1, instruction: 'Marinate.' },
        ],
    };

    const withLamb = (change: Partial<FixtureRecipeDefinition>): readonly FixtureRecipeDefinition[] => [
        { ...lamb, ...change },
    ];
    const withSeedLamb = (change: Partial<SeedRecipe>): SeedWorld => ({
        ...seedWorld,
        recipes: seedWorld.recipes.map((recipe) => (recipe.id === 'lamb-id' ? { ...recipe, ...change } : recipe)),
    });
    const withSeedLines = (lines: readonly SeedRecipeIngredientLine[]): SeedWorld => ({ ...seedWorld, lines });
    const withSeedSteps = (steps: readonly SeedRecipeStep[]): SeedWorld => ({ ...seedWorld, steps });

    // An empty seed unit against an omitted one, a missing timer against an undefined one, steps stored out of order,
    // the duck's line between the lamb's, and a seed-only recipe the co-author owns.
    it('agrees when the two differ only in how they spell the same world', () => {
        expect(worldDivergences([lamb], seedWorld)).toEqual([]);
    });

    it.each<readonly [string, readonly FixtureRecipeDefinition[], SeedWorld, string]>([
        ['servings changed in the fixture world', withLamb({ servings: 2 }), seedWorld, 'servings'],
        ['prep time changed in seed.ts', [lamb], withSeedLamb({ prepTimeMinutes: 10 }), 'prepTimeMinutes'],
        ['cook time changed in the fixture world', withLamb({ cookTimeMinutes: 25 }), seedWorld, 'cookTimeMinutes'],
        ['total time changed in seed.ts', [lamb], withSeedLamb({ totalTimeMinutes: 40 }), 'totalTimeMinutes'],
        ['description changed in seed.ts', [lamb], withSeedLamb({ description: 'Lamb.' }), 'description'],
        ['visibility changed in the fixture world', withLamb({ visibility: 'public' }), seedWorld, 'visibility'],
        ['owner changed in seed.ts', [lamb], withSeedLamb({ ownerId: SEED_OWNER_PRO }), 'owner'],
        ['owner in seed.ts that is neither identity', [lamb], withSeedLamb({ ownerId: 'nobody' }), 'owner'],
        [
            'a quantity changed in seed.ts',
            [lamb],
            withSeedLines([line('l1', 'lamb-id', 'Chops', 6, ''), line('l2', 'lamb-id', 'Oil', 3, 'tbsp')]),
            'ingredients[0].quantity',
        ],
        [
            'a named unit in seed.ts where the fixture omits it',
            [lamb],
            withSeedLines([line('l1', 'lamb-id', 'Chops', 8, 'g'), line('l2', 'lamb-id', 'Oil', 3, 'tbsp')]),
            'ingredients[0].unit',
        ],
        [
            'an ingredient renamed in the fixture world',
            withLamb({ ingredients: [lamb.ingredients[0], { name: 'Olive oil', quantity: 3, unit: 'tbsp' }] }),
            seedWorld,
            'ingredients[1].name',
        ],
        [
            'an extra ingredient line in seed.ts',
            [lamb],
            withSeedLines([...seedWorld.lines, line('l3', 'lamb-id', 'Salt', 1, 'tsp')]),
            'ingredients[2].name',
        ],
        [
            'a step instruction changed in the fixture world',
            withLamb({ steps: [lamb.steps[0], { instruction: 'Roast.', timerSeconds: 480 }] }),
            seedWorld,
            'steps[1].instruction',
        ],
        [
            'a step timer changed in seed.ts',
            [lamb],
            withSeedSteps(
                seedWorld.steps.map((step) =>
                    step.recipeId === 'lamb-id' && step.stepNumber === 2 ? { ...step, timerSeconds: 300 } : step,
                ),
            ),
            'steps[1].timerSeconds',
        ],
        [
            'a step missing from seed.ts',
            [lamb],
            withSeedSteps(seedWorld.steps.filter((step) => !(step.recipeId === 'lamb-id' && step.stepNumber === 2))),
            'steps[1].instruction',
        ],
    ])('reports %s, naming the recipe, the field and both files', (_case, fixture, seed, field) => {
        const divergences = worldDivergences(fixture, seed);

        expect(divergences.length).toBeGreaterThan(0);
        expect(divergences.every((message) => message.includes(FIXTURE_FILE) && message.includes(SEED_FILE))).toBe(
            true,
        );
        expect(divergences.some((message) => message.startsWith(`Lamb: ${field} `))).toBe(true);
    });

    it('reads lines in their stored order, so the same lines reordered are a divergence and not a set match', () => {
        const reordered = withSeedLines([
            line('l2', 'lamb-id', 'Oil', 3, 'tbsp'),
            line('l1', 'lamb-id', 'Chops', 8, ''),
        ]);

        expect(worldDivergences([lamb], reordered)).not.toEqual([]);
    });

    it('reports a fixture recipe seed.ts does not have', () => {
        expect(worldDivergences([lamb, { ...lamb, key: 'salad', baseTitle: 'Salad' }], seedWorld)).toEqual([
            `Salad: present in ${FIXTURE_FILE}'s SEED_WORLD, absent from ${SEED_FILE}`,
        ]);
    });

    it("reports a seed-only recipe in the signer's library, because the flows count that library", () => {
        const divergences = worldDivergences([lamb], {
            ...seedWorld,
            recipes: [seedLamb, { ...seedDuck, ownerId: SEED_OWNER_FREE }],
        });

        expect(divergences).toEqual([expect.stringMatching(/^Duck: /)]);
        expect(divergences[0]).toContain(FIXTURE_FILE);
        expect(divergences[0]).toContain(SEED_FILE);
    });

    describe('on the real worlds, one value changed', () => {
        const asparagus = SEED_WORLD.find((definition) => definition.key === 'asparagus');

        it('has the recipe the cases below change', () => {
            expect(asparagus).toBeDefined();
        });

        it('in the fixture world', () => {
            const servings = asparagus?.servings ?? 0;
            const changed = SEED_WORLD.map((definition) =>
                definition === asparagus ? { ...definition, servings: servings + 1 } : definition,
            );

            expect(worldDivergences(changed, TREE_SEED)).toEqual([
                `${asparagus?.baseTitle}: servings is ${servings + 1} in ${FIXTURE_FILE} ` +
                    `but ${servings} in ${SEED_FILE}`,
            ]);
        });

        it('in seed.ts', () => {
            const cook = asparagus?.cookTimeMinutes ?? 0;
            const changed: SeedWorld = {
                ...TREE_SEED,
                recipes: SEED_RECIPES.map((recipe) =>
                    recipe.title === asparagus?.baseTitle ? { ...recipe, cookTimeMinutes: cook + 5 } : recipe,
                ),
            };

            expect(worldDivergences(SEED_WORLD, changed)).toEqual([
                `${asparagus?.baseTitle}: cookTimeMinutes is ${cook} in ${FIXTURE_FILE} ` +
                    `but ${cook + 5} in ${SEED_FILE}`,
            ]);
        });
    });
});
