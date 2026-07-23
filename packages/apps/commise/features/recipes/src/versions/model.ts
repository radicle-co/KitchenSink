/**
 * @module @commise/features-recipes — recipe version-surface model layer.
 *
 * Pure, platform-agnostic types + helpers shared by the web (`*.tsx`) and native (`*.native.tsx`) leaves
 * of the version-history (T069) and concurrent-edit conflict (T070) building blocks, so the two renders
 * can never drift on ordering, shape, or formatting. No React, no platform APIs.
 */
import type { Locale } from '@commise/i18n';
import type { RecipeDetail, RecipeVersion } from '@kitchensink/recipe-core';

import type { RecipeFormValues } from '../form/model.js';
import { fillTemplate, formatDurationMinutes, formatRecipeCount } from '../list/model.js';
import type { RecipeConflictMessages } from './messages.js';

/**
 * Props for the recipe version-history list (T069) — a controlled, presentational component. It lists a
 * recipe's versions (newest first) and delegates every interaction upward; it fetches nothing (the
 * composing app wires `useRecipeVersions` + `useRestoreRecipeVersion` to these props).
 */
/**
 * Which honest error a failed restore surfaces (localized copy lives in the list, keyed by this discriminant —
 * the B20/B15 code pattern, so the composing container never reaches into the block's message dictionary).
 * - `conflict` — the recipe changed underneath (409 {@link VersionConflictError}); the container refetches the
 *   history + current version and the copy tells the viewer to review the refreshed list and retry.
 * - `generic` — any other failed restore write.
 */
export type RecipeVersionRestoreError = 'conflict' | 'generic';

