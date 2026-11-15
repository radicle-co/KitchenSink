/**
 * @module CookingSessionScreen — the session-level orchestration of native cooking mode: the steps and Done. Mounted by
 * `CookingScreen` only once the recipe has steps to cook. The model is `useCookingSessionScreen`'s, shared with web; this
 * screen draws it and adds only what is native's own: the three window facts it is handed (narrow, short, width), the
 * step swipe, the polite announcement of a step change and screen-reader focus on Done's title (inside `CookingDone`).
 * The read-level states are `CookingScreen`'s, so the read always wins over the session.
 *
 * @pattern Mediator — the session model, the swipe rule and the render components meet here, so no render component knows another
 */
import { LiveRegion } from '@commise/ui/live-region';
import type { FC } from 'react';
import type { GestureResponderEvent } from 'react-native';

import { CookingDone } from './CookingDone.native.js';
import { CookingDoneActions } from './CookingDoneActions.native.js';
import { CookingFrame } from './CookingFrame.native.js';
import { CookingNav } from './CookingNav.native.js';
import { CookingNextPreview } from './CookingNextPreview.native.js';
import { CookingStep } from './CookingStep.native.js';
import { CookingTopBar } from './CookingTopBar.native.js';
import type { CookingRecipe } from './cookingViewProps.js';
import { stepSwipeOf, swipeTravelOf, type StepSwipe } from './stepSwipe.js';
import { useCookingFocusRecovery } from './useCookingFocusRecovery.native.js';
import { useCookingSessionScreen } from './useCookingSessionScreen.js';

/** Props for {@link CookingSessionScreen}. */
export interface CookingSessionScreenProps {
    /** The recipe to cook, read once when the session opens. */
    readonly recipe: CookingRecipe;
    /** Exit, Back on step 1 and Back to the recipe: to the recipe page. */
    readonly onLeave: () => void;
    /** Under 360 wide, in text: the place takes its own row and the quiet controls drop their chevrons. */
    readonly narrow: boolean;
    /** Under 700 tall, in text: the pinned Next preview shows one line. */
    readonly short: boolean;
    /** The window's width, for the swipe's far edge zone. */
    readonly width: number;
}

/** The native cooking session. */
export const CookingSessionScreen: FC<CookingSessionScreenProps> = ({ recipe, onLeave, narrow, short, width }) => {
    const model = useCookingSessionScreen({ recipe, onLeave });
    const { done, hasPrevious, hasNext, goForward, goBack } = model;
    const focus = useCookingFocusRecovery({
        moves: model.moves,
        tickedCount: model.session.tickedCount,
        everyLineTicked: model.session.everyLineTicked,
        finished: done !== null,
    });

    if (done !== null) {
        return (
            <CookingFrame
                topBar={<CookingTopBar exit={model.exit} narrow={narrow} />}
                busy={false}
                body={<CookingDone title={done.title} enjoy={done.enjoy} screenOff={done.screenOff} />}
                foot={{
                    actions: <CookingDoneActions backToRecipe={done.backToRecipe} cookAgain={done.cookAgain} />,
                }}
            />
        );
    }

    // The body area takes a drag from the scroller and the line rows only once it is a whole swipe, so a tap that wobbles
    // is still a tap. At release the swipe rule decides again, and the move takes the same path as the buttons.
    const swipeOf = (event: GestureResponderEvent): StepSwipe | null => {
        const travel = swipeTravelOf(event);

        return travel === null ? null : stepSwipeOf({ ...travel, width, hasPrevious, hasNext });
    };

    const releaseSwipe = (event: GestureResponderEvent): void => {
        const move = swipeOf(event);

        if (move === 'next') {
            goForward();
        } else if (move === 'back') {
            goBack();
        }
    };

    const { nav, preview } = model;

    return (
        <CookingFrame
            busy={false}
            topBar={<CookingTopBar exit={model.exit} place={{ text: model.place, tone: 'ink' }} narrow={narrow} />}
            bodySwipe={{
                onMoveShouldSetResponder: (event) => swipeOf(event) !== null,
                onResponderRelease: releaseSwipe,
            }}
            body={
                <>
                    <CookingStep
                        {...model.step}
                        focusRequested={focus.target === 'focusLine'}
                        onFocusHandled={focus.handled}
                    />
                    <LiveRegion politeness="polite" visuallyHidden announceOnMount occurrence={model.moves}>
                        {model.announcement}
                    </LiveRegion>
                </>
            }
            foot={{
                ...(preview === undefined ? {} : { preview: <CookingNextPreview preview={preview} short={short} /> }),
                actions: (
                    <CookingNav
                        disabled={false}
                        narrow={narrow}
                        forwardFocusRequested={focus.target === 'forward'}
                        onFocusHandled={focus.handled}
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
