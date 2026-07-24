/**
 * @module @commise/features-recipes/versions/diff — pure client-side snapshot comparison (W6 Task 1).
 *
 * {@link diffSnapshots} is the foundation every other W6 version-history surface consumes: row-level
 * "changed fields" badges, the version preview modal, and the two-version compare screen's Diff Summary
 * all derive from this ONE computation, so they can never disagree on what changed between two versions.
 *
 * ## Scope — the 8 `RecipeSnapshot` fields, 7 of them diffable
 *
 * `RecipeSnapshot` (`@kitchensink/recipe-core`) carries 8 fields: `version`, `title`, `description`,
 * `steps`, `ingredients`, `servings`, `prepTimeMinutes`, `cookTimeMinutes`. `version` is the snapshot's own
 * sequence number, not authored content, so it is DELIBERATELY excluded — {@link SnapshotFieldKey} covers
 * the remaining 7. `tags`, `cuisine`, `dietaryFlags`, `visibility`, and `photos` are recipe-level fields
 * that are NOT captured in a `RecipeSnapshot` at all (see `aggregateToSnapshot` in the recipe service) —
 * they are therefore not versioned and this function cannot and does not diff them. A snapshot-shaped
 * object carrying any such extra property is read structurally: only the 7 known keys are ever consulted,
 * so a stray field is silently ignored rather than counted.
 *
 * ## Ingredient identity — `ingredientId`, NOT the line's own `id`
 *
 * A recipe update REPLACES its entire `recipe_steps` / `recipe_ingredients` row sets (delete-all then
 * re-insert — see `RecipeIngredientsDal.replace` and `RecipesDal.update` in `recipe-service`), so
 * `RecipeIngredient.id` (and `RecipeStep.id`) are regenerated on every save and carry NO meaning across
 * two snapshots. The stable cross-version identity for an ingredient LINE is therefore its
 * `ingredientId` — the reference to the canonical catalog ingredient the line is FOR, which survives the
 * row swap. Two lines are "the same ingredient" iff they share `ingredientId`; `id`/`recipeId` are
 * excluded from both identity and the modified-content comparison for the same reason.
 *
 * ## Steps — position-wise, not identity-wise
 *
 * Steps have no independent identity to track (a step is "the Nth instruction"), so they are compared BY
 * ARRAY INDEX: an index present only in `target` is added, an index present only in `base` is removed, and
 * an index present in both with a changed `instruction` or `timerSeconds` is modified — never counted as a
 * remove+add pair. `id`/`recipeId`/`stepNumber` are excluded from the modified-content comparison (they
 * are regenerated/positionally-implied, not authored content).
 *
 * ## Summary rollup
 *
 * `summary` is the wireframe's "Diff Summary" Added/Removed/Modified total:
 * - `added` = `steps.added + ingredients.added`
 * - `removed` = `steps.removed + ingredients.removed`
 * - `modified` = `steps.modified + ingredients.modified` + the COUNT of changed scalar fields (each
 *   changed scalar — `title`/`description`/`servings`/`prepTimeMinutes`/`cookTimeMinutes` — counts once
 *   as one modification, regardless of how different the values are).
 *
 * Pure: no I/O, and neither `base` nor `target` (nor their nested arrays) is ever mutated.
 */
import type { RecipeIngredient, RecipeSnapshot, RecipeStep } from '@kitchensink/recipe-core';

/** The `RecipeSnapshot` fields this module diffs — every field except `version` (see module docs). */
export type SnapshotFieldKey =
    | 'title'
    | 'description'
    | 'servings'
    | 'prepTimeMinutes'
    | 'cookTimeMinutes'
    | 'steps'
    | 'ingredients';

/** Added/removed/modified tallies for one collection (steps, ingredients, or the overall summary). */
interface DiffTally {
    readonly added: number;
    readonly removed: number;
    readonly modified: number;
}

/** The result of comparing two recipe version snapshots. */
export interface SnapshotDiff {
    /** Which of the 7 diffable fields differ, in {@link SnapshotFieldKey}'s declared (stable) order. */
    readonly changedFields: readonly SnapshotFieldKey[];
    /** Position-wise step tally (see module docs). */
    readonly steps: DiffTally;
    /** `ingredientId`-keyed ingredient tally (see module docs). */
    readonly ingredients: DiffTally;
    /** The rolled-up Diff Summary tally (see module docs). */
    readonly summary: DiffTally;
}

/** {@link SnapshotFieldKey}s in declared order — the source of {@link SnapshotDiff.changedFields}' order. */
const SNAPSHOT_FIELD_KEYS: readonly SnapshotFieldKey[] = [
    'title',
    'description',
    'servings',
    'prepTimeMinutes',
    'cookTimeMinutes',
    'steps',
    'ingredients',
];

/** The scalar (non-collection) fields, compared by strict inequality. */
const SCALAR_FIELD_KEYS: readonly Exclude<SnapshotFieldKey, 'steps' | 'ingredients'>[] = [
    'title',
    'description',
    'servings',
    'prepTimeMinutes',
    'cookTimeMinutes',
];

