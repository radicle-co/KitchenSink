'use client';

/**
 * @module useCookingTimerDock — everything the timer dock does, so its leaves only draw: the rows with working
 * controls, the offer to time a step, the Undo snackbar after Cancel, and where focus goes after each press.
 *
 * @pattern Mediator — one hook between the timer store, the alarm sound, the snackbar and the controls, so no leaf
 * talks to another. The commands it sends are Command objects the store applies.
 */
import { commonMessages } from '@commise/features-core/common';
import { fillTemplate } from '@commise/i18n';
import { useMessages } from '@commise/i18n/react';
import { stepDigestsOf } from '@kitchensink/cooking-core';
import { useSnackbar, type SnackbarHandle } from '@commise/ui/snackbar';
import { useEffect, useState } from 'react';

import type { CookingRecipe } from '../cookingViewProps.js';
import { cookingMessages } from '../messages.js';
import { useAlarmSound } from './alarmSound.js';
import { shownDuration, timerNameOf } from './timerCopy.js';
import { timerDockView, type DockRow } from './timerDockView.js';
import { timerStepOf } from './timerStep.js';
import { useCookingTimers } from './useCookingTimers.js';
import { useSecondTick } from './useSecondTick.js';
import { useTimerStore } from './useTimerStore.js';

/** Where focus goes next. `primary` names a row's first control; `forward` is the next control after the dock. */
type FocusRequest =
    { readonly kind: 'primary'; readonly id: string } | { readonly kind: 'offer' } | { readonly kind: 'forward' };

/** One control of the dock, with the focus it is asked to take. */
export interface DockControl {
    readonly label: string;
    readonly onPress: () => void;
    readonly focusRequested: boolean;
    readonly onFocusRequestHandled: () => void;
}

/** A row and its controls: `primary` is Pause, Resume or Stop; `secondary` is Cancel, and a done row has none. */
export type TimerDockRow =
    | (Exclude<DockRow, { readonly kind: 'done' }> & { readonly primary: DockControl; readonly secondary: DockControl })
    | (Extract<DockRow, { readonly kind: 'done' }> & { readonly primary: DockControl; readonly secondary?: undefined });

/** A request that focus moves to the next control after the dock, for the screen to pass on. */
export interface ForwardFocus {
    readonly requested: boolean;
    readonly onHandled: () => void;
}

/** What the dock draws and does. */
export interface TimerDock {
    readonly rows: readonly TimerDockRow[];
    /** The "Time ..." offer, or `undefined` when a timer is live or the step has no length. */
    readonly offer: DockControl | undefined;
    readonly forward: ForwardFocus;
    /**
     * Advances when a Cancel or Stop on Done takes a row away, so Done's title can take focus the button lost. A counter,
     * so nothing stays pending: it is inert on mount.
     */
    readonly doneTitleSignal: number;
}

/** What the dock needs. */
export interface TimerDockInput {
    readonly recipe: Pick<CookingRecipe, 'id' | 'steps'>;
    /** The 0-based index among the steps with text, as the step walk counts. */
    readonly stepIndex: number;
    /** The length the step's text offers, or `undefined` when it offers none. */
    readonly offerMs: number | undefined;
    readonly locale: string;
    /** Whether the session is on Done: no Next and no offer draw there, so Cancel asks for no focus. */
    readonly finished: boolean;
}

/** A held Undo: the snackbar that offers it, and the timer it brings back. */
interface HeldUndo {
    readonly handle: SnackbarHandle;
    readonly id: string;
}

/**
 * The timer dock for the step now open.
 *
 * @param input - The recipe, the step, the length it offers, the locale and whether the session is finished.
 * @returns The rows, the offer and the forward focus request.
 * @throws {Error} When no `TimerProvider` or no `SnackbarHost` is above.
 * @sideEffect Sends timer commands, primes the alarm sound inside the press, shows and withdraws a snackbar, and on
 *   unmount withdraws it and lets the held Undo go.
 */
