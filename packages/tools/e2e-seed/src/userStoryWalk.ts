/**
 * A manual walk of the recipe user stories against a DEPLOYED stage, through the product's own API.
 *
 * ⛔ THIS IS NOT THE AUTOMATED SUITE. It exists because "the tests pass" and "the product works" are
 * different claims: the suites mock or boot their own backend, while this drives the real deployed service
 * with a real Clerk session, the way a person would. It reports PASS/FAIL per acceptance scenario.
 */
import { clerkLeasePort, leaseSession } from '@kitchensink/e2e-fixtures/lease';
import { slotFor } from '@kitchensink/e2e-fixtures/testPool';

import { clientFor } from './client.js';
import { readSeedEnvironment } from './env.js';

const env = readSeedEnvironment(process.env);
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

let failures = 0;

/** Report one scenario. */
function check(label: string, pass: boolean, detail = ''): void {
    if (!pass) {
        failures += 1;
    }

    console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail === '' ? '' : ` — ${detail}`}`);
}

const list = await client.listRecipes({ pageSize: 100 });
check('US1    library is populated and lists', list.data.length > 0, `${list.data.length} on page 1`);

const first = list.data[0];
check('US1.9  list rows carry their own summary (no per-recipe detail fetch)', first !== undefined && 'title' in first);
check(
    'US2    visibility is expressed on the row',
    first !== undefined && 'visibility' in first,
    String(first?.visibility),
);

const withDifficulty = list.data.filter((recipe) => recipe.difficulty !== undefined);
check(
    'US1.7  difficulty persists when set',
    withDifficulty.length > 0,
    `${withDifficulty.length} of ${list.data.length}`,
);

// ⚠️ `results`, not `data` — search returns a RANKED page with facets, a different shape from a plain list,
// deliberately so per-result metadata stays an additive change.
const search = await client.searchRecipes({ query: 'Thai', pageSize: 20 });
check(
    'US1.5  keyword search returns matches',
    search.results.length > 0,
    `${search.results.length} of ${search.total} for "Thai"`,
);
check('US1.5  search returns facets for filtering', search.facets !== undefined);

if (first !== undefined) {
    const detail = await client.getRecipeById(first.id);
    check(
        'US1    detail loads with ingredients and steps',
        detail.ingredients.length > 0 && detail.steps.length > 0,
        `${detail.ingredients.length} ingredients, ${detail.steps.length} steps`,
    );

    const edited = await client.updateRecipe(detail.id, {
        title: `${detail.title} (checked)`,
        expectedVersion: detail.currentVersion,
    });
    check('US1.2  an edit saves and is reflected', edited.title.endsWith('(checked)'));

    const restored = await client.updateRecipe(edited.id, {
        title: detail.title,
        expectedVersion: edited.currentVersion,
    });
    check('US1.2  the edit round-trips back', restored.title === detail.title);
}

// ── US2: sharing, cloning, rating, and the not-owner denials ──────────────────
const coAuthor = (
    await leaseSession({
        slot: slotFor('maestro', 'coauthor'),
        publishableKey: env.clerkPublishableKey,
        origin: env.webOrigin,
        port,
    })
).handle;
const other = clientFor(env.recipeOrigin, coAuthor);

const publicOne = list.data.find((recipe) => recipe.visibility === 'public');

// ⛔ THE PRECONDITION IS A CHECK, NOT A GUARD. Seven US2 scenarios sat under a bare
// `if (publicOne !== undefined)`, so a stage with no public recipe ran ZERO of them and the walk still
// printed ALL CHECKED SCENARIOS PASS and exited 0 — a green over a suite that never ran. That is the owner's
// 2026-09-05 ruling verbatim: a skip claims nothing, and reporting one as a pass claims something false.
// Asserting it first means the absence FAILS, loudly, naming what was missing.
check('US2 precondition: a public recipe exists to clone and rate', publicOne !== undefined);

if (publicOne !== undefined) {
    // US2.2 — a public recipe clones into the cloner's own collection.
    const clone = await other.cloneRecipe(publicOne.id);
    check('US2.2  a public recipe clones to the cloner', clone.id !== publicOne.id, `clone ${clone.id}`);

    // US2.3 — editing the clone leaves the original untouched.
    await other.updateRecipe(clone.id, { title: 'Cloned and edited', expectedVersion: clone.currentVersion });
    const original = await client.getRecipeById(publicOne.id);
    check('US2.3  editing a clone leaves the original unchanged', original.title === publicOne.title);

    // US2.6/2.7 — a rating from a non-owner is saved, and re-rating REPLACES rather than adds.
    await other.setRecipeRating(publicOne.id, { stars: 4 });
    const rated = await other.getRecipeById(publicOne.id);
    check('US2.6  a non-owner rating is recorded', (rated.ratingCount ?? 0) >= 1, `count ${rated.ratingCount}`);

    await other.setRecipeRating(publicOne.id, { stars: 2 });
    const rerated = await other.getRecipeById(publicOne.id);
    check(
        'US2.7  re-rating REPLACES rather than adds',
        rerated.ratingCount === rated.ratingCount,
        `count stayed ${rerated.ratingCount}, average ${rerated.averageRating}`,
    );

    // US2.8 — the owner cannot rate their own recipe.
    let ownRatingRefused = false;

    try {
        await client.setRecipeRating(publicOne.id, { stars: 5 });
    } catch {
        ownRatingRefused = true;
    }

    check('US2.8  the owner is refused rating their own recipe', ownRatingRefused);

    // US1.4 — a non-owner cannot edit or delete.
    let editRefused = false;

    try {
        await other.updateRecipe(publicOne.id, { title: 'hijacked', expectedVersion: original.currentVersion });
    } catch {
        editRefused = true;
    }

    check('US1.4  a non-owner is refused editing', editRefused);

    await other.deleteRecipe(clone.id);
}

console.log(`\n${failures === 0 ? 'ALL CHECKED SCENARIOS PASS' : `${failures} FAILED`} — origin ${env.recipeOrigin}`);
process.exit(failures === 0 ? 0 : 1);