/** Whether a tally has any non-zero count. Pure. */
const hasChanges = (tally: DiffTally): boolean => tally.added > 0 || tally.removed > 0 || tally.modified > 0;

/**
 * Whether two steps AT THE SAME POSITION carry different authored content. Compares `instruction` and
 * `timerSeconds` only — `id`/`recipeId`/`stepNumber` are structural/regenerated, not authored content. Pure.
 */
const stepContentChanged = (base: RecipeStep, target: RecipeStep): boolean =>
    base.instruction !== target.instruction || base.timerSeconds !== target.timerSeconds;

/**
 * Position-wise step diff: index present only in `target` = added, only in `base` = removed, present in
 * both with different content ({@link stepContentChanged}) = modified. Pure.
 */
const diffSteps = (base: readonly RecipeStep[], target: readonly RecipeStep[]): DiffTally => {
    const length = Math.max(base.length, target.length);
    let added = 0;
    let removed = 0;
    let modified = 0;

    for (let index = 0; index < length; index += 1) {
        const baseStep = base[index];
        const targetStep = target[index];

        if (baseStep === undefined) {
            added += 1;
        } else if (targetStep === undefined) {
            removed += 1;
        } else if (stepContentChanged(baseStep, targetStep)) {
            modified += 1;
        }
    }

    return { added, removed, modified };
};

/** The stable cross-version ingredient identity — the canonical catalog ingredient reference (see module docs). */
const ingredientIdentity = (ingredient: RecipeIngredient): string => ingredient.ingredientId;

/**
 * Whether two ingredient lines WITH THE SAME IDENTITY carry different content. Compares every field except
 * `id`/`recipeId` (regenerated per save) and `ingredientId` (the identity itself, trivially equal here).
 * Pure.
 */
const ingredientContentChanged = (base: RecipeIngredient, target: RecipeIngredient): boolean =>
    base.quantity !== target.quantity ||
    base.unit !== target.unit ||
    base.displayText !== target.displayText ||
    base.sortOrder !== target.sortOrder ||
    base.ingredientName !== target.ingredientName ||
    base.isUserEntered !== target.isUserEntered ||
    base.userCalories !== target.userCalories ||
    base.userProteinG !== target.userProteinG ||
    base.userCarbsG !== target.userCarbsG ||
    base.userFatG !== target.userFatG;

/**
 * Identity-wise ingredient diff, keyed by {@link ingredientIdentity}: an identity present only in `target`
 * is added, only in `base` is removed, present in both with different content
 * ({@link ingredientContentChanged}) is modified. Pure.
 */
const diffIngredients = (base: readonly RecipeIngredient[], target: readonly RecipeIngredient[]): DiffTally => {
    const baseByIdentity = new Map(base.map((ingredient) => [ingredientIdentity(ingredient), ingredient] as const));
    const targetByIdentity = new Map(target.map((ingredient) => [ingredientIdentity(ingredient), ingredient] as const));

    let added = 0;
    let removed = 0;
    let modified = 0;

    for (const [identity, targetIngredient] of targetByIdentity) {
        const baseIngredient = baseByIdentity.get(identity);

        if (baseIngredient === undefined) {
            added += 1;
        } else if (ingredientContentChanged(baseIngredient, targetIngredient)) {
            modified += 1;
        }
    }

    for (const identity of baseByIdentity.keys()) {
        if (!targetByIdentity.has(identity)) {
            removed += 1;
        }
    }

    return { added, removed, modified };
};

/**
 * Compare two recipe version snapshots and report what changed (see module docs for full semantics).
 * `base` is the older/reference snapshot, `target` is the newer one being compared against it: `added`
 * means present in `target` but not `base`, `removed` means the reverse, `modified` means present in both
 * with different content. Pure — never mutates `base`, `target`, or their nested `steps`/`ingredients`.
 *
 * @param base - The older/reference snapshot.
 * @param target - The newer snapshot being compared against `base`.
 * @returns The changed fields, per-collection tallies, and rolled-up Diff Summary.
 */
export const diffSnapshots = (base: RecipeSnapshot, target: RecipeSnapshot): SnapshotDiff => {
    const changedScalarFields = SCALAR_FIELD_KEYS.filter((key) => base[key] !== target[key]);
    const steps = diffSteps(base.steps, target.steps);
    const ingredients = diffIngredients(base.ingredients, target.ingredients);

    const changedScalarFieldSet = new Set<SnapshotFieldKey>(changedScalarFields);
    const changedFields = SNAPSHOT_FIELD_KEYS.filter((key) => {
        if (key === 'steps') {
            return hasChanges(steps);
        }

        if (key === 'ingredients') {
            return hasChanges(ingredients);
        }

        return changedScalarFieldSet.has(key);
    });

    return {
        changedFields,
        steps,
        ingredients,
        summary: {
            added: steps.added + ingredients.added,
            removed: steps.removed + ingredients.removed,
            modified: steps.modified + ingredients.modified + changedScalarFields.length,
        },
    };
};
