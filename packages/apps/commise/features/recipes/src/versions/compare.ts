/**
 * @module @commise/features-recipes/versions — The two-version COMPARE panel's model: its state, its field rows, and the collection tally.
 *
 * Pure and platform-agnostic: shared unchanged by the web (`*.tsx`) and native (`*.native.tsx`) leaves, so
 * the two renders can never drift. No React, no platform APIs.
 */
import type { Locale } from '@commise/i18n';
import type { RecipeSnapshot, RecipeVersion } from '@kitchensink/recipe-core';
import { fillTemplate, formatDurationMinutes, formatRecipeCount } from '../list/model.js';
import type { DiffTally, SnapshotDiff, SnapshotFieldKey } from './diff.js';
import type { RecipeConflictMessages, RecipeVersionCompareMessages } from './messages.js';
import { snapshotFieldLabel } from './diffLabels.js';

// ─── Version compare (W6 Task 4 / FR-007b, FR-007c) ─────────────────────────────────────────────────
//
// The wireframe's "Compare Versions" right sidebar: pick two versions (selection UI lives in the composing
// container, Task 5) and show the Diff Summary (Added/Removed/Modified rollup, `SnapshotDiff.summary`)
// plus a CHANGED-ONLY field-by-field A/B display — only `diff.changedFields` are rendered, each with both
// versions' values side by side. `steps`/`ingredients` render as a compact count (never a per-line
// explosion — see `buildCompareFieldRows`'s module docs on the reorder sanity note from Task 1).

/**
 * Props for the two-version compare panel (W6 Task 4) — a FULLY controlled, presentational component. It
 * renders the Diff Summary + changed-only A/B display for two ALREADY-SELECTED versions; it computes no
 * diff itself (`diff` is `diffSnapshots(versionA.snapshot, versionB.snapshot)`, computed by the composing
 * container, Task 5) and fetches nothing. `versionA`/`versionB`/`diff` are OPTIONAL together — while `open`
 * is true but fewer than two versions have been chosen yet, the view shows
 * {@link RecipeVersionCompareMessages.selectTwoVersions} instead of a broken partial render.
 */
export interface VersionCompareViewProps {
    /** Whether the panel (web right-side panel) / sheet (native full-screen) is open. */
    readonly open: boolean;
    /** The first selected version. */
    readonly versionA?: RecipeVersion;
    /** The second selected version. */
    readonly versionB?: RecipeVersion;
    /** `diffSnapshots(versionA.snapshot, versionB.snapshot)`, computed by the caller. */
    readonly diff?: SnapshotDiff;
    /** Invoked to close the panel/sheet — the explicit close control, Escape (web), and the Radix overlay/
     *  backdrop dismissal all resolve to this ONE callback (mirrors `VersionPreviewModalProps.onCancel`'s (`preview.ts`)
     *  single exit path). */
    readonly onClose: () => void;
    /** The active BCP-47 locale (count-pluralization input only; this component owns no locale state). */
    readonly locale: Locale;
}

/** The three mutually-exclusive states {@link VersionCompareViewProps} renders, computed once so the web and
 *  native leaves can't drift on which state they're in. */
export type VersionCompareState = 'selecting' | 'unchanged' | 'changed';

/**
 * Determine which of the three compare-panel states applies. `'selecting'` when fewer than two versions (or
 * no `diff`) have been supplied yet; `'unchanged'` when both are supplied but the snapshots are identical
 * (`diff.changedFields` is empty); `'changed'` otherwise. Pure.
 *
 * @param versionA - The first selected version, if chosen.
 * @param versionB - The second selected version, if chosen.
 * @param diff - The diff between them, if computed.
 * @returns The panel's current state.
 */
export const compareViewState = (
    versionA: RecipeVersion | undefined,
    versionB: RecipeVersion | undefined,
    diff: SnapshotDiff | undefined,
): VersionCompareState => {
    if (versionA === undefined || versionB === undefined || diff === undefined) {
        return 'selecting';
    }

    return diff.changedFields.length === 0 ? 'unchanged' : 'changed';
};

/** One row of the compare panel's changed-only field-by-field A/B display. */
export interface CompareFieldRow {
    /** Stable key for React reconciliation and test lookup — the diffed field itself. */
    readonly key: SnapshotFieldKey;
    /** The localized field label (reused from {@link RecipeConflictMessages} — see {@link snapshotFieldLabel}). */
    readonly label: string;
    /** Version A's rendered value for this field. */
    readonly valueA: string;
    /** Version B's rendered value for this field. */
    readonly valueB: string;
    /** For `steps`/`ingredients` rows ONLY: this collection's own Added/Removed/Modified tally, rendered
     *  behind the `showFullDiff` toggle. ABSENT for scalar fields, which already show their full value and
     *  have no separate tally to reveal. */
    readonly tally?: DiffTally;
}

