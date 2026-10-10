/**
 * @module @commise/features-recipes/form — the Steps section's commands and its one piece of view state, shared by the
 * web and native Steps leaves (`docs/design/uiOverhaul/buildSpec.md` §7.6), so the two cannot move, remove or disclose a
 * step differently.
 *
 * The view state is which steps show a timer field the cook revealed and has not filled yet. A step that HAS a timer
 * always shows it, so that is read from the draft, never stored. A draft step has no identity of its own, so the
 * revealed set is keyed by index and re-keyed in the same handler that moves or removes a step (`./stepIndex.ts`).
 *
 * It also holds where focus goes after a ⋯ Move or Remove (SC 2.4.3): the menu returns focus to the trigger at the
 * position it was opened from, which after a move is another step's, and after removing the last step is gone. A
 * request is a LEVEL the control lowers once it has taken focus (`ActionMenu`'s and `Button`'s `focusRequested`).
 *
 * @pattern Headless hook — the commands and the disclosure, with no markup; each leaf renders them its own way
 */
import { useState } from 'react';

import { applyDraftAction, type RecipeFormSectionProps } from './props.js';
import { focusAfterRemove, indexAfterMove, indexAfterRemove, type StepFocusTarget } from './stepIndex.js';

/**
 * One control's focus request: a level it lowers once it has taken focus.
 *
 * @notWireShape A control's focus request inside the editor; nothing on any wire carries it.
 */
export interface StepFocusRequest {
    readonly requested: boolean;
    readonly onHandled: () => void;
}

/** The Steps section's commands and disclosure. */
export interface StepList {
    /** Whether the step shows its timer field: it has a timer, or the cook revealed one. */
    readonly timerShown: (index: number) => boolean;
    /** "Add a timer": show the empty field. */
    readonly revealTimer: (index: number) => void;
    /** "Remove timer": clear it and hide the field. */
    readonly removeTimer: (index: number) => void;
    /** Set the timer from the field. */
    readonly setTimer: (index: number, seconds: number | undefined) => void;
    /** Move a step; the disclosure moves with it. */
    readonly move: (from: number, to: number) => void;
    /** Remove a step; the disclosure goes with it. */
    readonly remove: (index: number) => void;
    /** Append an empty step. */
    readonly add: () => void;
    /** A step's ⋯ focus request. */
    readonly actionsFocus: (index: number) => StepFocusRequest;
    /** Add step's focus request. */
    readonly addFocus: StepFocusRequest;
}

/**
 * The Steps section's commands and disclosure.
 *
 * @param props - The section's draft and its change handler.
 * @returns The commands.
 */
export function useStepList({ values, onChange }: Pick<RecipeFormSectionProps, 'values' | 'onChange'>): StepList {
    const [revealed, setRevealed] = useState<readonly number[]>([]);
    const [focus, setFocus] = useState<StepFocusTarget | undefined>(undefined);
    const handled = (): void => setFocus(undefined);

    return {
        timerShown: (index) => values.steps[index]?.timerSeconds !== undefined || revealed.includes(index),
        revealTimer: (index) => setRevealed((current) => (current.includes(index) ? current : [...current, index])),
        removeTimer: (index) => {
            setRevealed((current) => current.filter((shown) => shown !== index));
            onChange(applyDraftAction(values, { kind: 'setStepTimer', index }));
        },
        setTimer: (index, seconds) => {
            // Emptying the boxes keeps the field open: it is mid-edit, and only "Remove timer" closes it.
            if (seconds === undefined) {
                setRevealed((current) => (current.includes(index) ? current : [...current, index]));
            }

            onChange(
                applyDraftAction(values, {
                    kind: 'setStepTimer',
                    index,
                    ...(seconds === undefined ? {} : { seconds }),
                }),
            );
        },
        move: (from, to) => {
            setRevealed((current) => current.map((shown) => indexAfterMove(shown, from, to)));
            setFocus({ kind: 'actions', index: to });
            onChange(applyDraftAction(values, { kind: 'moveStep', from, to }));
        },
        remove: (index) => {
            setRevealed((current) =>
                current.flatMap((shown) => {
                    const next = indexAfterRemove(shown, index);

                    return next === undefined ? [] : [next];
                }),
            );
            setFocus(focusAfterRemove(index, values.steps.length));
            onChange(applyDraftAction(values, { kind: 'removeAt', field: 'steps', index }));
        },
        add: () => onChange(applyDraftAction(values, { kind: 'addStep' })),
        actionsFocus: (index) => ({
            requested: focus?.kind === 'actions' && focus.index === index,
            onHandled: handled,
        }),
        addFocus: { requested: focus?.kind === 'add', onHandled: handled },
    };
}