export interface RecipeVersionListProps {
    /** The recipe's versions, in any order (the view sorts newest-first). */
    readonly versions: readonly RecipeVersion[];
    /** The recipe's current version number — marked, and not restorable. */
    readonly currentVersion: number;
    /** The version currently being restored (its row shows a busy state); `null`/absent when idle. */
    readonly restoringVersion?: number | null;
    /** An honest error from the last restore attempt to surface, or ABSENT for none (B17). */
    readonly restoreError?: RecipeVersionRestoreError;
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
    /** The user's in-progress draft, as the editable form shape — the "mine" side of the field-by-field merge. */
    readonly mineValues: RecipeFormValues;
    /** The latest saved recipe projected to the editable form shape — the "theirs" side of the merge. */
    readonly theirsValues: RecipeFormValues;
    /** Invoked when the user chooses to keep their own version. */
    readonly onKeepMine: () => void;
    /** Invoked when the user chooses to take the latest saved version. */
    readonly onUseTheirs: () => void;
    /** Invoked with the field-by-field merged draft when the user saves a merge (FR-007c option c). */
    readonly onMerge: (merged: RecipeFormValues) => void;
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

// ─── Field-by-field merge (T070 / FR-007c option c) ─────────────────────────────────────────────────
//
// A concurrent-edit conflict must let the user MERGE — compose the resubmitted draft field-by-field, taking
// each editable field from either their own in-progress draft ("mine") or the latest saved recipe ("theirs").
// This is a genuine merge (keep my new title AND the other device's added ingredient), distinct from the
// keep-mine / use-theirs whole-record choices, and it is what FR-007c's "MUST NOT last-write-wins" forbids
// resolving any other way. Granularity is PER TOP-LEVEL FIELD (not per array element): FR-007c says
// "field-by-field", and a full element-level array diff is a separate, larger tool the requirement does not
// call for. Every field's resolution is the user's EXPLICIT choice — nothing is auto-combined.

/** Which side of the conflict a merged field is taken from. */
export type MergeSide = 'mine' | 'theirs';

/** One editable field presented in the merge panel — its label plus each side's pre-formatted value. */
export interface RecipeMergeField {
    /** The `RecipeFormValues` key this field resolves (also the radio-group `name`). */
    readonly key: string;
    /** The localized field label. */
    readonly label: string;
    /** The user's draft value, formatted for display. */
    readonly mineValue: string;
    /** The latest saved value, formatted for display. */
    readonly theirsValue: string;
}

/** Per-field resolution: for each editable field key, the side the user chose. */
export type RecipeMergeSelections = Readonly<Record<string, MergeSide>>;

/** How one editable field is labelled and formatted in the merge panel. */
interface MergeFieldDescriptor {
    readonly label: (messages: RecipeConflictMessages) => string;
    readonly format: (value: unknown, messages: RecipeConflictMessages, locale: Locale) => string;
}

/** Format a free-text field, falling back to the localized empty marker for a blank/absent value. Pure. */
const formatText = (value: unknown, messages: RecipeConflictMessages): string =>
    typeof value === 'string' && value.trim() !== '' ? value : messages.emptyValue;

/** Format a numeric field. Pure. */
const formatNumber = (value: unknown): string => String(typeof value === 'number' ? value : 0);

/** Format a minutes field via the shared duration template. Pure. */
const formatDuration = (value: unknown, messages: RecipeConflictMessages): string =>
    formatDurationMinutes(typeof value === 'number' ? value : 0, messages.minutes);

/** Format a string-list field (tags / dietary flags), falling back to the empty marker when none. Pure. */
const formatList = (value: unknown, messages: RecipeConflictMessages): string =>
    Array.isArray(value) && value.length > 0 ? value.map(String).join(', ') : messages.emptyValue;

/** Count the elements of an array-valued field (0 for a non-array). Pure. */
const arrayLength = (value: unknown): number => (Array.isArray(value) ? value.length : 0);

/**
 * The known editable fields, in display order, each with its localized label + value formatter. Iteration
 * order here drives the panel's field order. This is NOT a gate on which fields are shown — a field present
 * on the draft but absent here is still rendered (see {@link mergeFieldKeys} + {@link fallbackDescriptor}),
 * so a newly-added form field is never silently dropped from the merge; it only lacks a curated label until
 * one is added.
 */
const MERGE_FIELD_DESCRIPTORS: Readonly<Record<string, MergeFieldDescriptor>> = {
    title: { label: (m) => m.titleLabel, format: formatText },
    description: { label: (m) => m.descriptionLabel, format: formatText },
    cuisine: { label: (m) => m.cuisineLabel, format: formatText },
    servings: { label: (m) => m.servingsLabel, format: formatNumber },
    prepTimeMinutes: { label: (m) => m.prepLabel, format: formatDuration },
    cookTimeMinutes: { label: (m) => m.cookLabel, format: formatDuration },
    visibility: {
        label: (m) => m.visibilityLabel,
        format: (value, m) => (value === 'public' ? m.visibilityPublic : m.visibilityPrivate),
    },
    tags: { label: (m) => m.tagsLabel, format: formatList },
    dietaryFlags: { label: (m) => m.dietaryFlagsLabel, format: formatList },
    ingredients: {
        label: (m) => m.ingredientsLabel,
        format: (value, m, locale) =>
            formatRecipeCount(arrayLength(value), { one: m.ingredientCountOne, other: m.ingredientCountOther }, locale),
    },
    steps: {
        label: (m) => m.stepsLabel,
        format: (value, m, locale) =>
            formatRecipeCount(arrayLength(value), { one: m.stepCountOne, other: m.stepCountOther }, locale),
    },
};

/**
 * Descriptor for a field with no curated entry (a form field added after this module) — graceful
 * degradation so the field still appears and is choosable. The label is the raw key (a follow-up adds a
 * localized label + formatter); the value is a best-effort string. Pure.
 */
const fallbackDescriptor = (key: string): MergeFieldDescriptor => ({
    label: () => key,
    format: (value, messages) =>
        Array.isArray(value) ? formatList(value, messages) : formatText(String(value), messages),
});

/**
 * The keys to render in the merge panel, DERIVED from the draft's own shape: the known fields first (in
 * display order), then any additional keys present on the draft. Driving the set from the data — not a hard
 * enumeration — means a field added to {@link RecipeFormValues} later (e.g. `difficulty`) is included
 * automatically rather than silently omitted. Pure.
 *
 * @param values - The draft whose keys define the mergeable field set.
 * @returns The ordered field keys.
 */
const mergeFieldKeys = (values: RecipeFormValues): readonly string[] => {
    const present = Object.keys(values);
    const known = Object.keys(MERGE_FIELD_DESCRIPTORS).filter((key) => present.includes(key));
    const extra = present.filter((key) => !(key in MERGE_FIELD_DESCRIPTORS));

    return [...known, ...extra];
};

/**
 * Project the user's draft ("mine") and the latest saved recipe ("theirs") into the ordered, labelled,
 * pre-formatted per-field choices the merge panel renders. EVERY editable field is returned (not only the
 * ones that differ) so no conflicting field can be hidden and silently resolved to one side. Pure.
 *
 * @param mine - The user's in-progress draft.
 * @param theirs - The latest saved recipe projected to the editable form shape.
 * @param messages - The localized conflict copy (labels + templates).
 * @param locale - The active BCP-47 locale (for count pluralization).
 * @returns The ordered merge fields.
 */
export const buildRecipeMergeFields = (
    mine: RecipeFormValues,
    theirs: RecipeFormValues,
    messages: RecipeConflictMessages,
    locale: Locale,
): readonly RecipeMergeField[] => {
    const mineRecord = mine as unknown as Readonly<Record<string, unknown>>;
    const theirsRecord = theirs as unknown as Readonly<Record<string, unknown>>;

    return mergeFieldKeys(mine).map((key) => {
        const descriptor = MERGE_FIELD_DESCRIPTORS[key] ?? fallbackDescriptor(key);

        return {
            key,
            label: descriptor.label(messages),
            mineValue: descriptor.format(mineRecord[key], messages, locale),
            theirsValue: descriptor.format(theirsRecord[key], messages, locale),
        };
    });
};

/**
 * The default per-field resolution: every field starts on the user's own draft ("mine"). A clearly-labelled
 * default (never a silent combine) — the user then flips individual fields to "theirs" to pull the latest
 * saved value in. Pure.
 *
 * @param fields - The merge fields to seed selections for.
 * @returns Selections mapping every field key to `'mine'`.
 */
export const defaultMergeSelections = (fields: readonly RecipeMergeField[]): RecipeMergeSelections =>
    Object.fromEntries(fields.map((field): [string, MergeSide] => [field.key, 'mine']));

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

/** Re-export of the shared template filler for the version leaves (kept in one place — the list model). */
export { fillTemplate };
