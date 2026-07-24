/**
 * @module @commise/features-recipes — recipe version-surface model layer.
 *
 * Pure, platform-agnostic types + helpers shared by the web (`*.tsx`) and native (`*.native.tsx`) leaves
 * of the version-history (T069) and concurrent-edit conflict (T070) building blocks, so the two renders
 * can never drift on ordering, shape, or formatting. No React, no platform APIs.
 */
import type { Locale } from '@commise/i18n';
import type { RecipeDetail, RecipeIngredient, RecipeVersion } from '@kitchensink/recipe-core';

import { formatCalories } from '../card/model.js';
import { formatQuantity } from '../detail/model.js';
import type { RecipeFormValues } from '../form/model.js';
import { fillTemplate, formatDurationMinutes, formatRecipeCount } from '../list/model.js';
import { diffSnapshots, type SnapshotDiff, type SnapshotFieldKey } from './diff.js';
import type { RecipeConflictMessages, RecipeVersionListMessages, RecipeVersionPreviewMessages } from './messages.js';

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
    /** Invoked with the version number when a row's Preview action is activated (W6 Task 3 hook — the
     *  preview modal itself lands separately). ABSENT → no Preview affordance is rendered for any row; a
     *  caller not yet wired to the preview flow simply omits this prop rather than showing a dead control. */
    readonly onPreview?: (versionNumber: number) => void;
    /** Invoked when the "Back to Recipe" affordance is activated (V6). Rendered ONLY by the web leaf —
     *  native screens (`RecipeVersionsScreen`) already compose their own back chrome outside this shared
     *  component, so the native leaf intentionally does not read this prop. */
    readonly onBack?: () => void;
}

/**
 * Props for the concurrent-edit conflict view (T070 / C-005 / CP-6 P1) — a FULLY controlled, presentational
 * component. It presents the user's in-progress version and the latest saved version side-by-side and
 * delegates every choice upward, including the field-by-field merge panel's own selection state: `selections`
 * comes in from the caller (the `useRecipeEditor` machine's `conflict.mergeSelections`) and every toggle
 * reports back via `onSelectionsChange` — this view owns no merge data of its own (only the "is the merge
 * panel showing" UI toggle stays local, since that is pure navigation, not data the machine needs).
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
    /** The current per-field merge resolution (an absent key defaults to `'mine'`); owned by the caller. */
    readonly selections: RecipeMergeSelections;
    /** Invoked with the next selections on every per-field radio toggle, and to reset on merge-panel exit. */
    readonly onSelectionsChange: (selections: RecipeMergeSelections) => void;
    /** Invoked when the user chooses to keep their own version. */
    readonly onKeepMine: () => void;
    /** Invoked when the user chooses to take the latest saved version. */
    readonly onUseTheirs: () => void;
    /** Invoked with the current per-field selections when the user saves a merge (FR-007c option c); the
     *  caller composes the merged draft (`composeMergedRecipe`) and submits it. */
    readonly onMerge: (selections: RecipeMergeSelections) => void;
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

// ─── Row-level changed-fields summary (W6 Task 2) ───────────────────────────────────────────────────
//
// Each version row (except the earliest) shows a computed "Changed: {fields}" summary — the diff of that
// version against its immediately-PRIOR sibling, via `diffSnapshots` (W6 Task 1). "Immediately prior" is
// located by SORTED versionNumber order within the given `versions` set, not `versionNumber - 1`
// arithmetic, so it degrades gracefully if the caller's list ever has gaps (e.g. an archived version).

/**
 * Find the version immediately prior to `versionNumber` within `versions` — the member with the greatest
 * `versionNumber` strictly less than it. `undefined` when no such member exists (the earliest version in
 * the set — nothing to diff against). Pure; does not mutate `versions`.
 *
 * @param versions - The candidate versions (any order).
 * @param versionNumber - The version number to find the immediate predecessor of.
 * @returns The immediately-prior version, or `undefined`.
 */