export function useCookingTimerDock({ recipe, stepIndex, offerMs, locale, finished }: TimerDockInput): TimerDock {
    const copy = useMessages(cookingMessages);
    const common = useMessages(commonMessages);
    const store = useTimerStore();
    const snackbar = useSnackbar();
    const sound = useAlarmSound();
    const { order, command, start } = useCookingTimers();
    const [focus, setFocus] = useState<FocusRequest | undefined>(undefined);
    const [doneTitleSignal, setDoneTitleSignal] = useState(0);

    // Done draws neither an offer nor Next, so Done's title takes the focus a Cancel or Stop button lost there.
    const bumpIfDone = (): void => {
        if (finished) {
            setDoneTitleSignal((signal) => signal + 1);
        }
    };

    const [held, setHeld] = useState<HeldUndo | undefined>(undefined);
    const running = order.some((entry) => entry.kind === 'live' && entry.timer.kind === 'running');
    const nowMs = useSecondTick(running);
    const view = timerDockView({ order, recipe, nowMs, copy, locale });

    useEffect(() => {
        if (held === undefined) {
            return undefined;
        }

        return () => {
            snackbar.withdraw(held.handle);
            command({ kind: 'discardUndo', id: held.id });
        };
    }, [held, snackbar, command]);

    const handled = (): void => {
        setFocus(undefined);
    };

    const control = (label: string, request: FocusRequest, onPress: () => void): DockControl => ({
        label,
        onPress,
        focusRequested: focus !== undefined && sameRequest(focus, request),
        onFocusRequestHandled: handled,
    });

    const cancel = (row: DockRow): void => {
        const timer = store.getSnapshot().timers.find((candidate) => candidate.id === row.id);

        command({ kind: 'cancel', id: row.id, run: row.run });

        const undo = store.getSnapshot().undo;

        if (timer === undefined || undo === undefined) {
            return;
        }

        const label = timerNameOf(timer, timerStepOf(timer, recipe), copy.timer).text;
        const handle = snackbar.show({
            message: fillTemplate(copy.dock.cancelled, { label }),
            action: {
                label: common.undo,
                onAction: () => {
                    sound.prime();
                    command({ kind: 'restore' });
                    setFocus({ kind: 'primary', id: undo.id });
                },
            },
            onTimeout: () => {
                command({ kind: 'discardUndo', id: undo.id });
            },
        });

        setHeld({ handle, id: undo.id });

        // Done has no offer and no Next to take the focus the Cancel button lost: its title does.
        if (finished) {
            bumpIfDone();

            return;
        }

        setFocus(offerMs === undefined ? { kind: 'forward' } : { kind: 'offer' });
    };

    const rows = view.rows.map((row): TimerDockRow => {
        const own: FocusRequest = { kind: 'primary', id: row.id };
        // Cancel never takes focus: the row it sits on is the one that goes.
        const cancelControl = (label: string): DockControl => ({
            label,
            onPress: () => {
                cancel(row);
            },
            focusRequested: false,
            onFocusRequestHandled: handled,
        });

        switch (row.kind) {
            case 'running':
                return {
                    ...row,
                    primary: control(row.pauseLabel, own, () => {
                        command({ kind: 'pause', id: row.id, run: row.run });
                    }),
                    secondary: cancelControl(row.cancelLabel),
                };
            case 'paused':
                return {
                    ...row,
                    primary: control(row.resumeLabel, own, () => {
                        sound.prime();
                        command({ kind: 'resume', id: row.id, run: row.run });
                    }),
                    secondary: cancelControl(row.cancelLabel),
                };
            case 'done':
                return {
                    ...row,
                    primary: control(row.stopLabel, own, () => {
                        command({ kind: 'stop', id: row.id, run: row.run });

                        bumpIfDone();
                    }),
                };
        }
    });

    const offer =
        view.offerShown && offerMs !== undefined
            ? control(
                  fillTemplate(copy.step.timeOffer, { duration: shownDuration(offerMs, copy.duration) }),
                  { kind: 'offer' },
                  () => {
                      sound.prime();
                      const id = start({
                          recipeId: recipe.id,
                          stepIndex,
                          stepDigest: stepDigestsOf(recipe.steps)[stepIndex] ?? '',
                          label: undefined,
                          origin: { kind: 'offer', lineIndex: null },
                          durationMs: offerMs,
                      });

                      if (id !== undefined) {
                          setFocus({ kind: 'primary', id });
                      }
                  },
              )
            : undefined;

    return {
        rows,
        offer,
        forward: { requested: focus?.kind === 'forward', onHandled: handled },
        doneTitleSignal,
    };
}

/** Whether two focus requests name the same control. Pure. */
function sameRequest(a: FocusRequest, b: FocusRequest): boolean {
    return a.kind === 'primary' ? b.kind === 'primary' && a.id === b.id : a.kind === b.kind;
}
