/**
 * Bulk-seed a deployed stage with a realistic recipe library.
 *
 * ⛔ THE TARGET IS THE ENVIRONMENT, AND IT IS NEVER GUESSED. It comes from `E2E_SEED_RECIPE_URL`, the same
 * variable every other seed command reads, so this cannot quietly point at production because a default was
 * convenient. It additionally REFUSES a production origin outright — a few hundred fabricated recipes in a
 * real user's library is not something an `--undo` flag makes better.
 *
 * ⚠️ It is idempotent by TITLE: a re-run tops the library up to the requested count rather than duplicating
 * it, so an interrupted run is resumed by running it again.
 *
 * Usage: `E2E_SEED_RECIPE_COUNT=300 npm run bulk-seed --workspace=@kitchensink/e2e-seed`
 */
import { clerkLeasePort, leaseSession } from '@kitchensink/e2e-fixtures/lease';
import { slotFor } from '@kitchensink/e2e-fixtures/testPool';

import { clientFor } from './client.js';
import { readSeedEnvironment } from './env.js';

/** Cuisines, mains and methods, combined to give every recipe a distinct, plausible title. */
const CUISINES = ['Thai', 'Sicilian', 'Oaxacan', 'Gujarati', 'Basque', 'Sichuan', 'Lebanese', 'Peruvian'] as const;
const MAINS = ['Chickpea', 'Aubergine', 'Lentil', 'Mushroom', 'Cauliflower', 'Butternut', 'Tofu', 'Barley'] as const;
const METHODS = ['Stew', 'Traybake', 'Curry', 'Skillet', 'Braise', 'Salad', 'Soup', 'Hash'] as const;
const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;

/** How many recipes to create unless `E2E_SEED_RECIPE_COUNT` says otherwise. */
const DEFAULT_COUNT = 300;

/** One write every two seconds — the service allows 30 per minute per user. */
const WRITE_SPACING_MS = 2_100;

/** Deterministic pick, so a given index always yields the same recipe and a resumed run matches. */
function pick<T>(list: readonly T[], index: number): T {
    return list[index % list.length] as T;
}

/** Build one recipe's create request. Pure. */
function recipeAt(index: number, ingredientId: string): Record<string, unknown> {
    const title = `${pick(CUISINES, index)} ${pick(MAINS, Math.floor(index / 3))} ${pick(METHODS, Math.floor(index / 7))} #${index + 1}`;
    const prep = 5 + (index % 6) * 5;
    const cook = 10 + (index % 9) * 5;

    return {
        title,
        description: `A ${pick(DIFFICULTIES, index)} weeknight ${pick(METHODS, Math.floor(index / 7)).toLowerCase()} seeded for library-scale review.`,
        // Public by default (FR-003), which is also what makes these visible on Discover.
        visibility: 'public',
        difficulty: pick(DIFFICULTIES, index),
        servings: 2 + (index % 5),
        prepTimeMinutes: prep,
        cookTimeMinutes: cook,
        totalTimeMinutes: prep + cook,
        ingredients: [
            {
                ingredientId,
                name: 'olive oil',
                quantity: { kind: 'exact', value: 1 + (index % 3) },
                unit: 'tbsp',
            },
        ],
        steps: [
            { instruction: 'Warm the pan and add the oil.' },
            { instruction: `Cook for ${cook} minutes, stirring occasionally.` },
            { instruction: 'Season, rest briefly, and serve.' },
        ],
        tags: [pick(CUISINES, index).toLowerCase(), pick(METHODS, Math.floor(index / 7)).toLowerCase()],
    };
}

const env = readSeedEnvironment(process.env);

// ⛔ REFUSE PRODUCTION. The guard is on the ORIGIN rather than on a stage name, because the origin is the
// thing that actually decides whose data this touches.
if (/(^|\.)commise\.app$/u.test(new URL(env.recipeOrigin).hostname) && !env.recipeOrigin.includes('-pr-')) {
    throw new Error(`bulk-seed: refusing to seed a non-preview origin (${env.recipeOrigin})`);
}

const count = Number(process.env['E2E_SEED_RECIPE_COUNT'] ?? DEFAULT_COUNT);
const port = clerkLeasePort(env.clerkSecretKey);

const session = (
    await leaseSession({
        slot: slotFor('maestro', 'signer'),
        publishableKey: env.clerkPublishableKey,
        origin: env.webOrigin,
        port,
    })
).handle;

const client = clientFor(env.recipeOrigin, session);

// One shared ingredient keeps the seeding fast and the catalog clean; the point of this data is library
// SCALE, not ingredient variety.
const ingredient = await client.createIngredient('olive oil');

const existing = await client.listRecipes({ pageSize: 100 });
const already = new Set(existing.data.map((recipe) => recipe.title));
let created = 0;

for (let index = 0; index < count; index += 1) {
    const request = recipeAt(index, ingredient.id);

    if (already.has(request['title'] as string)) {
        continue;
    }

    await client.createRecipe(request as Parameters<typeof client.createRecipe>[0]);
    created += 1;

    // ⛔ PACED TO THE SERVICE'S OWN WRITE LIMIT (30/min per user). Unpaced, a few dozen creates trip it and
    // the rest of the run fails against a limit the product is SUPPOSED to enforce — the seeder would be
    // reporting a defect in itself as a defect in the service.
    await new Promise((resolve) => setTimeout(resolve, WRITE_SPACING_MS));

    if (created % 25 === 0) {
        console.error(`bulk-seed: ${created} created…`);
    }
}

console.error(`bulk-seed: done — ${created} created, target ${count}, origin ${env.recipeOrigin}`);
