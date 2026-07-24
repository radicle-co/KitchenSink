/**
 * @module @commise/features-recipes/versions/conflictDiff — pure 3-way (base/mine/theirs) conflict diff
 * (W7 Task 1).
 *
 * {@link computeConflictDiff} is the foundation the W7 conflict-resolution UI consumes: it classifies every
 * one of the 7 diffable `RecipeSnapshot` fields (the same scope `diff.ts`'s two-way {@link diffSnapshots}
 * covers — `version` is excluded there and here for the same reason: it is the snapshot's own sequence
 * number, not authored content) as `unchanged` / `changed` / `conflict` by comparing MINE and THEIRS
 * against the common BASE they both started editing from, and reports ONLY the changed-or-conflicting rows
 * (changed-only) plus a phantom-zero `isEmpty` flag for the "nothing to merge" fast path (W7 Task 2).
 *
 * ## Classification
 *
 * For a field/element with base value `b`, mine value `m`, theirs value `t`:
 * - `mineChanged = m !== b` (deep-equal for structured elements — steps/ingredients), `theirsChanged = t !== b`.
 * - `conflict` — BOTH sides changed it, AND to DIFFERENT values (`m !== t`).
 * - `changed` — exactly one side changed it, OR both sides changed it to the SAME value (nothing left to
 *   reconcile, but still worth surfacing that both touched it).
 * - `unchanged` — neither side changed it. Changed-only: `unchanged` rows never appear in `rows`.
 *
 * ## Base-evicted degradation (`base === undefined`)
 *
 * A recipe's version history is not retained forever, so the base version a concurrent edit started from
 * can be evicted by the time a conflict is detected. Without a base there is no way to attribute a
 * difference to "mine changed it" vs. "theirs changed it" vs. "neither did, they always differed" — so this
 * function DEGRADES to a 2-way mine-vs-theirs comparison: ANY field/element where `mine !== theirs`
 * (deep-equal for structured elements) is conservatively classified `conflict` — never `changed`, since
 * there is no reliable "only one side touched it" signal without a base — and the `base` value is OMITTED
 * from every row (there is nothing to show). A field/element where mine and theirs already agree needs no
 * reconciliation and is excluded, exactly like the 3-way `unchanged` case.
 *
 * ## Reuse
 *
 * Step content-equality (position-wise) and ingredient identity/content-equality (`ingredientId`-keyed)
 * reuse `diff.ts`'s exported {@link stepContentChanged}, {@link ingredientIdentity}, and
 * {@link ingredientContentChanged} — the SAME "what counts as changed content" rules the W6 two-way diff
 * uses, so the two-way and three-way diffs can never disagree about whether a given step or ingredient
 * changed. Ingredient line formatting reuses {@link formatQuantity} (the detail view's own formatter) for
 * the same reason — one authoritative "how a quantity+unit reads" regardless of which surface renders it.
 *
 * Pure: never mutates `base`, `mine`, `theirs`, or their nested `steps`/`ingredients`.
 */
import type { RecipeIngredient, RecipeSnapshot, RecipeStep } from '@kitchensink/recipe-core';

import { formatQuantity } from '../detail/model.js';
import { ingredientContentChanged, ingredientIdentity, stepContentChanged } from './diff.js';

/** Whether a field/element differs between two sides: `[=]` neither side changed it, `[→]` exactly one side
 *  changed it (or both changed it to the SAME value), `[!!]` both sides changed it to DIFFERENT values. */
export type ConflictMarker = 'unchanged' | 'changed' | 'conflict';

/** The kind of field a {@link ConflictFieldRow} reports — the 5 scalar `RecipeSnapshot` fields, plus the two
 *  per-element collection kinds (one row PER changed step/ingredient, never one row for the whole collection). */
export type ConflictFieldKind =
    | 'title'
    | 'description'
    | 'servings'
    | 'prepTimeMinutes'
    | 'cookTimeMinutes'
    | 'step'
    | 'ingredient';