export const findPriorVersion = (
    versions: readonly RecipeVersion[],
    versionNumber: number,
): RecipeVersion | undefined => {
    const laterThanLatest = (latest: RecipeVersion | undefined, candidate: RecipeVersion): boolean =>
        latest === undefined || candidate.versionNumber > latest.versionNumber;

    return versions
        .filter((version) => version.versionNumber < versionNumber)
        .reduce<
            RecipeVersion | undefined
        >((latest, candidate) => (laterThanLatest(latest, candidate) ? candidate : latest), undefined);
};

/** One version row's changed-fields summary relative to its immediately-prior version. */
export interface VersionRowChangeSummary {
    /** Whether a prior version exists in the given set (`false` for the earliest version — nothing to diff). */
    readonly hasPrior: boolean;
    /** The changed {@link SnapshotFieldKey}s versus the prior version, in declared order; empty when there
     *  is no prior version, or when the two snapshots do not differ. */
    readonly changedFields: readonly SnapshotFieldKey[];
}

/**
 * Compute one version row's changed-fields summary: {@link diffSnapshots} between this version's snapshot
 * and its immediately-prior sibling's ({@link findPriorVersion}) within `versions`. Pure.
 *
 * @param versions - The full candidate set to locate `version`'s prior sibling within.
 * @param version - The version to summarize.
 * @returns Whether a prior version exists, and the changed fields versus it.
 */
export const changeSummaryForVersion = (
    versions: readonly RecipeVersion[],
    version: RecipeVersion,
): VersionRowChangeSummary => {
    const prior = findPriorVersion(versions, version.versionNumber);

    return prior === undefined
        ? { hasPrior: false, changedFields: [] }
        : { hasPrior: true, changedFields: diffSnapshots(prior.snapshot, version.snapshot).changedFields };
};

/**
 * Which localized field-label key (from the SHARED {@link RecipeConflictMessages} field labels — the same
 * human-readable names the field-by-field merge panel shows, reused here rather than duplicated: the field
 * name is the same piece of knowledge regardless of which surface displays it) names each
 * {@link SnapshotFieldKey}.
 */
const SNAPSHOT_FIELD_LABEL_KEY: Readonly<Record<SnapshotFieldKey, keyof RecipeConflictMessages>> = {
    title: 'titleLabel',
    description: 'descriptionLabel',
    servings: 'servingsLabel',
    prepTimeMinutes: 'prepLabel',
    cookTimeMinutes: 'cookLabel',
    steps: 'stepsLabel',
    ingredients: 'ingredientsLabel',
};

/**
 * Render a row's changed fields as a localized, comma-joined list of field names (e.g. "Title, Steps"),
 * preserving {@link SnapshotFieldKey}'s declared order. Pure.
 *
 * @param fields - The changed field keys (e.g. `SnapshotDiff.changedFields`).
 * @param messages - The shared conflict-panel field labels (reused — see {@link SNAPSHOT_FIELD_LABEL_KEY}).
 * @returns The localized, comma-joined field-name list.
 */
export const formatChangedFieldNames = (
    fields: readonly SnapshotFieldKey[],
    messages: RecipeConflictMessages,
): string => fields.map((field) => messages[SNAPSHOT_FIELD_LABEL_KEY[field]]).join(', ');

// ─── Row-level editor/device attribution (W6 Task 2) ────────────────────────────────────────────────

/**
 * Render a version row's editor/device attribution line — `by @{handle}`, with a device suffix appended
 * when a device is also known. `undefined` when `editorHandle` is ABSENT (a pre-feature version, or one
 * whose editor could not be resolved) — the caller renders no attribution line at all, never
 * `by @undefined`. `deviceLabel` is untrusted free text: this returns a plain string for the caller to
 * render as TEXT (React escapes it) — NEVER via `dangerouslySetInnerHTML`. Pure.
 *
 * @param editorHandle - The version's editor handle, if known.
 * @param deviceLabel - The version's device label, if known.
 * @param messages - The localized attribution templates.
 * @returns The formatted attribution line, or `undefined` when there is nothing to attribute.
 */
