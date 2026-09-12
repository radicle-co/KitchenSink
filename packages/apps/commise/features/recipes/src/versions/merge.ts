/**
 * @module @commise/features-recipes/versions — Resolving a 409 WITHOUT a refetch: projecting shapes across the snapshot/form/detail boundary and
 * applying the viewer's per-field and per-element merge selections.
 *
 * ⛔ This module knows NOTHING about messages, `Locale`, or any view. That is load-bearing rather than tidy:
 * its only production consumer is `useRecipeEditor.ts`, a platform-agnostic hook whose own docstring says it
 * "does not have and must not import" the localized copy. So the merge SUMMARY (`formatMergeSummary`,
 * `countMergeSelections`) and the staleness GATE (`isConflictBaseStale`) live in `conflictView.ts` instead —
 * they need messages and a locale, and only the view consumes them.
 *
 * @pattern Adapter — `draftToSnapshot` / `applyServerSnapshotToRecipeDetail` translate between the wire
 * `RecipeSnapshot` and the editor's `RecipeFormValues` / `RecipeDetail`. They convert and decide nothing,
 * which is why the selection policy sits beside them rather than inside them.
 *
 * Pure and platform-agnostic: shared unchanged by the web (`*.tsx`) and native (`*.native.tsx`) leaves, so
 * the two renders can never drift. No React, no platform APIs.
 */
import type {
    RecipeDetail,
    RecipeIngredient,
    RecipeIngredientView,
    RecipeSnapshot,
    RecipeStep,
    RecipeStepView,
    VersionConflictSide,
} from '@kitchensink/recipe-core';
import { draftQuantity } from '../form/quantity.js';
import { computeTotalTime } from '../form/totalTime.js';
import type { RecipeFormIngredient, RecipeFormStep, RecipeFormValues } from '../form/values.js';

// ─── Field-by-field merge (T070 / FR-007c option c) ─────────────────────────────────────────────────
//
// A concurrent-edit conflict must let the user MERGE — compose the resubmitted draft field-by-field, taking
// each editable field from either their own in-progress draft ("mine") or the latest saved recipe ("theirs").
// This is a genuine merge (keep my new title AND the other device's added ingredient), distinct from the
// keep-mine / use-theirs whole-record choices, and it is what FR-007c's "MUST NOT last-write-wins" forbids
// resolving any other way. Every field's resolution is the user's EXPLICIT choice — nothing is auto-combined.
//
// `composeMergedRecipe` below is the TOP-LEVEL-FIELD compose primitive `composeConflictMerge` (W7 Task 2)
// builds on. There is deliberately no `buildRecipeMergeFields`-style "every editable field, whole-record"
// panel-building helper here (a pre-W7 shape, removed by W7 Task 5): the merge panel now renders ONLY the
// CHANGED fields/elements — `ConflictDiff.rows` (W7 Task 1), each row already labelled by
// `conflictRowLabel` (Task 4) — so a second, whole-field label/format registry would be a second,
// drifting representation of the same "what does this field look like" knowledge the diff row already
// carries.

/** Which side of the conflict a merged field is taken from. */
export type MergeSide = 'mine' | 'theirs';

/** Per-field/per-element resolution: for each `ConflictFieldRow.key` (a top-level field name, or a
 *  per-element `steps[N]`/`ingredients:<id>` key), the side the user chose. */
export type RecipeMergeSelections = Readonly<Record<string, MergeSide>>;

// A NAMED `defaultMergeSelections` helper (materializing every known field key to `'mine'`) was deliberately
// NOT reintroduced here (CP-6/P1), and stays out after W7 Task 5's per-element rework: EVERY reader of a
// per-field/per-element selection already treats an ABSENT key as `'mine'` — `composeMergedRecipe` below
// (`selections[key] === 'theirs' ? theirs : mine`) and `composeConflictMerge`'s own element-merge helpers
// (`mergeStepsByElement`/`mergeIngredientsByElement`) — so seeding the `useRecipeEditor` machine's
// `conflict.mergeSelections` with `{}` on conflict entry is BEHAVIORALLY IDENTICAL to seeding it with a
// materialized default record. Keeping an unconsumed third statement of "mine is the default" alongside the
// readers above would be a DRY liability, not a DRY win.