/** One changed-or-conflicting field or element, three-way classified against a common base. */
export interface ConflictFieldRow {
    /** Stable key: the scalar field name (`'title'`) for scalars, or a per-element key (`'steps[2]'`,
     *  `'ingredients:<ingredientId>'`) for collection rows. */
    readonly key: string;
    readonly fieldKind: ConflictFieldKind;
    readonly marker: ConflictMarker;
    /** The formatted base value. ABSENT when `base` itself is evicted/undefined (see module docs), OR when
     *  the element does not exist in `base` at all (an element added by mine and/or theirs has no base
     *  value to show). */
    readonly base?: string;
    /** The formatted mine value. Empty string when the element does not exist on mine's side (removed). */
    readonly mine: string;
    /** The formatted theirs value. Empty string when the element does not exist on theirs' side (removed). */
    readonly theirs: string;
    /** `mine !== base` (deep-equal for structured elements). On a row produced by the base-evicted fallback
     *  (see module docs) this is ALWAYS `true` for an emitted row — there being no base, both sides are
     *  conservatively attributed rather than silently assuming only one changed. */
    readonly mineChanged: boolean;
    /** `theirs !== base` (deep-equal for structured elements). See {@link mineChanged}. */
    readonly theirsChanged: boolean;
}

/** The result of a 3-way conflict comparison. */
export interface ConflictDiff {
    /** Changed-or-conflicting rows only (`marker !== 'unchanged'` rows are excluded), in stable order: the
     *  5 scalar fields in their declared order, then steps by index, then ingredients in first-seen order
     *  (base's own order first, then any new identity introduced by mine, then any new identity introduced
     *  by theirs). */
    readonly rows: readonly ConflictFieldRow[];
    /** Whether ANY row is a genuine `conflict` (both sides changed it, and differently). */
    readonly hasConflict: boolean;
    /** Whether there is NOTHING to reconcile — `rows.length === 0` (the "phantom zero-diff" fast path). */
    readonly isEmpty: boolean;
}

/** The 5 scalar `RecipeSnapshot` fields this module diffs, in declared (and rendered) order. */
const SCALAR_FIELD_KINDS: readonly Exclude<ConflictFieldKind, 'step' | 'ingredient'>[] = [
    'title',
    'description',
    'servings',
    'prepTimeMinutes',
    'cookTimeMinutes',
];

/** Format a scalar snapshot field value for display: numbers as their decimal string, strings as-is. Pure. */
const formatScalar = (value: string | number): string => (typeof value === 'number' ? String(value) : value);

/** Format a step for display: its instruction, with a "(Ns timer)" suffix when it carries one — the same two
 *  fields `diff.ts`'s {@link stepContentChanged} treats as authored content. `undefined` (no step at this
 *  position on this side) formats as the empty string — an added/removed row's missing side. Pure. */
const formatStep = (step: RecipeStep | undefined): string => {
    if (step === undefined) {
        return '';
    }

    return step.timerSeconds !== undefined ? `${step.instruction} (${step.timerSeconds}s timer)` : step.instruction;
};

/** Format an ingredient line for display: "{quantity}{unit} {name}", with any `displayText` override appended
 *  in parens. `undefined` (no ingredient with this identity on this side) formats as the empty string. Pure. */
const formatIngredient = (ingredient: RecipeIngredient | undefined): string => {
    if (ingredient === undefined) {
        return '';
    }

    const name =
        ingredient.displayText !== undefined
            ? `${ingredient.ingredientName} (${ingredient.displayText})`
            : ingredient.ingredientName;

    return `${formatQuantity(ingredient.quantity, ingredient.unit)} ${name}`;
};

/**
 * `conflict` iff both sides changed it to DIFFERENT values; `changed` iff exactly one side changed it, or
 * both changed it to the SAME value; `unchanged` iff neither side changed it. Pure.
 */