export const formatVersionAttribution = (
    editorHandle: string | undefined,
    deviceLabel: string | undefined,
    messages: RecipeVersionListMessages,
): string | undefined => {
    if (editorHandle === undefined) {
        return undefined;
    }

    const byEditor = fillTemplate(messages.byEditor, { handle: editorHandle });

    return deviceLabel === undefined ? byEditor : byEditor + fillTemplate(messages.fromDevice, { device: deviceLabel });
};

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

// A NAMED `defaultMergeSelections` helper (materializing every known field key to `'mine'`) was deliberately
// NOT reintroduced here (CP-6/P1). Both live readers of a per-field selection already treat an ABSENT key as
// `'mine'` — `composeMergedRecipe` below (`selections[key] === 'theirs' ? theirs : mine`) and the conflict
// view's `sideOf` (`selections[key] ?? 'mine'`) — so seeding the `useRecipeEditor` machine's
// `conflict.mergeSelections` with `{}` on conflict entry is BEHAVIORALLY IDENTICAL to seeding it with a
// materialized default record. A `defaultMergeSelections(fields: RecipeMergeField[])` also could not be
// called from the platform-agnostic hook anyway — `RecipeMergeField[]` is a LOCALIZED projection
// (`buildRecipeMergeFields` needs `messages`/`locale`), which the hook does not have. The prior version of
// this module exported such a helper with zero production callers (confirmed before this change); keeping
// an unconsumed third statement of "mine is the default" alongside the two above would be a DRY liability,
// not a DRY win, so it — and its dedicated test — were removed rather than force-fed a caller.

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
    /** The previewed version (its full snapshot). ABSENT while loading or on error. */
    readonly version?: RecipeVersion;
    /** Whether the version fetch is in flight. */
    readonly isLoading: boolean;
    /** Whether the version fetch failed. NOT a dead end — Keep-current/Cancel still closes the modal, so
     *  the composing container can retry. */
    readonly error?: boolean;
    /** This version's diff vs. the recipe's CURRENT version, for the "Changed from current" line. ABSENT
     *  while loading/erroring, alongside `version`. */
    readonly diffFromCurrent?: SnapshotDiff;
    /** Invoked to close the modal without restoring — "Keep current version", Cancel, Escape, or the
     *  backdrop click all resolve to this ONE callback (mirrors `PullUpdatesDialog`'s single exit path). */
    readonly onCancel: () => void;
    /** Invoked with the previewed version's number when "Restore this version" is activated. */
    readonly onRestore: (versionNumber: number) => void;
    /** The active BCP-47 locale (calorie-formatting input only; this component owns no locale state). */
    readonly locale: Locale;
}

/** One ingredient line rendered by the preview modal — pre-formatted text plus its calorie chip, WHEN the
 *  snapshot ingredient carries one (see {@link toVersionPreviewIngredientLines}). */
export interface VersionPreviewIngredientLine {
    /** Stable key for React reconciliation — the snapshot row's own (frozen) id. */
    readonly key: string;
    /** The formatted "{quantity}{unit} {name}" text, with any `displayText` override appended. */
    readonly text: string;
    /** The formatted "{calories} cal" chip. OMITTED (never fabricated) when the ingredient carries no
     *  `userCalories` override — a catalog-resolved line's per-serving calories are not captured in a
     *  `RecipeSnapshot` at all (see `diff.ts` module docs). */
    readonly calories?: string;
}

/**
 * Project a version snapshot's ingredient lines into the pre-formatted rows the preview modal renders.
 * Reuses {@link formatQuantity} (the detail view's own quantity/unit formatter) and {@link formatCalories}
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
    ingredients.map((ingredient) => {
        const name =
            ingredient.displayText !== undefined
                ? `${ingredient.ingredientName} (${ingredient.displayText})`
                : ingredient.ingredientName;

        return {
            key: ingredient.id,
            text: `${formatQuantity(ingredient.quantity, ingredient.unit)} ${name}`,
            ...(ingredient.userCalories !== undefined
                ? {
                      calories: fillTemplate(messages.caloriesLabel, {
                          calories: formatCalories(ingredient.userCalories, locale),
                      }),
                  }
                : {}),
        };
    });

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
