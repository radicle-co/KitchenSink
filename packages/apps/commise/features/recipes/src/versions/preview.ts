/**
 * @module @commise/features-recipes/versions — The version-PREVIEW modal's model: its props, its ingredient-line projection, and the
 * container-side derivation that decides what the modal is previewing.
 *
 * Pure and platform-agnostic: shared unchanged by the web (`*.tsx`) and native (`*.native.tsx`) leaves, so
 * the two renders can never drift. No React, no platform APIs.
 */
import type { Locale } from '@commise/i18n';
import type { RecipeIngredient, RecipeVersion } from '@kitchensink/recipe-core';
import { formatCalories } from '../card/model.js';
import { formatIngredientLine } from '../detail/model.js';
import { fillTemplate, formatRecipeCount } from '../list/model.js';
import { diffSnapshots, type SnapshotDiff } from './diff.js';
import type { RecipeConflictMessages, RecipeVersionPreviewMessages } from './messages.js';

// ─── Version preview modal (W6 Task 3 / FR-007b) ────────────────────────────────────────────────────

/**
 * Props for the version preview modal (W6 Task 3) — a FULLY controlled, presentational component. Renders
 * a past version's full snapshot content plus a "changed from current" summary derived from
 * `diffFromCurrent` ({@link diffSnapshots}, Task 1, computed by the caller against the recipe's CURRENT
 * version). Fetches nothing — the composing container (Task 5) wires `useRecipeVersion` to these props.
 */
export interface VersionPreviewModalProps {
    /** Whether the modal is open. */
    readonly open: boolean;
    /** The previewed version (its full snapshot). ABSENT while loading or on error — and, per B21, ABSENT
     *  while nothing is loading IS the error: the modal reports a failed lookup rather than spinning. */
    readonly version?: RecipeVersion;
    /** Whether the version fetch is in flight. The ONLY input to the progress affordance (B21) — an absent
     *  `version` no longer implies "still loading", or a settled-with-nothing caller strands the viewer. */
    readonly isLoading: boolean;
    /** Whether the version lookup failed. NOT a dead end — Keep-current/Cancel still closes the modal, so
     *  the composing container can retry. One of TWO routes to the failure affordance; the other is an
     *  absent `version` with nothing in flight. */
    readonly error?: boolean;
    /** This version's diff vs. the recipe's CURRENT version, for the "Changed from current" line. ABSENT
     *  while loading/erroring, alongside `version`. */
    readonly diffFromCurrent?: SnapshotDiff;
    /** Invoked to close the modal without restoring — "Keep current version", Cancel, Escape, or the
     *  backdrop click all resolve to this ONE callback (mirrors `PullUpdatesDialog`'s single exit path). */
    readonly onCancel: () => void;
    /** Invoked with the previewed version's number when "Restore this version" is activated. */
    readonly onRestore: (versionNumber: number) => void;
    /** Whether the previewed version is CURRENTLY being restored (W6 Task 5) — the composing container
     *  derives this from its restore mutation's pending state for THIS version's number. Busies and disables
     *  the Restore action (swapping its label for the busy copy) so an in-flight restore-from-preview cannot
     *  be double-submitted. Defaults to idle (`false`) when omitted. */
    readonly isRestoring?: boolean;
    /** The active BCP-47 locale (calorie-formatting input only; this component owns no locale state). */
    readonly locale: Locale;
}

/** One ingredient line rendered by the preview modal — pre-formatted text plus its calorie chip, WHEN the
 *  snapshot ingredient carries one (see {@link toVersionPreviewIngredientLines}). */
export interface VersionPreviewIngredientLine {
    /** Stable key for React reconciliation — the snapshot row's own (frozen) id. */
    readonly key: string;
    /** The formatted "{quantity}{unit} {name}" text, with any `displayText` override and any
     *  `preparation` clause appended. ⛔ The preparation is a trailing CLAUSE, never part of the name. */
    readonly text: string;
    /** The formatted "{calories} cal" chip. OMITTED (never fabricated) when the ingredient carries no
     *  `userCalories` override — a catalog-resolved line's per-serving calories are not captured in a
     *  `RecipeSnapshot` at all (see `diff.ts` module docs). */
    readonly calories?: string;
}

