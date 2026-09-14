/**
 * @module @commise/features-recipes/versions — Resolving a diff row's localized LABEL or GLYPH from the shared conflict copy.
 *
 * ⛔ This module takes {@link RecipeConflictMessages} and NEVER a `Locale` — the mirror of `timeFormat.ts`.
 *
 * ⚠️ The lookup tables stay TOGETHER on purpose. `SNAPSHOT_FIELD_LABEL_KEY` and
 * `CONFLICT_FIELD_KIND_LABEL_KEY` share six of their seven keys and are ONE vocabulary; co-location IS the
 * drift guard, and splitting them across the compare and conflict surfaces would put two near-identical
 * tables in two files. That is why the conflict view reads its labels from a module named for the diff.
 *
 * Pure and platform-agnostic: shared unchanged by the web (`*.tsx`) and native (`*.native.tsx`) leaves, so
 * the two renders can never drift. No React, no platform APIs.
 */
import { fillTemplate } from '../list/model.js';
import type { ConflictFieldKind, ConflictFieldRow, ConflictMarker } from './conflictDiff.js';
import type { SnapshotFieldKey } from './diff.js';
import type { RecipeConflictMessages } from './messages.js';

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
 * `ConflictFieldRow`'s `fieldKind` — a `ConflictFieldRow` carries no `label` of its
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
