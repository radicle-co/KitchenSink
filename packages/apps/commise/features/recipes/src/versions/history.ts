/**
 * @module @commise/features-recipes/versions — The version-HISTORY list's model: ordering, the prior-version lookup, and each row's change summary.
 *
 * Pure and platform-agnostic: shared unchanged by the web (`*.tsx`) and native (`*.native.tsx`) leaves, so
 * the two renders can never drift. No React, no platform APIs.
 */
import type { RecipeVersion } from '@kitchensink/recipe-core';
import { fillTemplate } from '../list/model.js';
import { diffSnapshots, type SnapshotFieldKey } from './diff.js';
import type { RecipeConflictMessages, RecipeVersionListMessages } from './messages.js';
import { snapshotFieldLabel } from './diffLabels.js';

/**
 * Props for the recipe version-history list (T069) — a controlled, presentational component. It lists a
 * recipe's versions (newest first) and delegates every interaction upward; it fetches nothing (the
 * composing app wires `useRecipeVersions` + `useRestoreRecipeVersion` to these props).
 */
/**
 * Which honest error a failed restore surfaces (localized copy lives in the list, keyed by this discriminant —
 * the B20/B15 code pattern, so the composing container never reaches into the block's message dictionary).
 * - `conflict` — the recipe changed underneath (409 `VersionConflictError`); the container refetches the
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
    /** The version numbers currently picked for the two-version compare (W6 Task 5), in the composing
     *  container's own selection state — 0, 1, or 2 entries. Read-only here; the container owns the
     *  selection (see {@link onToggleCompare}). ABSENT (together with `onToggleCompare`) → no Compare
     *  affordance is rendered for any row, mirroring `onPreview`'s "no prop, no dead control" contract. */
    readonly selectedForCompare?: readonly number[];
    /** Invoked with a version number when its Compare checkbox is toggled (selected when unchecked,
     *  deselected when checked). Capped at two selections by the CALLER: once `selectedForCompare` already
     *  has two entries, every row NOT already selected renders its checkbox disabled instead of silently
     *  evicting the oldest pick — an explicit "deselect one first" UX beats a selection changing out from
     *  under the viewer (W6 Task 5). ABSENT (together with `selectedForCompare`) → no Compare affordance is
     *  rendered for any row. */
    readonly onToggleCompare?: (versionNumber: number) => void;
    /** Invoked when the "Back to Recipe" affordance is activated (V6). Rendered ONLY by the web leaf —
     *  native screens (`RecipeVersionsScreen`) already compose their own back chrome outside this shared
     *  component, so the native leaf intentionally does not read this prop. */
    readonly onBack?: () => void;
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
        .reduce<RecipeVersion | undefined>(
            (latest, candidate) => (laterThanLatest(latest, candidate) ? candidate : latest),
            undefined,
        );
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
 * Render a row's changed fields as a localized, comma-joined list of field names (e.g. "Title, Steps"),
 * preserving {@link SnapshotFieldKey}'s declared order. Pure.
 *
 * @param fields - The changed field keys (e.g. `SnapshotDiff.changedFields`).
 * @param messages - The shared conflict-panel field labels (reused — see {@link snapshotFieldLabel}).
 * @returns The localized, comma-joined field-name list.
 */
export const formatChangedFieldNames = (
    fields: readonly SnapshotFieldKey[],
    messages: RecipeConflictMessages,
): string => fields.map((field) => snapshotFieldLabel(field, messages)).join(', ');

// ─── Row-level editor/device attribution (W6 Task 2) ────────────────────────────────────────────────

/**
 * Render a version row's editor attribution line — `by @{handle}`. `undefined` when `editorHandle` is
 * ABSENT (a pre-feature version, or one whose editor could not be resolved) — the caller renders no
 * attribution line at all, never `by @undefined`. `editorHandle` is untrusted free text: this returns a
 * plain string for the caller to render as TEXT (React escapes it) — NEVER via `dangerouslySetInnerHTML`.
 * Pure.
 *
 * ⚠️ This took a device label and appended a ` (from {device})` suffix until the owner ruling of
 * **2026-08-26** deleted device attribution outright. The suffix branch is gone, not disabled — do not
 * reintroduce a device parameter here (see the `recipeVersions` table docstring in `recipe-service`).
 *
 * @param editorHandle - The version's editor handle, if known.
 * @param messages - The localized attribution templates.
 * @returns The formatted attribution line, or `undefined` when there is nothing to attribute.
 */
export const formatVersionAttribution = (
    editorHandle: string | undefined,
    messages: RecipeVersionListMessages,
): string | undefined =>
    editorHandle === undefined ? undefined : fillTemplate(messages.byEditor, { handle: editorHandle });
