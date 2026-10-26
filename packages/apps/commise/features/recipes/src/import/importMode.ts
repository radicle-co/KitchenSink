/**
 * @module @commise/features-recipes/import — how a bulk import matches ingredients: the closed list of modes, their words
 * as option-list rows, and the way back from a chosen row to its mode. Read by both `ImportModeChoice` leaves.
 *
 * The values name what the cook sees, and mirror the spec's planned `matchMode` (`keepAsWritten | bindBest | review`)
 * without importing it: no wire type exists yet, and the wiring phase maps one onto the other in one place.
 *
 * @pattern Registry — the closed `IMPORT_MATCH_MODES` tuple is the one list the type, the rows and the parse derive from
 */
import type { RadioListOption } from '@commise/ui/radio-list';

import type { ImportMessages } from './messages.js';

/** The modes, in the order the board draws them. */
export const IMPORT_MATCH_MODES = ['saveAsWritten', 'best', 'review'] as const;

/**
 * How the import matches ingredients.
 *
 * - `saveAsWritten`: defaults and confident matches bind; every other line is saved as written.
 * - `best`: every line binds its top match; the save-time check lists its doubts under "N to check".
 * - `review`: one wizard step per recipe with an open line; the others are added without a step.
 */
export type ImportMatchMode = (typeof IMPORT_MATCH_MODES)[number];

/** Each mode's words. A mode added to the tuple without words here is a compile error. */
const MODE_COPY: Readonly<
    Record<ImportMatchMode, (m: ImportMessages['mode']) => { readonly label: string; readonly hint: string }>
> = {
    saveAsWritten: (m) => ({ label: m.saveAsWrittenTitle, hint: m.saveAsWrittenHint }),
    best: (m) => ({ label: m.bestTitle, hint: m.bestHint }),
    review: (m) => ({ label: m.reviewTitle, hint: m.reviewHint }),
};

/**
 * The modes as option-list rows. Pure.
 *
 * @param messages - The mode copy.
 * @returns One row per mode, in the board's order.
 */
export function modeOptionsOf(messages: ImportMessages['mode']): readonly RadioListOption[] {
    return IMPORT_MATCH_MODES.map((mode) => ({ id: mode, ...MODE_COPY[mode](messages) }));
}

/**
 * The mode a chosen row stands for. Pure.
 *
 * @param id - A row id from {@link modeOptionsOf}.
 * @returns The mode, or `undefined` for an id that is not one.
 */
export function modeOfOptionId(id: string): ImportMatchMode | undefined {
    return IMPORT_MATCH_MODES.find((mode) => mode === id);
}
