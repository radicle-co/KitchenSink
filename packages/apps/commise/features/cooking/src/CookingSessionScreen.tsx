'use client';

/**
 * @module CookingSessionScreen — the session-level orchestration of web cooking mode: the steps and Done. Mounted by
 * `CookingScreen` only once the recipe has steps to cook, so the session never opens on an empty recipe. The model is
 * `useCookingSessionScreen`'s; this screen draws it and adds the web's own behaviour: the ← / → keys, the swipe, the
 * polite announcement of a step change, and moving focus to Done's title. The read-level states (loading, error, gone, no
 * steps) are `CookingScreen`'s, so the read always wins over the session.
 *
 * @pattern Mediator — the session model, the web's key and swipe adapters and the render components meet here, so no render component knows another
 */
import { LiveRegion } from '@commise/ui/live-region';
import { useEffect, type FC } from 'react';

import { COOKING_DONE_TITLE_ID, CookingDone } from './CookingDone.js';
import { CookingDoneActions } from './CookingDoneActions.js';
import { CookingFrame } from './CookingFrame.js';
import { CookingNav } from './CookingNav.js';
import { CookingNextPreview } from './CookingNextPreview.js';
import { CookingStep } from './CookingStep.js';
import { CookingTopBar } from './CookingTopBar.js';
import type { CookingRecipe } from './cookingViewProps.js';
import { useArrowKeys } from './useArrowKeys.js';
import { useCookingFocusRecovery } from './useCookingFocusRecovery.js';
import { useCookingSessionScreen } from './useCookingSessionScreen.js';
import { useStepSwipe } from './useStepSwipe.js';

/** Props for {@link CookingSessionScreen}. */
export interface CookingSessionScreenProps {
    /** The recipe to cook, read once when the session opens. */
    readonly recipe: CookingRecipe;
    /** Exit, Back on step 1 and Back to the recipe: to the recipe page. */
    readonly onLeave: () => void;
}

/** The web cooking session. */
export const CookingSessionScreen: FC<CookingSessionScreenProps> = ({ recipe, onLeave }) => {
    const model = useCookingSessionScreen({ recipe, onLeave });
    const { done, hasPrevious, hasNext, goForward, goBack } = model;
    const finished = done !== null;

    // Focus has no declarative form, so Done's title takes it in an effect, found by its id: a ref would need an entry
    // in the ref register for one focus call.
    useEffect(() => {
        if (finished) {
            document.getElementById(COOKING_DONE_TITLE_ID)?.focus();
        }
    }, [finished]);

    useCookingFocusRecovery({
        moves: model.moves,
        tickedCount: model.session.tickedCount,
        everyLineTicked: model.session.everyLineTicked,
        finished,
    });

    // The keys and the swipe only move between steps: leaving on step 1 and finishing on the last are the buttons' alone.
    useArrowKeys(
        finished
            ? undefined
            : {
                  forward: () => {
                      if (hasNext) {
                          goForward();
                      }
                  },
                  back: () => {
                      if (hasPrevious) {
                          goBack();
                      }
                  },
              },
    );
    const swipe = useStepSwipe({ hasPrevious, hasNext, onNext: goForward, onBack: goBack });

    if (done !== null) {
        return (
            <CookingFrame
                topBar={<CookingTopBar exit={model.exit} />}
                busy={false}
                body={<CookingDone title={done.title} enjoy={done.enjoy} screenOff={done.screenOff} />}
                foot={{
                    actions: <CookingDoneActions backToRecipe={done.backToRecipe} cookAgain={done.cookAgain} />,
                }}
            />
        );
    }

    const { nav, preview } = model;

    return (
        <CookingFrame
            busy={false}
            topBar={<CookingTopBar exit={model.exit} place={{ text: model.place, tone: 'ink' }} />}
            body={
                <>
                    {/* The swipe surface: pan-y leaves vertical scrolling to the browser, so a sideways touch reaches us. */}
                    <div data-cooking-swipe className="touch-pan-y" {...swipe}>
                        <CookingStep {...model.step} />
                    </div>
                    <LiveRegion politeness="polite" visuallyHidden occurrence={model.moves}>
                        {model.announcement}
                    </LiveRegion>
                </>
            }
            foot={{
                ...(preview === undefined ? {} : { preview: <CookingNextPreview preview={preview} /> }),
                actions: (
                    <CookingNav
                        disabled={false}
                        back={{ label: nav.back.label, accessibilityLabel: nav.back.a11yName, onPress: goBack }}
                        forward={{
                            label: nav.forward.label,
                            accessibilityLabel: nav.forward.a11yName,
                            onPress: goForward,
                            tone: nav.forward.filled ? 'filled' : 'quiet',
                        }}
                    />
                ),
            }}
        />
    );
};