const classifyMarker = (mineChanged: boolean, theirsChanged: boolean, mineEqualsTheirs: boolean): ConflictMarker => {
    if (!mineChanged && !theirsChanged) {
        return 'unchanged';
    }

    if (mineChanged && theirsChanged && !mineEqualsTheirs) {
        return 'conflict';
    }

    return 'changed';
};

/** One 3-way-classified scalar field row, or `undefined` when neither side changed it (`unchanged`, excluded). */
const scalarRow = (
    fieldKind: Exclude<ConflictFieldKind, 'step' | 'ingredient'>,
    base: RecipeSnapshot,
    mine: RecipeSnapshot,
    theirs: RecipeSnapshot,
): ConflictFieldRow | undefined => {
    const baseValue = base[fieldKind];
    const mineValue = mine[fieldKind];
    const theirsValue = theirs[fieldKind];
    const mineChanged = mineValue !== baseValue;
    const theirsChanged = theirsValue !== baseValue;
    const marker = classifyMarker(mineChanged, theirsChanged, mineValue === theirsValue);

    if (marker === 'unchanged') {
        return undefined;
    }

    return {
        key: fieldKind,
        fieldKind,
        marker,
        base: formatScalar(baseValue),
        mine: formatScalar(mineValue),
        theirs: formatScalar(theirsValue),
        mineChanged,
        theirsChanged,
    };
};

/** One 2-way-fallback scalar field row (base evicted), or `undefined` when mine and theirs already agree
 *  (nothing to reconcile). Every emitted row is a `conflict` — see module docs. */
const scalarRowFallback = (
    fieldKind: Exclude<ConflictFieldKind, 'step' | 'ingredient'>,
    mine: RecipeSnapshot,
    theirs: RecipeSnapshot,
): ConflictFieldRow | undefined => {
    const mineValue = mine[fieldKind];
    const theirsValue = theirs[fieldKind];

    if (mineValue === theirsValue) {
        return undefined;
    }

    return {
        key: fieldKind,
        fieldKind,
        marker: 'conflict',
        mine: formatScalar(mineValue),
        theirs: formatScalar(theirsValue),
        mineChanged: true,
        theirsChanged: true,
    };
};

/** Whether a step at a shared position changed relative to a base position — `true` when exactly one of the
 *  pair is `undefined` (added/removed), or both are defined with different authored content
 *  ({@link stepContentChanged}); `false` when both are `undefined` (out of range on both sides) or both are
 *  defined with identical content. Pure. */
const stepPairChanged = (base: RecipeStep | undefined, other: RecipeStep | undefined): boolean => {
    if (base === undefined && other === undefined) {
        return false;
    }

    if (base === undefined || other === undefined) {
        return true;
    }

    return stepContentChanged(base, other);
};

/** Whether two steps (mine vs. theirs) at the same position carry the SAME content — the inverse shape of
 *  {@link stepPairChanged}, used for the mine-vs-theirs equality check in both classification paths. Pure. */
const stepsEqual = (a: RecipeStep | undefined, b: RecipeStep | undefined): boolean => !stepPairChanged(a, b);

/** Whether an ingredient identity changed relative to a base identity — same shape as {@link stepPairChanged}
 *  but for ingredient content ({@link ingredientContentChanged}). Pure. */
const ingredientPairChanged = (base: RecipeIngredient | undefined, other: RecipeIngredient | undefined): boolean => {
    if (base === undefined && other === undefined) {
        return false;
    }

    if (base === undefined || other === undefined) {
        return true;
    }

    return ingredientContentChanged(base, other);
};

/** Whether two ingredients (mine vs. theirs) with the same identity carry the SAME content. Pure. */
const ingredientsEqual = (a: RecipeIngredient | undefined, b: RecipeIngredient | undefined): boolean =>
    !ingredientPairChanged(a, b);

/**
 * Position-wise 3-way step rows: one row per index where mine and/or theirs differ from base, excluding
 * indices where neither side changed anything. Pure.
 */
