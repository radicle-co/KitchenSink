/**
 * @module @commise/features-recipes — recipe version-surface model layer.
 *
 * Pure, platform-agnostic types + helpers shared by the web (`*.tsx`) and native (`*.native.tsx`) leaves
 * of the version-history (T069) and concurrent-edit conflict (T070) building blocks, so the two renders
 * can never drift on ordering, shape, or formatting. No React, no platform APIs.
 */
import type { Locale } from '@commise/i18n';
import type { RecipeDetail, RecipeVersion } from '@kitchensink/recipe-core';

import { fillTemplate, formatDurationMinutes, formatRecipeCount } from '../list/model.js';
import type { RecipeConflictMessages } from './messages.js';

/**
 * Props for the recipe version-history list (T069) — a controlled, presentational component. It lists a
 * recipe's versions (newest first) and delegates every interaction upward; it fetches nothing (the
 * composing app wires `useRecipeVersions` + `useRestoreRecipeVersion` to these props).
 */
export interface RecipeVersionListProps {
    /** The recipe's versions, in any order (the view sorts newest-first). */
    readonly versions: readonly RecipeVersion[];
    /** The recipe's current version number — marked, and not restorable. */
    readonly currentVersion: number;
    /** The version currently being restored (its row shows a busy state); `null`/absent when idle. */
    readonly restoringVersion?: number | null;
    /** Invoked with the version number when a restore action is activated. */
    readonly onRestore: (versionNumber: number) => void;
}

/**
 * Props for the concurrent-edit conflict view (T070 / C-005) — a controlled, presentational component. It
 * presents the user's in-progress version and the latest saved version side-by-side and delegates the
 * resolution choice upward.
 */
export interface RecipeConflictViewProps {
    /** The title of the user's in-progress edit (may differ from `mine.title`). */
    readonly mineTitle: string;
    /** The latest saved version that landed while the user was editing. */
    readonly theirs: RecipeDetail;
    /** The user's in-progress version. */
    readonly mine: RecipeDetail;
    /** Invoked when the user chooses to keep their own version. */
    readonly onKeepMine: () => void;
    /** Invoked when the user chooses to take the latest saved version. */
    readonly onUseTheirs: () => void;
}

/**
 * Order a recipe's versions newest-first (descending `versionNumber`). Returns a NEW array — the input is
 * never mutated. Pure.
 *
 * @param versions - The versions in any order.
 * @returns A new array sorted by descending version number.
 */
export const sortVersionsDescending = (versions: readonly RecipeVersion[]): readonly RecipeVersion[] =>
    [...versions].sort((a, b) => b.versionNumber - a.versionNumber);

/**
 * Format a version's ISO 8601 timestamp for display in the active locale. Formatted in UTC so the output
 * is deterministic regardless of the runtime's timezone (a version's `createdAt` is an absolute instant,
 * not a local wall-clock time). Pure.
 *
 * @param isoDateTime - The ISO 8601 timestamp (with offset).
 * @param locale - The active BCP-47 locale.
 * @returns The localized date-time string.
 */
export const formatVersionTimestamp = (isoDateTime: string, locale: Locale): string =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(
        new Date(isoDateTime),
    );

/** One labelled field rendered for a side of the conflict view. */
export interface ConflictField {
    /** Stable key for React reconciliation and test lookup. */
    readonly key: string;
    /** The localized field label. */
    readonly label: string;
    /** The formatted field value. */
    readonly value: string;
}

/**
 * Project one side of a conflict (a title plus a {@link RecipeDetail}) into the ordered, labelled,
 * pre-formatted fields both platforms render — title, servings, prep/cook/total times, and the ingredient
 * and step counts. Centralizing this here keeps the web and native views from drifting on which fields
 * differ or how they are formatted. Pure.
 *
 * @param title - The title to show for this side (the caller's own draft title, or `theirs.title`).
 * @param detail - The recipe detail for this side.
 * @param messages - The localized conflict copy (labels + templates).
 * @param locale - The active BCP-47 locale (for locale-correct count pluralization).
 * @returns The ordered fields to render for this side.
 */
export const toConflictSideFields = (
    title: string,
    detail: RecipeDetail,
    messages: RecipeConflictMessages,
    locale: Locale,
): readonly ConflictField[] => [
    { key: 'title', label: messages.titleLabel, value: title },
    { key: 'servings', label: messages.servingsLabel, value: String(detail.servings) },
    { key: 'prep', label: messages.prepLabel, value: formatDurationMinutes(detail.prepTimeMinutes, messages.minutes) },
    { key: 'cook', label: messages.cookLabel, value: formatDurationMinutes(detail.cookTimeMinutes, messages.minutes) },
    {
        key: 'total',
        label: messages.totalLabel,
        value: formatDurationMinutes(detail.totalTimeMinutes, messages.minutes),
    },
    {
        key: 'ingredients',
        label: messages.ingredientsLabel,
        value: formatRecipeCount(
            detail.ingredients.length,
            { one: messages.ingredientCountOne, other: messages.ingredientCountOther },
            locale,
        ),
    },
    {
        key: 'steps',
        label: messages.stepsLabel,
        value: formatRecipeCount(
            detail.steps.length,
            { one: messages.stepCountOne, other: messages.stepCountOther },
            locale,
        ),
    },
];

/** Re-export of the shared template filler for the version leaves (kept in one place — the list model). */
export { fillTemplate };