/**
 * Project a version snapshot's ingredient lines into the pre-formatted rows the preview modal renders.
 * Reuses `formatIngredientLine` (the SHARED line formatter `conflictDiff.ts` also calls) and {@link formatCalories}
 * (the card's calorie formatter) rather than re-deriving either — one authoritative formatting per piece of
 * knowledge, so the preview can never render a quantity or a calorie count differently than the rest of the
 * app. A line's calorie chip renders ONLY when the snapshot ingredient itself carries `userCalories` (a
 * user-entered nutrition override, W8-a.7); this NEVER fabricates a figure for a catalog-resolved line. Pure.
 *
 * @param ingredients - The snapshot's ingredient lines, in their stored order.
 * @param messages - The localized preview copy (the calorie template).
 * @param locale - The active BCP-47 locale.
 * @returns The ordered, pre-formatted ingredient lines.
 */
export const toVersionPreviewIngredientLines = (
    ingredients: readonly RecipeIngredient[],
    messages: RecipeVersionPreviewMessages,
    locale: Locale,
): readonly VersionPreviewIngredientLine[] =>
    ingredients.map((ingredient) => ({
        key: ingredient.id,
        // ⚠️ The SHARED formatter (`detail/model.ts`), not a local copy — this projection and
        // `conflictDiff.ts`'s merge row were byte-identical copies of the same formatting, so a field
        // added to one and forgotten in the other made a version's history and its conflict merge
        // disagree about the same line.
        text: formatIngredientLine(ingredient, locale),
        ...(ingredient.userCalories !== undefined
            ? {
                  calories: fillTemplate(messages.caloriesLabel, {
                      calories: formatCalories(ingredient.userCalories, locale),
                  }),
              }
            : {}),
    }));

/**
 * Compute the "Changed from current: {n} ingredients, {m} steps" counts from a {@link SnapshotDiff}: each
 * collection's TOTAL changed lines (added + removed + modified) — the same per-collection tallies the Diff
 * Summary rollup (Task 1) is built from, not a bespoke count. Pure.
 *
 * @param diff - This version's diff vs. the recipe's current version.
 * @returns The total changed ingredient and step counts.
 */
export const changedFromCurrentCounts = (
    diff: SnapshotDiff,
): { readonly ingredients: number; readonly steps: number } => ({
    ingredients: diff.ingredients.added + diff.ingredients.removed + diff.ingredients.modified,
    steps: diff.steps.added + diff.steps.removed + diff.steps.modified,
});

/**
 * Render the "Changed from current: {ingredients}, {steps}" summary line from a {@link SnapshotDiff}, with
 * each count correctly pluralized via the SAME `ingredientCount*`/`stepCount*` templates the compare panel's
 * own ingredient/step counts already use (`collectionFieldValue`, module-private in `compare.ts`) — a count of 1 reads "1
 * ingredient"/"1 step", never a hard-coded plural ("1 ingredients"/"1 steps"). The field label is one piece
 * of knowledge regardless of which version surface renders it; so is its pluralization. Pure.
 *
 * @param diff - This version's diff vs. the recipe's current version.
 * @param previewMessages - The localized preview copy (the summary line's own template).
 * @param conflictMessages - The shared singular/plural count templates (reused — see `collectionFieldValue` in `compare.ts`).
 * @param locale - The active BCP-47 locale (for locale-correct count pluralization).
 * @returns The formatted "Changed from current" summary line.
 */