const stepRows = (
    base: readonly RecipeStep[],
    mine: readonly RecipeStep[],
    theirs: readonly RecipeStep[],
): ConflictFieldRow[] => {
    const length = Math.max(base.length, mine.length, theirs.length);
    const rows: ConflictFieldRow[] = [];

    for (let index = 0; index < length; index += 1) {
        const baseStep = base[index];
        const mineStep = mine[index];
        const theirsStep = theirs[index];

        const mineChanged = stepPairChanged(baseStep, mineStep);
        const theirsChanged = stepPairChanged(baseStep, theirsStep);
        const marker = classifyMarker(mineChanged, theirsChanged, stepsEqual(mineStep, theirsStep));

        if (marker === 'unchanged') {
            continue;
        }

        rows.push({
            key: `steps[${index}]`,
            fieldKind: 'step',
            marker,
            ...(baseStep === undefined ? {} : { base: formatStep(baseStep) }),
            mine: formatStep(mineStep),
            theirs: formatStep(theirsStep),
            mineChanged,
            theirsChanged,
        });
    }

    return rows;
};

/**
 * Position-wise 2-way-fallback step rows (base evicted): one `conflict` row per index where mine and theirs
 * differ at all (including a one-sided add/remove — see module docs), excluding indices where they agree.
 * Pure.
 */
const stepRowsFallback = (mine: readonly RecipeStep[], theirs: readonly RecipeStep[]): ConflictFieldRow[] => {
    const length = Math.max(mine.length, theirs.length);
    const rows: ConflictFieldRow[] = [];

    for (let index = 0; index < length; index += 1) {
        const mineStep = mine[index];
        const theirsStep = theirs[index];

        if (stepsEqual(mineStep, theirsStep)) {
            continue;
        }

        rows.push({
            key: `steps[${index}]`,
            fieldKind: 'step',
            marker: 'conflict',
            mine: formatStep(mineStep),
            theirs: formatStep(theirsStep),
            mineChanged: true,
            theirsChanged: true,
        });
    }

    return rows;
};

/**
 * The union of ingredient identities across up to three collections, in stable first-seen order: `base`'s
 * own order first (when provided), then any new identity introduced by `mine`, then any new identity
 * introduced by `theirs`. Pure.
 */
const orderedIngredientIdentities = (
    base: readonly RecipeIngredient[] | undefined,
    mine: readonly RecipeIngredient[],
    theirs: readonly RecipeIngredient[],
): readonly string[] => {
    const seen = new Set<string>();
    const identities: string[] = [];

    const addAll = (ingredients: readonly RecipeIngredient[]): void => {
        for (const ingredient of ingredients) {
            const identity = ingredientIdentity(ingredient);

            if (!seen.has(identity)) {
                seen.add(identity);
                identities.push(identity);
            }
        }
    };

    if (base !== undefined) {
        addAll(base);
    }

    addAll(mine);
    addAll(theirs);

    return identities;
};

/** Index a collection of ingredients by {@link ingredientIdentity}. Pure. */
const byIdentity = (ingredients: readonly RecipeIngredient[]): Map<string, RecipeIngredient> =>
    new Map(ingredients.map((ingredient) => [ingredientIdentity(ingredient), ingredient] as const));

/**
 * Identity-wise 3-way ingredient rows: one row per identity where mine and/or theirs differ from base,
 * excluding identities where neither side changed anything. Pure.
 */
