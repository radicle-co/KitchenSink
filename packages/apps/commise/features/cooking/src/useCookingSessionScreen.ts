'use client';

/**
 * @module useCookingSessionScreen — the model of the cooking session screen, shared by both platforms' screens: the
 * session, the screen-on hold, the step move handlers, the place, the nav pair, the step view and the Done view. A
 * screen only draws it and adds what is its own platform's (web: the arrow keys and the Done focus).
 *
 * @pattern Presentation Model — the session screen's display state derived once, so both platforms only draw it
 */
import { fillTemplate, pluralOf } from '@commise/i18n';
import { useLocale, useMessages } from '@commise/i18n/react';
import { useState } from 'react';

import { exitOf, navOf, type CookingNav } from './cookingCopy.js';
import { cookingStepViewOf } from './cookingStepView.js';
import type {
    CookingAction,
    CookingDoneActionsProps,
    CookingDoneProps,
    CookingPreviewView,
    CookingRecipe,
    CookingStepProps,
} from './cookingViewProps.js';
import { cookingMessages } from './messages.js';
import { cookingSessionStateOf } from './screenState.js';
import { useCookingKeepAwake } from './useCookingKeepAwake.js';
import { useCookingSession, type UseCookingSessionResult } from './useCookingSession.js';

/** What a screen needs to draw Done: the body's props and the two actions. */
export interface CookingDoneView extends CookingDoneProps, CookingDoneActionsProps {}

/** What {@link useCookingSessionScreen} hands a screen. */
export interface CookingSessionScreenModel {
    readonly session: UseCookingSessionResult;
    /** "Step 2 of 6", the step region's name and the top bar's place. */
    readonly place: string;
    readonly exit: CookingAction;
    readonly nav: CookingNav;
    readonly step: CookingStepProps;
    /** The next step's one-line preview for the pinned foot; absent once every line is ticked and on the last step. */
    readonly preview?: CookingPreviewView;
    /** What the live region says after a move. */
    readonly announcement: string;
    /** How many times the cook has moved between steps: the live region speaks only after a move. */
    readonly moves: number;
    readonly goForward: () => void;
    /** Back on step 1 leaves through `onLeave`. */
    readonly goBack: () => void;
    readonly hasPrevious: boolean;
    readonly hasNext: boolean;
    /** Done's view, or `null` while the cook is on a step. */
    readonly done: CookingDoneView | null;
}

/**
 * The cooking session screen's model.
 *
 * @param input - The recipe to cook, and where Exit and Back on step 1 go (the recipe page).
 * @returns The model. Opening the session is the hook's, so the recipe is read once.
 * @sideEffect Holds and releases the screen-on lock; opens and advances the session.
 */
export function useCookingSessionScreen({
    recipe,
    onLeave,
}: {
    readonly recipe: CookingRecipe;
    readonly onLeave: () => void;
}): CookingSessionScreenModel {
    const copy = useMessages(cookingMessages);
    const locale = useLocale();
    const session = useCookingSession({ recipeId: recipe.id, steps: recipe.steps });
    const { keepAwakeAvailable } = useCookingKeepAwake(session.status);
    const [moves, setMoves] = useState(0);
    // The step whose ticked lines are open. Held as a step, not a flag, so Show is closed again on every other step.
    const [openTickedStep, setOpenTickedStep] = useState<number | null>(null);
    const { place: where } = session;
    const place = fillTemplate(copy.top.place, { current: where.position, total: where.total });
    const { step, preview } = cookingStepViewOf({
        session,
        copy,
        locale,
        label: place,
        expanded: openTickedStep === where.position,
        onToggleShow: () => setOpenTickedStep((open) => (open === where.position ? null : where.position)),
    });
    const focusText = session.focusLine === null ? undefined : session.step.lines[session.focusLine];
    const announcement =
        focusText === undefined
            ? fillTemplate(copy.step.announceNoLine, { current: where.position, total: where.total })
            : fillTemplate(copy.step.announce, { current: where.position, total: where.total, line: focusText });
    const finished =
        cookingSessionStateOf({ sessionStatus: session.status, everyLineTicked: session.everyLineTicked }).kind ===
        'done';

    return {
        session,
        place,
        exit: exitOf(copy.top, onLeave),
        nav: navOf({ place: where, everyLineTicked: session.everyLineTicked, copy: copy.nav }),
        step,
        ...(preview === undefined ? {} : { preview }),
        announcement,
        moves,
        goForward: () => {
            session.next();
            setMoves((count) => count + 1);
        },
        goBack: () => {
            if (where.previous === null) {
                onLeave();

                return;
            }

            session.back();
            setMoves((count) => count + 1);
        },
        hasPrevious: where.previous !== null,
        hasNext: where.next !== null,
        done: finished
            ? {
                  title: pluralOf(copy.done.title, where.total, locale),
                  enjoy: fillTemplate(copy.done.enjoy, { recipe: recipe.title }),
                  ...(keepAwakeAvailable ? { screenOff: copy.done.screenOff } : {}),
                  backToRecipe: { label: copy.done.backToRecipe, onPress: onLeave },
                  cookAgain: { label: copy.done.cookAgain, onPress: session.cookAgain },
              }
            : null,
    };
}
