/**
 * @module @commise/features-recipes/hooks — the ingredient entry's pure half (`docs/design/rowEditorBlueprint.md`
 * decision 1): the text in each entry field, which rows are in Change food, which field is active, and what text is
 * PENDING (`docs/design/ingredientStatusExplanation.md` §4b). `useIngredientEntry` holds the state; this module owns
 * every rule about it.
 *
 * An entry field is the trailing add row, a row whose line names no food or a freeform one (SPECIFY.1 rows 1 and 2),
 * or a row in Change food. Its text is control-local: the line in the draft is untouched until a pick commits.
 *
 * Pure and platform-agnostic. No React, no platform APIs.
 */
import { ABSENT_QUANTITY } from '@kitchensink/recipe-core';

import { readLeadingMeasure } from '../form/leadingMeasure.js';
import type { IngredientLineKey } from '../form/lineKey.js';
import { hasEntryText } from '../form/validate.js';
import type { LineCommitTarget, LineMeasure, NewLinePlacement } from './lineCommit.js';

/** A target's identity in the entry's maps. A line key never spells `newLine` (`isIngredientLineKey`). */
type EntryTargetId = IngredientLineKey | 'newLine';

/** The two fields of a draft line the entry reads. */
export interface EntryLine {
    readonly key: IngredientLineKey;
    readonly name?: string;
}

/** One field's text, and the text the field started from (what its line held when the cook began). */
interface EntryText {
    readonly text: string;
    readonly start: string;
}

/** The entry's state. */
export interface EntryState {
    readonly texts: ReadonlyMap<EntryTargetId, EntryText>;
    /** The rows in Change food. More than one can be: a row keeps its new text when focus leaves it (item 4). */
    readonly changing: ReadonlySet<IngredientLineKey>;
    readonly active: LineCommitTarget | undefined;
    /**
     * The group the trailing field sits in (build spec §7.5.5), or `undefined` while it follows the group being built.
     * The field's own state, like its text: a commit keeps it, so the cook keeps adding to the same group.
     */
    readonly placement?: NewLinePlacement;
}

/** No field has been touched. */
export const EMPTY_ENTRY: EntryState = { texts: new Map(), changing: new Set(), active: undefined };

/**
 * Move the trailing field to a group, or back to following the group being built. Pure.
 *
 * @param state - The entry's state.
 * @param placement - The group, or `undefined`.
 * @returns The next state.
 */
export const withPlacement = (state: EntryState, placement: NewLinePlacement | undefined): EntryState => {
    const { placement: _previous, ...rest } = state;

    return placement === undefined ? rest : { ...rest, placement };
};

const idOf = (target: LineCommitTarget): EntryTargetId => (target.kind === 'line' ? target.key : 'newLine');

/** What the field shows before anyone types in it: its line's name, or nothing on the trailing row. Pure. */
const restingTextOf = (target: LineCommitTarget, lines: readonly EntryLine[]): string =>
    target.kind === 'line' ? (lines.find((line) => line.key === target.key)?.name ?? '') : '';

/** Whether a field's text is PENDING: something other than whitespace, and other than what it started with. Pure. */
const isPending = (entry: EntryText | undefined): entry is EntryText =>
    entry !== undefined && hasEntryText(entry.text) && entry.text.trim() !== entry.start.trim();

/** `map` without `id`. Pure. */
function without<K, V>(map: ReadonlyMap<K, V>, id: K): ReadonlyMap<K, V> {
    return new Map([...map].filter(([key]) => key !== id));
}

/** `set` without `key`. Pure. */
function withoutKey<K>(set: ReadonlySet<K>, key: K): ReadonlySet<K> {
    return new Set([...set].filter((each) => each !== key));
}

/**
 * The text a field shows. Pure.
 *
 * @param state - The entry's state.
 * @param target - The field.
 * @param lines - The draft's lines.
 * @returns The typed text, or what the field shows before anyone types in it.
 */
export const entryTextOf = (state: EntryState, target: LineCommitTarget, lines: readonly EntryLine[]): string =>
    state.texts.get(idOf(target))?.text ?? restingTextOf(target, lines);

/**
 * The cook typed `text` into a field, which is now the active one. Pure.
 *
 * @param state - The entry's state.
 * @param target - The field.
 * @param text - Its new text.
 * @param lines - The draft's lines: a row's field starts from its line's name.
 * @returns The next state.
 */
export const withEntryText = (
    state: EntryState,
    target: LineCommitTarget,
    text: string,
    lines: readonly EntryLine[],
): EntryState => {
    const id = idOf(target);
    const start = state.texts.get(id)?.start ?? restingTextOf(target, lines);

    return { ...state, texts: new Map([...state.texts, [id, { text, start }]]), active: target };
};

/** A field took focus: it is the active target. Pure. */
export const withActiveTarget = (state: EntryState, target: LineCommitTarget): EntryState => ({
    ...state,
    active: target,
});

/**
 * Change food on a row: the row is in entry mode, its field shows the current name, and it is the active target
 * (§2d). Its name is where its field STARTS, so it is not pending until the cook changes it (R4). Pure.
 *
 * @param state - The entry's state.
 * @param line - The row.
 * @returns The next state.
 */
export const withChangeBegun = (state: EntryState, line: EntryLine): EntryState => {
    const name = line.name ?? '';

    return {
        ...state,
        texts: new Map([...state.texts, [line.key, { text: name, start: name }]]),
        changing: new Set([...state.changing, line.key]),
        active: { kind: 'line', key: line.key },
    };
};