/**
 * Compose the merged draft from the per-field selections: each field is taken from "theirs" when the user
 * chose it, otherwise kept from "mine". Data-driven over the draft's keys, so a field with no explicit
 * selection defaults to "mine" and a newly-added field is carried through. Pure — the inputs are untouched.
 *
 * @param mine - The user's in-progress draft.
 * @param theirs - The latest saved recipe projected to the editable form shape.
 * @param selections - The per-field resolution.
 * @returns A new {@link RecipeFormValues} composed field-by-field.
 */
export const composeMergedRecipe = (
    mine: RecipeFormValues,
    theirs: RecipeFormValues,
    selections: RecipeMergeSelections,
): RecipeFormValues => {
    const theirsRecord = theirs as unknown as Readonly<Record<string, unknown>>;
    const merged: Record<string, unknown> = { ...mine };

    for (const key of Object.keys(merged)) {
        if (selections[key] === 'theirs') {
            merged[key] = theirsRecord[key];
        }
    }

    // `merged` is a per-key copy of `mine` (same shape) with some values replaced by `theirs`' same-typed
    // values, so it satisfies `RecipeFormValues`; the cast bridges the key-driven `Record` build.
    return merged as unknown as RecipeFormValues;
};

// ─── Snapshot projections + per-element merge (W7 Task 2) ───────────────────────────────────────────
//
// The 409's enriched body (`VersionConflictError.server`/`.base`, W8-a.5) carries `RecipeSnapshot`-shaped
// sides; `useRecipeEditor`'s draft is `RecipeFormValues`-shaped. These two projections bridge that gap
// WITHOUT a refetch: `draftToSnapshot` turns the in-progress draft into the same `RecipeSnapshot`
// shape `computeConflictDiff` (W7 Task 1) compares against, and `applyServerSnapshotToRecipeDetail`
// turns the server's snapshot into a displayable `RecipeDetail` by overlaying it onto the last-known
// recipe (the query cache's `RecipeDetail`, used purely as a SHELL for fields a snapshot doesn't carry —
// id, ownerId, visibility, photos, nutrition, etc.).

/**
 * Project the in-progress draft to a {@link RecipeSnapshot} — the shape `computeConflictDiff` (W7
 * Task 1) 3-way-compares against the 409's `server`/`base` sides. `id`/`recipeId` on the synthesized
 * `RecipeStep`/`RecipeIngredient` rows are placeholders (never persisted, never read by
 * `computeConflictDiff`'s content comparisons — see `diff.ts`'s module docs on why those fields are
 * structural, not authored content); `sortOrder` is the line's array position, mirroring how the service
 * assigns it on save. An unresolved ingredient line (no `ingredientId` yet) is dropped, matching every
 * other draft→wire projection (`toCreateRecipeInput` (`../form/wire.ts`)) — an
 * unresolved line was never going to reach the server, so it cannot appear in what the server sees either.
 * `isUserEntered` defaults to `false` (the draft carries no provenance flag). Pure.
 *
 * @param values - The editor's current draft.
 * @param version - The snapshot's own sequence number (excluded from every diff — see `diff.ts` — so any
 *   value is diff-safe; callers pass the base version this draft started from, when known).
 * @returns The draft projected to a {@link RecipeSnapshot}.
 */
export const draftToSnapshot = (values: RecipeFormValues, version: number): RecipeSnapshot => ({
    version,
    title: values.title.trim(),
    description: values.description.trim(),
    servings: values.servings,
    prepTimeMinutes: values.prepTimeMinutes,
    cookTimeMinutes: values.cookTimeMinutes,
    steps: values.steps.map((step, index): RecipeStep => ({
        id: `draft-step-${index}`,
        recipeId: '',
        stepNumber: index + 1,
        instruction: step.instruction,
        ...(step.timerSeconds === undefined ? {} : { timerSeconds: step.timerSeconds }),
    })),
    ingredients: values.ingredients
        .filter((line): line is RecipeFormIngredient & { ingredientId: string } => line.ingredientId !== null)
        .map((line, index): RecipeIngredient => ({
            id: `draft-ingredient-${index}`,
            recipeId: '',
            ingredientId: line.ingredientId,
            quantity: draftQuantity(line),
            unit: line.unit ?? '',
            ...(line.notes === undefined || line.notes === '' ? {} : { displayText: line.notes }),
            // U26/U27 — the DRAFT side of the conflict comparison. `computeConflictDiff` compares this
            // projection against the server's snapshot through `ingredientContentChanged`, so a field
            // missing here is a field the merge believes the local edit never touched: the cook's
            // preparation would be silently discarded in favour of the server's, with no conflict shown.
            ...(line.preparation === undefined || line.preparation.trim() === ''
                ? {}
                : { preparation: line.preparation.trim() }),
            ...(line.groupLabel === undefined || line.groupLabel.trim() === ''
                ? {}
                : { groupLabel: line.groupLabel.trim() }),
            sortOrder: index,
            ingredientName: line.name,
            isUserEntered: false,
            ...(line.userCalories === undefined ? {} : { userCalories: line.userCalories }),
            ...(line.userProteinG === undefined ? {} : { userProteinG: line.userProteinG }),
            ...(line.userCarbsG === undefined ? {} : { userCarbsG: line.userCarbsG }),
            ...(line.userFatG === undefined ? {} : { userFatG: line.userFatG }),
        })),
});

