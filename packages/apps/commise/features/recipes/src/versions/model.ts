/**
 * @module @commise/features-recipes — recipe version-surface model layer.
 *
 * Pure, platform-agnostic types + helpers shared by the web (`*.tsx`) and native (`*.native.tsx`) leaves
 * of the version-history (T069) and concurrent-edit conflict (T070) building blocks, so the two renders
 * can never drift on ordering, shape, or formatting. No React, no platform APIs.
 */
import type { Locale } from '@commise/i18n';
import type {
    RecipeDetail,
    RecipeIngredient,
    RecipeIngredientView,
    RecipeSnapshot,
    RecipeStep,
    RecipeStepView,
    RecipeVersion,
    VersionConflictSide,
} from '@kitchensink/recipe-core';

import { formatCalories } from '../card/model.js';
import { formatQuantity } from '../detail/model.js';
import {
    computeTotalTime,
    type RecipeFormIngredient,
    type RecipeFormStep,
    type RecipeFormValues,
} from '../form/model.js';
import { fillTemplate, formatDurationMinutes, formatRecipeCount } from '../list/model.js';
import type { ConflictDiff, ConflictFieldKind, ConflictFieldRow, ConflictMarker } from './conflictDiff.js';
import { diffSnapshots, type DiffTally, type SnapshotDiff, type SnapshotFieldKey } from './diff.js';
import type {
    RecipeConflictMessages,
    RecipeVersionCompareMessages,
    RecipeVersionListMessages,
    RecipeVersionPreviewMessages,
} from './messages.js';

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
 * Props for the concurrent-edit conflict view (T070 / C-005 / CP-6 P1 / W7) — a FULLY controlled,
 * presentational component. Server-first ordering (X7): `server` is always the FIRST/LEFT side, everywhere
 * this view renders anything two-sided — the per-side banner, and (Option C) the field-by-field merge panel.
 * It delegates every choice upward, including the field-by-field merge panel's own selection state:
 * `selections` comes in from the caller (the `useRecipeEditor` machine's `conflict.mergeSelections`) and every
 * toggle reports back via `onSelectionsChange` — this view owns no merge data of its own (only the "is the
 * merge panel showing" UI toggle stays local, since that is pure navigation, not data the machine needs).
 *
 * `mine`/`theirs` `RecipeDetail` display sides and the `mineTitle` override (the pre-W7 contract) are GONE:
 * the W7 body (`VersionConflictSide`) already carries everything the banner needs (`server`/`base`), and the
 * changed-only `diff` (W7 Task 1) is what the changed-fields panel below the cards renders — a `RecipeDetail`
 * projection of either side is no longer needed for THIS view (the Task 4 diff panel and Task 5 per-element
 * merge both read `diff.rows` instead).
 */
export interface RecipeConflictViewProps {
    /** The 409's winning server side (version/device/updatedAt/snapshot, W8-a.5) — the view's LEFT/FIRST side
     *  everywhere (X7). Drives the per-side banner (X3). */
    readonly server: VersionConflictSide;
    /** The version the draft was edited from, when still retained in the DB window; ABSENT when evicted (the
     *  base-evicted fallback — see `conflictDiff.ts`). Carried through for the changed-fields panel/staleness
     *  warning; this view does not read it directly. */
    readonly base?: VersionConflictSide;
    /** The precomputed 3-way diff (`computeConflictDiff`, W7 Task 1) — changed-or-conflicting rows only.
     *  Rendered as the changed-only diff panel below the three options, with a per-row marker + legend
     *  (W7 Task 4 / X1). */
    readonly diff: ConflictDiff;
    /** `server.versionNumber - (base?.versionNumber ?? 0)` (the X6 staleness signal) — carried through for
     *  W7 Task 5's staleness warning; this view does not render it yet. */
    readonly versionsBehind: number;
    /** The user's in-progress draft, as the editable form shape — the "mine" side of the field-by-field merge
     *  (Option C). */
    readonly mineValues: RecipeFormValues;
    /** The latest saved recipe projected to the editable form shape — the "server" side of the merge. */
    readonly theirsValues: RecipeFormValues;
    /** The current per-field merge resolution (an absent key defaults to `'mine'`); owned by the caller. */
    readonly selections: RecipeMergeSelections;
    /** Invoked with the next selections on every per-field radio toggle, and to reset on merge-panel exit. */
    readonly onSelectionsChange: (selections: RecipeMergeSelections) => void;
    /** Option A: keep the server version, discarding the user's local changes. */
    readonly onKeepServer: () => void;
    /** Option B: overwrite the server version with the user's own draft. */
    readonly onOverwrite: () => void;
    /** Option C submit: invoked with the current per-field selections when the user saves a merge (FR-007c
     *  option c); the caller composes the merged draft (`composeConflictMerge`) and submits it. */
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
 * The localized field label (from the SHARED {@link RecipeConflictMessages} field labels — see
 * {@link SNAPSHOT_FIELD_LABEL_KEY}) for one {@link SnapshotFieldKey}. Exported so every version surface that
 * names a diffed field (the row-level summary, the preview modal, and the W6 Task 4 compare view) resolves
 * the SAME label rather than re-deriving it. Pure.
 *
 * @param field - The diffed field key.
 * @param messages - The shared conflict-panel field labels.
 * @returns The localized field label.
 */
export const snapshotFieldLabel = (field: SnapshotFieldKey, messages: RecipeConflictMessages): string =>
    messages[SNAPSHOT_FIELD_LABEL_KEY[field]];

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

// ─── Per-side banner (W7 Task 3 / X3) ────────────────────────────────────────────────────────────────
//
// The conflict view's top banner names each side plainly: the server's winning version (its version number,
// when it was saved, and — when known — which device saved it) and the user's own in-progress draft (which
// was never persisted, so it carries no version number of its own). Server is ALWAYS first (X7).

/**
 * Format an ISO 8601 instant as a localized "N units ago" relative-time string via `Intl.RelativeTimeFormat`
 * (library-first — never hand-rolled pluralization/wording; mirrors `formatHomeDate`'s split of "the caller
 * reads the clock, this module only formats an instant"). Buckets to the largest whole unit that has elapsed
 * at least once — minutes, then hours, then days — floored, so e.g. 90 elapsed seconds reads as "1 minute
 * ago", not "90 seconds ago". An instant within the same minute (or, degenerately, in the future — clock
 * skew) reads as "0 minutes ago". Pure — the caller supplies `now`.
 *
 * @param isoDateTime - The past instant to render, in ISO 8601.
 * @param now - The current instant, supplied by the caller (its own `new Date()` read is the side effect).
 * @param locale - The active BCP-47 locale.
 * @returns The localized "N units ago" string.
 */
export const formatRelativeTimeAgo = (isoDateTime: string, now: Date, locale: Locale): string => {
    const elapsedSeconds = Math.max(0, Math.floor((now.getTime() - new Date(isoDateTime).getTime()) / 1000));
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'always' });

    const [amount, unit]: [number, Intl.RelativeTimeFormatUnit] =
        elapsedSeconds < 60
            ? [0, 'minute']
            : elapsedSeconds < 3600
              ? [Math.floor(elapsedSeconds / 60), 'minute']
              : elapsedSeconds < 86400
                ? [Math.floor(elapsedSeconds / 3600), 'hour']
                : [Math.floor(elapsedSeconds / 86400), 'day'];

    // `-amount` even at `amount === 0`: `Intl.RelativeTimeFormat` reads the SIGN, not the magnitude, to pick
    // "ago" vs. "in" — `format(0, 'minute')` renders "in 0 minutes" (treated as the future direction), while
    // `format(-0, 'minute')` renders "0 minutes ago". A sub-minute-old server side must still read "ago", not
    // "in 0 minutes", so this always negates (JS's `-0` is a distinct, valid float from `0`).
    return rtf.format(-amount, unit);
};

/**
 * Render the server-side banner line: "Server version (v{n}): Saved {time}", with " on {device}" appended
 * ONLY when `server.deviceLabel` is present — mirroring {@link formatVersionAttribution}'s own
 * base-template-plus-optional-device-suffix split, the same reuse pattern for the same reason (a
 * caller-supplied device label is optional free text, never fabricated). `deviceLabel` is untrusted: this
 * returns a plain string for the caller to render as TEXT (React/RN escape it) — NEVER via
 * `dangerouslySetInnerHTML`. Pure — the caller supplies `now`.
 *
 * @param server - The 409's winning server side.
 * @param now - The current instant, supplied by the caller.
 * @param messages - The localized conflict copy.
 * @param locale - The active BCP-47 locale.
 * @returns The formatted server-side banner line.
 */
export const formatServerBanner = (
    server: VersionConflictSide,
    now: Date,
    messages: RecipeConflictMessages,
    locale: Locale,
): string => {
    const relative = formatRelativeTimeAgo(server.updatedAt, now, locale);
    const base = fillTemplate(messages.serverBanner, { version: server.versionNumber, time: relative });

    return server.deviceLabel === undefined
        ? base
        : base + fillTemplate(messages.serverBannerDevice, { device: server.deviceLabel });
};

// ─── Changed-field labeling (W7 Task 1 → Task 3) ─────────────────────────────────────────────────────

/**
 * Which localized field-label key (from the SHARED {@link RecipeConflictMessages} field labels — the SAME
 * labels {@link snapshotFieldLabel} resolves, reused rather than duplicated) names each
 * {@link ConflictFieldKind}. `step`/`ingredient` (the per-element row kinds — one row PER changed
 * step/ingredient, `conflictDiff.ts`) reuse the PLURAL `stepsLabel`/`ingredientsLabel` — there is no singular
 * "Step"/"Ingredient" field label anywhere else in this shared copy, and inventing one for a single row would
 * be a second, drifting representation of the same field name.
 */
const CONFLICT_FIELD_KIND_LABEL_KEY: Readonly<Record<ConflictFieldKind, keyof RecipeConflictMessages>> = {
    title: 'titleLabel',
    description: 'descriptionLabel',
    servings: 'servingsLabel',
    prepTimeMinutes: 'prepLabel',
    cookTimeMinutes: 'cookLabel',
    step: 'stepsLabel',
    ingredient: 'ingredientsLabel',
};

/**
 * The localized field label (see {@link CONFLICT_FIELD_KIND_LABEL_KEY}) for one
 * {@link ./conflictDiff.js!ConflictFieldRow}'s `fieldKind` — a `ConflictFieldRow` carries no `label` of its
 * own (`fieldKind` is an ENUM; localization is this function's job, not the row's), mirroring
 * {@link snapshotFieldLabel}'s own row→label indirection for the two-way diff. Pure.
 *
 * @param fieldKind - The changed row's field kind.
 * @param messages - The shared conflict-panel field labels.
 * @returns The localized field label.
 */
export const conflictFieldKindLabel = (fieldKind: ConflictFieldKind, messages: RecipeConflictMessages): string =>
    messages[CONFLICT_FIELD_KIND_LABEL_KEY[fieldKind]];

// ─── Changed-only diff panel: markers + per-row labels (W7 Task 4 / X1) ─────────────────────────────

/** Which localized glyph key names each {@link ConflictMarker}'s ASCII glyph (`[=]` / `[→]` / `[!!]`). */
const CONFLICT_MARKER_GLYPH_KEY: Readonly<Record<ConflictMarker, keyof RecipeConflictMessages>> = {
    unchanged: 'markerGlyphUnchanged',
    changed: 'markerGlyphChanged',
    conflict: 'markerGlyphConflict',
};

/** Which localized label key names each {@link ConflictMarker}'s ACCESSIBLE name — a DIFFERENT string per
 *  marker, so the marker is conveyed by text/role, never colour (or the glyph's shape) alone. */
const CONFLICT_MARKER_LABEL_KEY: Readonly<Record<ConflictMarker, keyof RecipeConflictMessages>> = {
    unchanged: 'markerLabelUnchanged',
    changed: 'markerLabelChanged',
    conflict: 'markerLabelConflict',
};

/**
 * The localized ASCII glyph (see {@link CONFLICT_MARKER_GLYPH_KEY}) rendered for one {@link ConflictMarker}
 * — the VISIBLE marker text (e.g. `[→]`). Pure.
 *
 * @param marker - The row's marker classification.
 * @param messages - The shared conflict-panel copy.
 * @returns The localized glyph.
 */
export const conflictMarkerGlyph = (marker: ConflictMarker, messages: RecipeConflictMessages): string =>
    messages[CONFLICT_MARKER_GLYPH_KEY[marker]];

/**
 * The localized ACCESSIBLE label (see {@link CONFLICT_MARKER_LABEL_KEY}) for one {@link ConflictMarker} —
 * the name assistive tech announces for the marker (e.g. "changed"), distinct from its glyph so the
 * distinction survives without colour or shape (X1). Pure.
 *
 * @param marker - The row's marker classification.
 * @param messages - The shared conflict-panel copy.
 * @returns The localized accessible marker name.
 */
export const conflictMarkerLabel = (marker: ConflictMarker, messages: RecipeConflictMessages): string =>
    messages[CONFLICT_MARKER_LABEL_KEY[marker]];

/** Matches a per-element STEP row's `steps[N]` key (`conflictDiff.ts`), capturing its 0-based position. */
const STEP_ROW_KEY = /^steps\[(\d+)\]$/;

/**
 * The label for one {@link ConflictFieldRow} in the changed-only diff panel (W7 Task 4 / X1): the shared
 * field label for a scalar row ({@link conflictFieldKindLabel}); "Step {n}" (1-based, decoded from the row's
 * own `steps[N]` key) for a per-element STEP row; "Ingredient: {value}" for a per-element INGREDIENT row,
 * where `{value}` is the row's own formatted line — SERVER-FIRST (X7: `theirs`, then `mine`, then `base`,
 * the first non-empty) — since a `ConflictFieldRow` carries no independent ingredient name (its stable
 * identity, `ingredientId`, is an opaque catalog reference, not display text — see `conflictDiff.ts`), and
 * the row's own formatted "{quantity}{unit} {name}" line both identifies the ingredient AND is already
 * exactly what every other side-by-side value on this panel renders — introducing a second, differently
 * (name-only) formatted representation of the same ingredient would be a DRY liability, not a DRY win. A
 * `ConflictFieldRow` carries no `label` of its own — localization is this function's job (mirrors
 * {@link snapshotFieldLabel}'s / {@link conflictFieldKindLabel}'s own row→label indirection). Pure.
 *
 * @param row - The changed-or-conflicting row to label.
 * @param messages - The shared conflict-panel copy.
 * @returns The row's localized label.
 */
export const conflictRowLabel = (row: ConflictFieldRow, messages: RecipeConflictMessages): string => {
    if (row.fieldKind === 'step') {
        const match = STEP_ROW_KEY.exec(row.key);
        const position = match === null ? 1 : Number(match[1]) + 1;

        return fillTemplate(messages.stepPositionLabel, { position });
    }

    if (row.fieldKind === 'ingredient') {
        const identity = row.theirs !== '' ? row.theirs : row.mine !== '' ? row.mine : (row.base ?? '');

        return fillTemplate(messages.ingredientRowLabel, { value: identity });
    }

    return conflictFieldKindLabel(row.fieldKind, messages);
};

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
// {@link conflictRowLabel} (Task 4) — so a second, whole-field label/format registry would be a second,
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
// WITHOUT a refetch: {@link draftToSnapshot} turns the in-progress draft into the same `RecipeSnapshot`
// shape `computeConflictDiff` (W7 Task 1) compares against, and {@link applyServerSnapshotToRecipeDetail}
// turns the server's snapshot into a displayable `RecipeDetail` by overlaying it onto the last-known
// recipe (the query cache's `RecipeDetail`, used purely as a SHELL for fields a snapshot doesn't carry —
// id, ownerId, visibility, photos, nutrition, etc.).

/**
 * Project the in-progress draft to a {@link RecipeSnapshot} — the shape {@link ./conflictDiff.js!computeConflictDiff} (W7
 * Task 1) 3-way-compares against the 409's `server`/`base` sides. `id`/`recipeId` on the synthesized
 * `RecipeStep`/`RecipeIngredient` rows are placeholders (never persisted, never read by
 * {@link ./conflictDiff.js!computeConflictDiff}'s content comparisons — see `diff.ts`'s module docs on why those fields are
 * structural, not authored content); `sortOrder` is the line's array position, mirroring how the service
 * assigns it on save. An unresolved ingredient line (no `ingredientId` yet) is dropped, matching every
 * other draft→wire projection ({@link ../form/model.js!toCreateRecipeInput}, {@link ../form/model.js!applyDraftToRecipeDetail}) — an
 * unresolved line was never going to reach the server, so it cannot appear in what the server sees either.
 * `isUserEntered` defaults to `false` (the draft carries no provenance flag — same documented limitation as
 * {@link ../form/model.js!applyDraftToRecipeDetail}). Pure.
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
    steps: values.steps.map(
        (step, index): RecipeStep => ({
            id: `draft-step-${index}`,
            recipeId: '',
            stepNumber: index + 1,
            instruction: step.instruction,
            ...(step.timerSeconds === undefined ? {} : { timerSeconds: step.timerSeconds }),
        }),
    ),
    ingredients: values.ingredients
        .filter((line): line is RecipeFormIngredient & { ingredientId: string } => line.ingredientId !== null)
        .map(
            (line, index): RecipeIngredient => ({
                id: `draft-ingredient-${index}`,
                recipeId: '',
                ingredientId: line.ingredientId,
                quantity: line.quantity,
                unit: line.unit ?? '',
                ...(line.notes === undefined || line.notes === '' ? {} : { displayText: line.notes }),
                sortOrder: index,
                ingredientName: line.name,
                isUserEntered: false,
                ...(line.userCalories === undefined ? {} : { userCalories: line.userCalories }),
                ...(line.userProteinG === undefined ? {} : { userProteinG: line.userProteinG }),
                ...(line.userCarbsG === undefined ? {} : { userCarbsG: line.userCarbsG }),
                ...(line.userFatG === undefined ? {} : { userFatG: line.userFatG }),
            }),
        ),
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
        ingredients: snapshot.ingredients.map(
            (ingredient): RecipeIngredientView => ({
                ingredientId: ingredient.ingredientId,
                name: ingredient.ingredientName,
                quantity: ingredient.quantity,
                ...(ingredient.unit === '' ? {} : { unit: ingredient.unit }),
                ...(ingredient.displayText === undefined || ingredient.displayText === ''
                    ? {}
                    : { notes: ingredient.displayText }),
                isUserEntered: ingredient.isUserEntered,
            }),
        ),
        steps: snapshot.steps.map(
            (step): RecipeStepView => ({
                stepNumber: step.stepNumber,
                instruction: step.instruction,
                ...(step.timerSeconds === undefined ? {} : { timerSeconds: step.timerSeconds }),
            }),
        ),
    };
};

/** Matches a per-element STEP selection key from {@link ./conflictDiff.js!computeConflictDiff} (W7 Task 1), e.g. `steps[2]`. */
const STEP_SELECTION_KEY = /^steps\[\d+\]$/;

/** Matches a per-element INGREDIENT selection key from {@link ./conflictDiff.js!computeConflictDiff} (W7 Task 1), e.g.
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
 * ({@link ./conflictDiff.js!computeConflictDiff}'s `steps[N]`/`ingredients:<id>` row keys, W7 Task 1) — the finer-grained
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

// ─── Selection-gating, choice summary + stale-base warning (W7 Task 5 / X5, X6) ─────────────────────
//
// The merge panel (Option C) must never silently resolve a field the user hasn't looked at, so the
// Save/Resolve action is GATED (X5) on at least one EXPLICIT selection existing, and a running "Summary of
// choices" line reports how the user's picks split between the two sides as they make them. Separately, a
// conflict whose common base is unusually far behind — or missing entirely — is riskier to resolve blindly
// (Overwrite/Save-merged can discard intervening changes the view never got to show), so that case (X6)
// requires an explicit confirm before either action proceeds.

/** More than this many versions behind is stale enough to warn on (X6). */
const STALE_VERSIONS_BEHIND_THRESHOLD = 10;

/**
 * Whether the 409's base is stale enough (X6) to require an explicit confirm before Overwrite/Save-merged
 * proceed: the base version was evicted from version history (`base === undefined`) OR the server is more
 * than {@link STALE_VERSIONS_BEHIND_THRESHOLD} versions ahead of it. Both conditions are checked
 * independently — `versionsBehind` ALONE is unreliable when `base` is absent (`useRecipeEditor` degrades it
 * to `server.versionNumber` itself in that case, an unrelated number that can easily land under the
 * threshold), so an absent base must warn regardless of what `versionsBehind` happens to read. Pure.
 *
 * @param base - The 409's base side, or `undefined` when evicted from version history.
 * @param versionsBehind - `server.versionNumber - (base?.versionNumber ?? 0)`, the X6 staleness signal.
 * @returns Whether the stale-base warning + confirm gate applies.
 */
export const isConflictBaseStale = (base: VersionConflictSide | undefined, versionsBehind: number): boolean =>
    base === undefined || versionsBehind > STALE_VERSIONS_BEHIND_THRESHOLD;

/** How the user's EXPLICIT per-field/per-element merge picks (W7 Task 5's running "Summary of choices")
 *  currently split between the two sides. An absent key (still defaulting to "mine" for composition — see
 *  {@link composeMergedRecipe}) is NOT counted here: the summary reports what the user has actively chosen,
 *  not the composed result, so it reads "0, 0" until the first deliberate pick. */
export interface MergeSelectionCounts {
    /** Rows explicitly resolved to the server's value. */
    readonly server: number;
    /** Rows explicitly resolved to the user's own draft value. */
    readonly mine: number;
}

/**
 * Tally {@link RecipeMergeSelections} by chosen side. Pure.
 *
 * @param selections - The current per-field/per-element resolution.
 * @returns How many selections went to the server's value vs. the user's own.
 */
export const countMergeSelections = (selections: RecipeMergeSelections): MergeSelectionCounts => {
    const sides = Object.values(selections);

    return {
        server: sides.filter((side) => side === 'theirs').length,
        mine: sides.filter((side) => side === 'mine').length,
    };
};

/**
 * Render the running "Summary of choices" line (W7 Task 5): how many of the user's picks went to the
 * server's value vs. their own, each correctly pluralized via the SAME one/other-template pattern every
 * other count in this module uses (e.g. {@link formatChangedFromCurrent}'s ingredient/step counts). Pure.
 *
 * @param selections - The current per-field/per-element resolution.
 * @param messages - The localized conflict copy (the summary templates).
 * @param locale - The active BCP-47 locale (for count pluralization).
 * @returns The formatted "Summary of choices" line.
 */
export const formatMergeSummary = (
    selections: RecipeMergeSelections,
    messages: RecipeConflictMessages,
    locale: Locale,
): string => {
    const counts = countMergeSelections(selections);

    return fillTemplate(messages.mergeSummaryTemplate, {
        server: formatRecipeCount(
            counts.server,
            { one: messages.mergeSummaryServerCountOne, other: messages.mergeSummaryServerCountOther },
            locale,
        ),
        mine: formatRecipeCount(
            counts.mine,
            { one: messages.mergeSummaryMineCountOne, other: messages.mergeSummaryMineCountOther },
            locale,
        ),
    });
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

/**
 * Render the "Changed from current: {ingredients}, {steps}" summary line from a {@link SnapshotDiff}, with
 * each count correctly pluralized via the SAME `ingredientCount*`/`stepCount*` templates the merge panel's
 * own ingredient/step counts already use ({@link buildRecipeMergeFields}) — a count of 1 reads "1
 * ingredient"/"1 step", never a hard-coded plural ("1 ingredients"/"1 steps"). The field label is one piece
 * of knowledge regardless of which version surface renders it; so is its pluralization. Pure.
 *
 * @param diff - This version's diff vs. the recipe's current version.
 * @param previewMessages - The localized preview copy (the summary line's own template).
 * @param conflictMessages - The shared singular/plural count templates (reused — see {@link buildRecipeMergeFields}).
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

// ─── Version compare (W6 Task 4 / FR-007b, FR-007c) ─────────────────────────────────────────────────
//
// The wireframe's "Compare Versions" right sidebar: pick two versions (selection UI lives in the composing
// container, Task 5) and show the Diff Summary (Added/Removed/Modified rollup, {@link SnapshotDiff.summary})
// plus a CHANGED-ONLY field-by-field A/B display — only `diff.changedFields` are rendered, each with both
// versions' values side by side. `steps`/`ingredients` render as a compact count (never a per-line
// explosion — see {@link buildCompareFieldRows}'s module docs on the reorder sanity note from Task 1).

/**
 * Props for the two-version compare panel (W6 Task 4) — a FULLY controlled, presentational component. It
 * renders the Diff Summary + changed-only A/B display for two ALREADY-SELECTED versions; it computes no
 * diff itself (`diff` is `diffSnapshots(versionA.snapshot, versionB.snapshot)`, computed by the composing
 * container, Task 5) and fetches nothing. `versionA`/`versionB`/`diff` are OPTIONAL together — while `open`
 * is true but fewer than two versions have been chosen yet, the view shows {@link
 * RecipeVersionCompareMessages.selectTwoVersions} instead of a broken partial render.
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
     *  backdrop dismissal all resolve to this ONE callback (mirrors {@link VersionPreviewModalProps.onCancel}'s
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
 * — reuses the SAME localized templates the Diff Summary rollup renders ({@link
 * RecipeVersionCompareMessages.added}/`removed`/`modified`), applied to this ONE collection's tally instead
 * of the overall summary, so "Added: N" is one piece of knowledge regardless of which tally it's reporting.
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