/**
 * The cook abandoned the entry (Cancel, Escape on a closed list, Android back): the field goes back to what its line
 * holds, and a row in Change food leaves it (item 4). The target stays active: focus has not moved. Pure.
 */
export const withEntryAbandoned = (state: EntryState, target: LineCommitTarget): EntryState => ({
    ...state,
    texts: without(state.texts, idOf(target)),
    changing: target.kind === 'line' ? withoutKey(state.changing, target.key) : state.changing,
});

/**
 * The cook left a row's entry. A row in Change food with nothing new typed leaves Change food; with new text it stays,
 * text and all (item 4). Any other field is unchanged. Pure.
 */
export const withEntryLeft = (state: EntryState, target: LineCommitTarget): EntryState =>
    target.kind === 'line' && state.changing.has(target.key) && !isPending(state.texts.get(target.key))
        ? withEntryAbandoned(state, target)
        : state;

/**
 * A pick committed on a field: its text goes (the trailing row empties) and a row leaves Change food — unless the cook
 * typed on while the commit ran, when the field keeps what they typed. Pure.
 *
 * @param state - The entry's state.
 * @param target - The field.
 * @param pickedText - The field's text when the pick was made.
 * @returns The next state.
 */
export const withEntryCommitted = (state: EntryState, target: LineCommitTarget, pickedText: string): EntryState =>
    (state.texts.get(idOf(target))?.text ?? pickedText) === pickedText ? withEntryAbandoned(state, target) : state;

/**
 * The active target, if its row is still there. Pure.
 *
 * @param state - The entry's state.
 * @param lines - The draft's lines.
 * @returns The active target, or `undefined`.
 */
export const activeTargetOf = (state: EntryState, lines: readonly EntryLine[]): LineCommitTarget | undefined => {
    const { active } = state;

    if (active?.kind === 'line' && !lines.some((line) => line.key === active.key)) {
        return undefined;
    }

    return active;
};

/** The rows in Change food that are still there. Pure. */
export const changingOf = (state: EntryState, lines: readonly EntryLine[]): ReadonlySet<IngredientLineKey> =>
    new Set(lines.filter((line) => state.changing.has(line.key)).map((line) => line.key));

/**
 * Whether one field holds PENDING text: a field whose row is gone holds none. Pure.
 *
 * @param state - The entry's state.
 * @param target - The field.
 * @param lines - The draft's lines.
 * @returns `true` when a save would drop its text.
 */
export const isPendingAt = (state: EntryState, target: LineCommitTarget, lines: readonly EntryLine[]): boolean =>
    (target.kind === 'newLine' || lines.some((line) => line.key === target.key)) &&
    isPending(state.texts.get(idOf(target)));

/** A field holding pending text, and that text. */
export interface PendingEntry {
    readonly target: LineCommitTarget;
    readonly text: string;
}

/**
 * The first field holding PENDING text — rows in list order, then the trailing row — which is where the save's refusal
 * points (§4b). Pure.
 *
 * @param state - The entry's state.
 * @param lines - The draft's lines, in order.
 * @returns The field and its text, or `undefined` when none is pending.
 */
export const pendingEntryOf = (state: EntryState, lines: readonly EntryLine[]): PendingEntry | undefined => {
    const targets: readonly LineCommitTarget[] = [
        ...lines.map((line): LineCommitTarget => ({ kind: 'line', key: line.key })),
        { kind: 'newLine' },
    ];

    for (const target of targets) {
        const entry = state.texts.get(idOf(target));

        if (isPending(entry)) {
            return { target, text: entry.text };
        }
    }

    return undefined;
};

/**
 * What a field's text asks the food search, trimmed: on the trailing row the food alone, after the measure the cook
 * typed in front of it and before the preparation's comma (`../form/leadingMeasure.ts`, blueprint A1). A row's own field
 * (Change food, a nameless row) searches its whole text: it names a food and carries no measure. Pure.
 *
 * @param target - The field.
 * @param text - Its text.
 * @returns The search.
 */
export const searchTextOf = (target: LineCommitTarget | undefined, text: string): string =>
    target?.kind === 'newLine' ? readLeadingMeasure(text).search.trim() : text.trim();

/**
 * The target a pick on `target` commits to: the trailing row carries the measure read from the text the pick was made
 * on, only when the text states one, and the group the field sits in, only when it was placed in one; so a bare food in
 * an unplaced field commits as the plain trailing target. A row's own target is returned as it is. Pure.
 *
 * @param target - The field the pick was made on.
 * @param text - Its text at the pick.
 * @param placement - The trailing field's group (`EntryState.placement`). Required, so no caller drops it by default.
 * @returns The commit target.
 */
export const commitTargetOf = (
    target: LineCommitTarget,
    text: string,
    placement: NewLinePlacement | undefined,
): LineCommitTarget => {
    if (target.kind !== 'newLine') {
        return target;
    }

    const { quantity, unit, preparation } = readLeadingMeasure(text);
    const measure: LineMeasure = { quantity, unit, preparation };
    const stated = quantity !== ABSENT_QUANTITY || unit !== '' || preparation !== '';

    return {
        kind: 'newLine',
        ...(stated ? { measure } : {}),
        ...(placement === undefined ? {} : { placement }),
    };
};