const ingredientRows = (
    base: readonly RecipeIngredient[],
    mine: readonly RecipeIngredient[],
    theirs: readonly RecipeIngredient[],
): ConflictFieldRow[] => {
    const baseByIdentity = byIdentity(base);
    const mineByIdentity = byIdentity(mine);
    const theirsByIdentity = byIdentity(theirs);
    const rows: ConflictFieldRow[] = [];

    for (const identity of orderedIngredientIdentities(base, mine, theirs)) {
        const baseIngredient = baseByIdentity.get(identity);
        const mineIngredient = mineByIdentity.get(identity);
        const theirsIngredient = theirsByIdentity.get(identity);

        const mineChanged = ingredientPairChanged(baseIngredient, mineIngredient);
        const theirsChanged = ingredientPairChanged(baseIngredient, theirsIngredient);
        const marker = classifyMarker(mineChanged, theirsChanged, ingredientsEqual(mineIngredient, theirsIngredient));

        if (marker === 'unchanged') {
            continue;
        }

        rows.push({
            key: `ingredients:${identity}`,
            fieldKind: 'ingredient',
            marker,
            ...(baseIngredient === undefined ? {} : { base: formatIngredient(baseIngredient) }),
            mine: formatIngredient(mineIngredient),
            theirs: formatIngredient(theirsIngredient),
            mineChanged,
            theirsChanged,
        });
    }

    return rows;
};

/**
 * Identity-wise 2-way-fallback ingredient rows (base evicted): one `conflict` row per identity where mine
 * and theirs differ at all, excluding identities where they agree. Pure.
 */
const ingredientRowsFallback = (
    mine: readonly RecipeIngredient[],
    theirs: readonly RecipeIngredient[],
): ConflictFieldRow[] => {
    const mineByIdentity = byIdentity(mine);
    const theirsByIdentity = byIdentity(theirs);
    const rows: ConflictFieldRow[] = [];

    for (const identity of orderedIngredientIdentities(undefined, mine, theirs)) {
        const mineIngredient = mineByIdentity.get(identity);
        const theirsIngredient = theirsByIdentity.get(identity);

        if (ingredientsEqual(mineIngredient, theirsIngredient)) {
            continue;
        }

        rows.push({
            key: `ingredients:${identity}`,
            fieldKind: 'ingredient',
            marker: 'conflict',
            mine: formatIngredient(mineIngredient),
            theirs: formatIngredient(theirsIngredient),
            mineChanged: true,
            theirsChanged: true,
        });
    }

    return rows;
};

/** Narrow away `undefined` rows produced by the per-scalar-field builders. Pure. */
const isDefinedRow = (row: ConflictFieldRow | undefined): row is ConflictFieldRow => row !== undefined;

/**
 * Compute the changed-only 3-way conflict diff between a common `base` and two divergent edits, `mine` and
 * `theirs` (see module docs for full classification + base-evicted-fallback semantics).
 *
 * @param base - The version both `mine` and `theirs` started editing from, or `undefined` when it has been
 *   evicted from version history (triggers the 2-way fallback — see module docs).
 * @param mine - The current user's (in-progress or resubmitted) snapshot.
 * @param theirs - The latest saved snapshot the user's edit collided with.
 * @returns The changed-only rows, whether any is a genuine conflict, and whether there is nothing to merge.
 */
export const computeConflictDiff = (
    base: RecipeSnapshot | undefined,
    mine: RecipeSnapshot,
    theirs: RecipeSnapshot,
): ConflictDiff => {
    const rows: ConflictFieldRow[] =
        base === undefined
            ? [
                  ...SCALAR_FIELD_KINDS.map((fieldKind) => scalarRowFallback(fieldKind, mine, theirs)).filter(
                      isDefinedRow,
                  ),
                  ...stepRowsFallback(mine.steps, theirs.steps),
                  ...ingredientRowsFallback(mine.ingredients, theirs.ingredients),
              ]
            : [
                  ...SCALAR_FIELD_KINDS.map((fieldKind) => scalarRow(fieldKind, base, mine, theirs)).filter(
                      isDefinedRow,
                  ),
                  ...stepRows(base.steps, mine.steps, theirs.steps),
                  ...ingredientRows(base.ingredients, mine.ingredients, theirs.ingredients),
              ];

    return {
        rows,
        hasConflict: rows.some((row) => row.marker === 'conflict'),
        isEmpty: rows.length === 0,
    };
};