/**
 * Overlay a 409's `server`/`base` {@link VersionConflictSide} onto a base {@link RecipeDetail} SHELL — the
 * inverse of {@link draftToSnapshot}, and the `RecipeDetail`-shaped "theirs" display side `useRecipeEditor`
 * builds WITHOUT a refetch (W7 Task 2): `base` supplies every field a `RecipeSnapshot` doesn't carry (id,
 * ownerId, visibility, photos, nutrition, timestamps, …), and `side`'s snapshot overlays the 7 diffable
 * fields plus `currentVersion` (the fresh CAS token — `side.versionNumber`). Pure.
 *
 * @param base - The last-known recipe (the query cache's `RecipeDetail`), used only as a field shell.
 * @param side - The 409's `server` (or `base`) side to overlay.
 * @returns A {@link RecipeDetail} reflecting `side`'s content on top of `base`'s other fields.
 */
export const applyServerSnapshotToRecipeDetail = (base: RecipeDetail, side: VersionConflictSide): RecipeDetail => {
    const { snapshot } = side;

    return {
        ...base,
        currentVersion: side.versionNumber,
        title: snapshot.title,
        description: snapshot.description,
        servings: snapshot.servings,
        prepTimeMinutes: snapshot.prepTimeMinutes,
        cookTimeMinutes: snapshot.cookTimeMinutes,
        totalTimeMinutes: computeTotalTime(snapshot.prepTimeMinutes, snapshot.cookTimeMinutes),
        ingredients: snapshot.ingredients.map((ingredient): RecipeIngredientView => ({
            ingredientId: ingredient.ingredientId,
            name: ingredient.ingredientName,
            quantity: ingredient.quantity,
            ...(ingredient.unit === '' ? {} : { unit: ingredient.unit }),
            ...(ingredient.displayText === undefined || ingredient.displayText === ''
                ? {}
                : { notes: ingredient.displayText }),
            // U26/U27 — carried onto the conflict shell too, so the three-way merge's "server" and
            // "base" sides can differ on them at all. A side that cannot REPRESENT a field can never
            // report a conflict about it.
            ...(ingredient.preparation === undefined ? {} : { preparation: ingredient.preparation }),
            ...(ingredient.groupLabel === undefined ? {} : { groupLabel: ingredient.groupLabel }),
            isUserEntered: ingredient.isUserEntered,
        })),
        steps: snapshot.steps.map((step): RecipeStepView => ({
            stepNumber: step.stepNumber,
            instruction: step.instruction,
            ...(step.timerSeconds === undefined ? {} : { timerSeconds: step.timerSeconds }),
        })),
    };
};

/** Matches a per-element STEP selection key from `computeConflictDiff` (W7 Task 1), e.g. `steps[2]`. */
const STEP_SELECTION_KEY = /^steps\[\d+\]$/;

/** Matches a per-element INGREDIENT selection key from `computeConflictDiff` (W7 Task 1), e.g.
 *  `ingredients:ing_1`. */
const INGREDIENT_SELECTION_KEY = /^ingredients:/;

/**
 * Position-wise per-element step merge: an explicit `steps[N]` selection of `'theirs'` swaps that index;
 * every other index keeps mine's own step. An index mine has no step at is included ONLY when explicitly
 * selected `'theirs'` (an element theirs added that mine never had) — matching {@link composeMergedRecipe}'s
 * "absent selection defaults to mine" rule extended to element granularity. Pure.
 */
