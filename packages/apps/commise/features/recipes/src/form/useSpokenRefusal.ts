/**
 * @module @commise/features-recipes/form — native's R7 channel (`docs/design/rowEditorOpenDecisions.md` R7, R8), used
 * by `RecipeIngredientsFields.native.tsx` only.
 *
 * Native has no `aria-describedby`, so the entry field a refused save or Next points at says its row sentence in its
 * own assertive alert: the sentence as it stood at the refusal, set once the field has taken focus (an Android live
 * region that mounts with its text says nothing, `LiveRegion`), and dropped at the cook's next keystroke so typing is
 * never spoken over. Its occurrence is the refusal count AT that focus, so a later refusal is said after the focus
 * move, not cut off by it. On web the sentence is the field's description instead, and none of this runs.
 *
 * @pattern Decorator — over an entry field's input, adding the spoken refusal to its focus and typing handlers
 */
import { useState } from 'react';

import type { IngredientLineKey } from './lineKey.js';

/** The part of an entry field's input that carries the refusal: `RowEntryFieldInput`, `TrailingEntryFieldInput`. */
export interface RefusalChannel {
    readonly refusal: string | undefined;
    readonly refusalOccurrence: number;
    /** With the focus, open the list: a refusal points at this field. */
    readonly listRequested: boolean;
    readonly onFocusRequestHandled: () => void;
    readonly onTextChange: () => void;
}

/** The field saying the sentence: a row, by its key, or the trailing row (a line key never spells `newLine`). */
export type SpeakingField = IngredientLineKey | 'newLine';

/** Adds the spoken refusal to one entry field's input. */
export type SpeakRefusal = <T extends RefusalChannel>(
    input: T,
    field: SpeakingField,
    sentence: string | undefined,
) => T;

/** The sentence being said, by which field, at which refusal. */
interface SpokenRefusal {
    readonly field: SpeakingField;
    readonly text: string;
    readonly occurrence: number;
}

/**
 * Native's spoken refusal.
 *
 * @param pendingRefusals - How many refusals have pointed at a pending field (`IngredientRowEditor.pendingRefusals`).
 * @returns A decorator over an entry field's input.
 */
export function useSpokenRefusal(pendingRefusals: number): SpeakRefusal {
    const [spoken, setSpoken] = useState<SpokenRefusal | undefined>(undefined);

    return (input, field, sentence) => {
        const own = spoken?.field === field ? spoken : undefined;

        return {
            ...input,
            refusal: own !== undefined && sentence !== undefined ? own.text : undefined,
            refusalOccurrence: own?.occurrence ?? 0,
            onFocusRequestHandled: () => {
                if (input.listRequested && sentence !== undefined) {
                    setSpoken({ field, text: sentence, occurrence: pendingRefusals });
                }

                input.onFocusRequestHandled();
            },
            onTextChange: () => {
                input.onTextChange();

                if (own !== undefined) {
                    setSpoken(undefined);
                }
            },
        };
    };
}