export const formatChangedFromCurrent = (
    diff: SnapshotDiff,
    previewMessages: RecipeVersionPreviewMessages,
    conflictMessages: RecipeConflictMessages,
    locale: Locale,
): string => {
    const counts = changedFromCurrentCounts(diff);

    return fillTemplate(previewMessages.changedFromCurrent, {
        ingredients: formatRecipeCount(
            counts.ingredients,
            { one: conflictMessages.ingredientCountOne, other: conflictMessages.ingredientCountOther },
            locale,
        ),
        steps: formatRecipeCount(
            counts.steps,
            { one: conflictMessages.stepCountOne, other: conflictMessages.stepCountOther },
            locale,
        ),
    });
};

// ─── Version preview state derivation (B21) ─────────────────────────────────────────────────────────
//
// The web container (`RecipeVersionsContainer`) and the native screen (`RecipeVersionsScreen`) both wire the
// preview modal from the SAME four inputs, and both used to derive its props with a verbatim copy of the same
// four expressions — including a hard-coded `isLoading={false}` and an `error` that was never passed at all.
// That made ONE state unreachable and another a dead end: when the preview target is not in the (already
// loaded, already settled) history, `version` is `undefined`, the modal's own precedence reads that as "still
// loading", and it spun forever with no way to say the lookup had failed. The derivation now lives HERE, once,
// so a lookup miss is reported as the FAILURE it is on both platforms at the same time.

/** The container-owned inputs a version preview is derived from. */
export interface VersionPreviewSource {
    /** The version number being previewed, or `null` when the modal is closed. */
    readonly previewTarget: number | null;
    /** The already-loaded version history the preview reads its snapshot from (no extra fetch). */
    readonly versions: readonly RecipeVersion[];
    /** The recipe's current version number, for the "Changed from current" line. */
    readonly currentVersion: number;
    /** The version number a restore is currently in flight for, or `null` when idle. */
    readonly restoringVersion: number | null;
}

/** The DATA props {@link VersionPreviewModalProps} renders from — everything except the callbacks and the
 *  locale, which stay the caller's own. Derived once by {@link resolveVersionPreview}. */
export type VersionPreviewState = Pick<
    VersionPreviewModalProps,
    'open' | 'version' | 'isLoading' | 'diffFromCurrent' | 'isRestoring'
> & {
    /** Whether the preview could not be resolved — see {@link resolveVersionPreview}. Always present (never
     *  merely omitted), so a caller cannot forget to pass it and silently reinstate the endless spinner. */
    readonly error: boolean;
};

/**
 * Derive the preview modal's data props from the container's state and its already-loaded history. Pure.
 *
 * `isLoading` is ALWAYS `false`: the preview makes no request of its own — every entry the versions endpoint
 * returns carries its own snapshot, so the modal is only ever opened against data that has already arrived.
 * A `previewTarget` the history does not contain is therefore NOT a pending fetch; it is a failed lookup, and
 * it resolves to `error: true` (the honest report the modal has always been able to render but no caller
 * could ever produce). `diffFromCurrent` is omitted when either side is missing, and a restore is reported in
 * flight only for a version that actually RESOLVED — an unresolvable preview offers no Restore action to busy.
 *
 * @param source - The preview target, the loaded history, the recipe's current version, and the restore state.
 * @returns The modal's data props.
 */
export const resolveVersionPreview = ({
    previewTarget,
    versions,
    currentVersion,
    restoringVersion,
}: VersionPreviewSource): VersionPreviewState => {
    if (previewTarget === null) {
        return { open: false, isLoading: false, error: false, isRestoring: false };
    }

    const version = versions.find((candidate) => candidate.versionNumber === previewTarget);

    if (version === undefined) {
        return { open: true, isLoading: false, error: true, isRestoring: false };
    }

    const current = versions.find((candidate) => candidate.versionNumber === currentVersion);

    return {
        open: true,
        version,
        isLoading: false,
        error: false,
        isRestoring: restoringVersion === previewTarget,
        ...(current === undefined ? {} : { diffFromCurrent: diffSnapshots(current.snapshot, version.snapshot) }),
    };
};