const mergeStepsByElement = (
    mine: readonly RecipeFormStep[],
    theirs: readonly RecipeFormStep[],
    selections: RecipeMergeSelections,
): RecipeFormStep[] => {
    const length = Math.max(mine.length, theirs.length);
    const result: RecipeFormStep[] = [];

    for (let index = 0; index < length; index += 1) {
        const chooseTheirs = selections[`steps[${index}]`] === 'theirs';
        const step = chooseTheirs ? theirs[index] : mine[index];

        if (step !== undefined) {
            result.push(step);
        }
    }

    return result;
};

/**
 * Identity-wise per-element ingredient merge, keyed by `ingredientId` (the SAME stable cross-version
 * identity `diff.ts`'s `ingredientIdentity` uses): an explicit `ingredients:<id>` selection of `'theirs'`
 * swaps that identity's line; every other identity keeps mine's own line. An identity mine has no line for
 * is included ONLY when explicitly selected `'theirs'`. Pure.
 */
const mergeIngredientsByElement = (
    mine: readonly RecipeFormIngredient[],
    theirs: readonly RecipeFormIngredient[],
    selections: RecipeMergeSelections,
): RecipeFormIngredient[] => {
    const theirsByIdentity = new Map(
        theirs
            .filter((line): line is RecipeFormIngredient & { ingredientId: string } => line.ingredientId !== null)
            .map((line) => [line.ingredientId, line] as const),
    );
    const mineIdentities = new Set(mine.map((line) => line.ingredientId).filter((id): id is string => id !== null));
    const result: RecipeFormIngredient[] = [];

    for (const line of mine) {
        const chooseTheirs = line.ingredientId !== null && selections[`ingredients:${line.ingredientId}`] === 'theirs';

        if (!chooseTheirs) {
            result.push(line);
            continue;
        }

        const theirsLine = line.ingredientId === null ? undefined : theirsByIdentity.get(line.ingredientId);

        if (theirsLine !== undefined) {
            result.push(theirsLine);
        }
    }

    for (const line of theirs) {
        if (
            line.ingredientId !== null &&
            !mineIdentities.has(line.ingredientId) &&
            selections[`ingredients:${line.ingredientId}`] === 'theirs'
        ) {
            result.push(line);
        }
    }

    return result;
};

/**
 * Compose the merged draft for the W7 per-element conflict resolution (FR-007c option c): top-level fields
 * resolve via {@link composeMergedRecipe} (unchanged — absent key defaults to `'mine'`), then `steps`/
 * `ingredients` are RE-COMPOSED element-wise whenever `selections` carries any per-element key
 * (`computeConflictDiff`'s `steps[N]`/`ingredients:<id>` row keys, W7 Task 1) — the finer-grained
 * resolution the per-row radio offers. A collection with NO per-element selection at all keeps
 * {@link composeMergedRecipe}'s own (whole-array, default-mine) result untouched, so a caller that only
 * ever sets top-level keys sees IDENTICAL behavior to before this change. Pure.
 *
 * @param mine - The user's in-progress draft.
 * @param theirs - The latest saved recipe projected to the editable form shape.
 * @param selections - The per-field AND per-element resolution (absent key defaults to `'mine'`).
 * @returns A new {@link RecipeFormValues} composed field-by-field and, where selected, element-by-element.
 */
export const composeConflictMerge = (
    mine: RecipeFormValues,
    theirs: RecipeFormValues,
    selections: RecipeMergeSelections,
): RecipeFormValues => {
    const merged = composeMergedRecipe(mine, theirs, selections);
    const keys = Object.keys(selections);
    const hasStepSelection = keys.some((key) => STEP_SELECTION_KEY.test(key));
    const hasIngredientSelection = keys.some((key) => INGREDIENT_SELECTION_KEY.test(key));

    return {
        ...merged,
        ...(hasStepSelection ? { steps: mergeStepsByElement(mine.steps, theirs.steps, selections) } : {}),
        ...(hasIngredientSelection
            ? { ingredients: mergeIngredientsByElement(mine.ingredients, theirs.ingredients, selections) }
            : {}),
    };
};
