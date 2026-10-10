/**
 * @module @commise/features-recipes/versions/compare — compare one version with the CURRENT one (build spec §6.6).
 *
 * Compare is per row, against the current version; comparing two old versions is deferred. It reuses the pure
 * three-way `computeConflictDiff` with the version as both the base and "mine" and the current version as "theirs"
 * (blueprint Part C, slice 6): then "mine" never changed, so every row the diff reports is a change the CURRENT version
 * made, its `base` is what the version said and its `theirs` what the recipe says now. The diff's own rules for what
 * counts as a changed step or ingredient therefore hold here too, and there is no new server API.
 *
 * ⛔ The two-version selection this replaced (`compareViewState`, `buildCompareFieldRows` over `diffSnapshots`) is
 * deleted, not kept beside it: one compare, one diff.
 */
import type { Locale } from '@commise/i18n';
import type { RecipeVersion } from '@kitchensink/recipe-core';

import type { IngredientLineNameMessages } from '../messages.js';
import { computeConflictDiff, type ConflictDiff } from './conflictDiff.js';
import { conflictRowLabel } from './diffLabels.js';
import type { RecipeConflictMessages } from './messages.js';

/** Props for the `VersionCompareView` leaves (web panel, native sheet). */
export interface VersionCompareViewProps {
    /** Whether the panel (web) / sheet (native) is open. */
    readonly open: boolean;
    /** The version compared with the current one. */
    readonly version?: RecipeVersion;
    /** {@link compareWithCurrent} for it, computed by the caller. */
    readonly diff?: ConflictDiff;
    /** Close the panel: the close control, Escape (web) and the overlay all resolve to this one callback. */
    readonly onClose: () => void;
}

/**
 * The differences between a version and the current one. Pure.
 *
 * @param version - The version to compare.
 * @param current - The current version.
 * @param locale - The active locale, for ingredient amounts.
 * @param lineNames - The stand-ins for a line with no name.
 * @returns The changed rows, each a change the current version made.
 */
export const compareWithCurrent = (
    version: RecipeVersion,
    current: RecipeVersion,
    locale: Locale,
    lineNames: IngredientLineNameMessages,
): ConflictDiff => computeConflictDiff(version.snapshot, version.snapshot, current.snapshot, locale, lineNames);

/** One row of the compare panel. */
export interface CompareRow {
    readonly key: string;
    /** The localized field or element label ("Title", "Step 2", "Ingredient: …"). */
    readonly label: string;
    /** What the version said; empty when the element did not exist in it. */
    readonly was: string;
    /** What the recipe says now; empty when the current version removed it. */
    readonly now: string;
}

/**
 * The panel's rows for a {@link compareWithCurrent} diff. Pure.
 *
 * @param diff - The diff.
 * @param messages - The shared conflict-panel copy, which owns the field labels.
 * @returns The rows, in the diff's order.
 */
export const compareRowsOf = (diff: ConflictDiff, messages: RecipeConflictMessages): readonly CompareRow[] =>
    diff.rows.map((row) => ({
        key: row.key,
        label: conflictRowLabel(row, messages),
        was: row.base ?? '',
        now: row.theirs,
    }));
