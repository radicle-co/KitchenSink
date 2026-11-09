/**
 * @module @commise/features-recipes/foodPage — the refusal's pure half (private foods spec section 7): which of the
 * draft's rows the server named, and which ways forward and actions this cook has at this door.
 *
 * "Can go private" is the caller's fact (the existing `privateGate` outcome is `apply`: Pro, or a free private slot,
 * ADR-0073). A cook who cannot is shown the ways that work and one line saying their private recipes are full, never an
 * upsell (owner ruling 2026-11-09).
 *
 * @pattern Specification — one pure table from (door, ability) to the ways and the actions
 */
import type { PrivateFoodLine } from '@kitchensink/recipe-core';

import { privateFoodRowIndexes, type PrivateFoodDraft } from '../form/privateFoodLines.js';

/** A row of the draft, as far as the refusal needs it. */
export interface RefusalRow {
    readonly rowId: string;
    readonly foodId: string;
    /** The row's position now. */
    readonly sortOrder: number;
}

/**
 * The draft's rows that the server named. A line matches by `foodId`; two lines of one food break the tie by
 * `sortOrder`, and a `sortOrder` that no longer exists falls to the first row of that food not yet named. A line whose
 * food is no longer in the draft is dropped. Each row is named once, in the order the editor shows them. Pure.
 */
export function matchRefusedLines(
    lines: readonly PrivateFoodLine[],
    rows: readonly RefusalRow[],
): readonly RefusalRow[] {
    const named = new Set<string>();

    for (const line of lines) {
        const sameFood = rows.filter((row) => row.foodId === line.foodId && !named.has(row.rowId));
        const exact = sameFood.find((row) => row.sortOrder === line.sortOrder);
        const chosen = exact ?? sameFood[0];

        if (chosen !== undefined) {
            named.add(chosen.rowId);
        }
    }

    return rows.filter((row) => named.has(row.rowId));
}

/** The door the refusal came through. */
export type RefusalDoor = 'publish' | 'save' | 'makePublic' | 'restore';

/** One of the copy keys of the "To go on" list. */
export type RefusalWay = 'wayChange' | 'wayAsk' | 'wayPrivatePublish' | 'wayPrivateSave';

/** An action in the footer: its copy key and what it does. */
export interface RefusalAction {
    readonly key: 'publishPrivate' | 'savePrivate' | 'back' | 'close';
    /** `sendAsPrivate` switches the recipe to Private and sends again in one step; `close` only closes. */
    readonly effect: 'sendAsPrivate' | 'close';
}

/** What the sheet offers. */
export interface RefusalPlan {
    readonly ways: readonly RefusalWay[];
    readonly primary: RefusalAction;
    readonly secondary: RefusalAction | null;
    /** What stays safe when the cook cannot go private, or null. */
    readonly note: 'draftKept' | 'changesKept' | null;
    /** Say, in one line, that the cook's private recipes are full. */
    readonly slotsFull: boolean;
}

const CLOSE: RefusalAction = { key: 'close', effect: 'close' };
const BACK: RefusalAction = { key: 'back', effect: 'close' };

/** The ways forward and the actions for this cook at this door (section 7.3). Pure. */
export function refusalPlanOf({ door, canGoPrivate }: { door: RefusalDoor; canGoPrivate: boolean }): RefusalPlan {
    if (door === 'makePublic' || door === 'restore') {
        return { ways: ['wayChange', 'wayAsk'], primary: CLOSE, secondary: null, note: null, slotsFull: false };
    }

    if (!canGoPrivate) {
        return {
            ways: ['wayChange', 'wayAsk'],
            primary: BACK,
            secondary: null,
            note: door === 'publish' ? 'draftKept' : 'changesKept',
            slotsFull: true,
        };
    }

    return door === 'publish'
        ? {
              ways: ['wayChange', 'wayAsk', 'wayPrivatePublish'],
              primary: { key: 'publishPrivate', effect: 'sendAsPrivate' },
              secondary: BACK,
              note: null,
              slotsFull: false,
          }
        : {
              ways: ['wayChange', 'wayAsk', 'wayPrivateSave'],
              primary: { key: 'savePrivate', effect: 'sendAsPrivate' },
              secondary: BACK,
              note: null,
              slotsFull: false,
          };
}

/**
 * The lines to name when the outbox PARKED a write the server refused with `400` (F6, revision 4). The outbox keeps only the
 * status, not the refusal's body, so the editor works the refusal out from its own lines: a terminal `400` on a public
 * draft that holds a private-food line is that refusal. A `400` for another reason names nothing here, and the generic
 * alert stands. Pure.
 *
 * @param parked - The parked write, or `undefined`.
 * @param values - The draft.
 * @returns The positions of the private-food lines; empty when this is not that refusal.
 */
export function parkedRefusalRows(
    parked: { readonly failure: string; readonly status?: number | undefined } | undefined,
    values: PrivateFoodDraft,
): readonly number[] {
    return parked?.failure === 'terminal' && parked.status === 400 ? privateFoodRowIndexes(values) : [];
}