/** The scalar `SnapshotFieldKey`s — every field except `steps`/`ingredients`. */
type ScalarFieldKey = Exclude<SnapshotFieldKey, 'steps' | 'ingredients'>;

/** Render one scalar field's raw value for display — `prepTimeMinutes`/`cookTimeMinutes` through the shared
 *  duration template (the SAME template every duration-rendering surface in this module uses, so they can
 *  never disagree on how a duration reads); every other scalar (`title`/`description`/`servings`) as its own
 *  string form. Pure. */
const scalarFieldValue = (field: ScalarFieldKey, snapshot: RecipeSnapshot, messages: RecipeConflictMessages): string =>
    field === 'prepTimeMinutes' || field === 'cookTimeMinutes'
        ? formatDurationMinutes(snapshot[field], messages.minutes)
        : String(snapshot[field]);

/**
 * Render a `steps`/`ingredients` field's value as a COUNT ONLY — deliberately never a per-line explosion.
 * This is the Task 1 sanity note's resolution: the ingredient diff's `modified` tally folds in `sortOrder`
 * (so a pure reorder — same ingredients, swapped positions — reports `modified > 0` with an UNCHANGED
 * count), and a per-line render of "5 modified" identical-looking lines would misread as content having
 * changed when only the order did. A same-count A/B ("5 ingredients" both sides) is truthful either way: no
 * lines were added or removed, and the row's mere presence in the changed-only list already signals
 * "something differs" without asserting WHAT. The full Added/Removed/Modified tally (accurate regardless of
 * cause) is available as opt-in detail via `showFullDiff` ({@link formatCollectionTally}), never as the
 * default headline number. Pure.
 */
const collectionFieldValue = (
    field: 'steps' | 'ingredients',
    snapshot: RecipeSnapshot,
    messages: RecipeConflictMessages,
    locale: Locale,
): string =>
    field === 'steps'
        ? formatRecipeCount(
              snapshot.steps.length,
              { one: messages.stepCountOne, other: messages.stepCountOther },
              locale,
          )
        : formatRecipeCount(
              snapshot.ingredients.length,
              { one: messages.ingredientCountOne, other: messages.ingredientCountOther },
              locale,
          );

/**
 * Project a diff into the changed-only field-by-field A/B rows the compare panel renders — ONLY
 * `diff.changedFields`, each with version A's and version B's value (see {@link scalarFieldValue} /
 * {@link collectionFieldValue}). Preserves {@link SnapshotFieldKey}'s declared order (the order
 * `changedFields` already carries). Pure.
 *
 * @param diff - The diff to project.
 * @param versionA - The first selected version.
 * @param versionB - The second selected version.
 * @param messages - The shared conflict-panel field labels + duration/count templates.
 * @param locale - The active BCP-47 locale (for count pluralization).
 * @returns The changed-only A/B rows, in declared field order.
 */
export const buildCompareFieldRows = (
    diff: SnapshotDiff,
    versionA: RecipeVersion,
    versionB: RecipeVersion,
    messages: RecipeConflictMessages,
    locale: Locale,
): readonly CompareFieldRow[] =>
    diff.changedFields.map((field) => {
        const label = snapshotFieldLabel(field, messages);

        if (field === 'steps' || field === 'ingredients') {
            return {
                key: field,
                label,
                valueA: collectionFieldValue(field, versionA.snapshot, messages, locale),
                valueB: collectionFieldValue(field, versionB.snapshot, messages, locale),
                tally: diff[field],
            };
        }

        return {
            key: field,
            label,
            valueA: scalarFieldValue(field, versionA.snapshot, messages),
            valueB: scalarFieldValue(field, versionB.snapshot, messages),
        };
    });

/**
 * Render a `steps`/`ingredients` row's own Added/Removed/Modified tally for the `showFullDiff` opt-in detail
 * — reuses the SAME localized templates the Diff Summary rollup renders
 * ({@link RecipeVersionCompareMessages.added}/`removed`/`modified`), applied to this ONE collection's tally
 * instead of the overall summary, so "Added: N" is one piece of knowledge regardless of which tally it is
 * reporting.
 * Pure.
 *
 * @param tally - The collection's own Added/Removed/Modified tally.
 * @param messages - The localized compare-panel copy.
 * @returns The formatted tally line.
 */
export const formatCollectionTally = (tally: DiffTally, messages: RecipeVersionCompareMessages): string =>
    [
        fillTemplate(messages.added, { count: tally.added }),
        fillTemplate(messages.removed, { count: tally.removed }),
        fillTemplate(messages.modified, { count: tally.modified }),
    ].join(' · ');
