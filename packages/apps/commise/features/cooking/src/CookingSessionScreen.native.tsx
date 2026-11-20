/**
 * @module CookingSessionScreen — the session-level orchestration of native cooking mode: the steps and Done. Mounted by
 * `CookingScreen` only once the recipe has steps to cook. The model is `useCookingSessionScreen`'s, shared with web; this
 * screen draws it and adds only what is native's own: the three window facts it is handed (narrow, short, width), the
 * step swipe, the polite announcement of a step change and screen-reader focus on Done's title (inside `CookingDone`).
 * The read-level states are `CookingScreen`'s, so the read always wins over the session.
 *
 * @pattern Mediator — the session model, the swipe rule and the render components meet here, so no render component knows another
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { LiveRegion } from '@commise/ui/live-region';
import type { FC } from 'react';
import { YStack } from 'tamagui';

import { CookingDone } from './CookingDone.native.js';
import { CookingDoneActions } from './CookingDoneActions.native.js';
import { CookingFrame } from './CookingFrame.native.js';
import { CookingNav } from './CookingNav.native.js';
import { CookingNextPreview } from './CookingNextPreview.native.js';
import { CookingStep } from './CookingStep.native.js';
import { CookingTopBar } from './CookingTopBar.native.js';
import { isTwoColumn } from './cookingLayout.js';
import type { CookingRecipe } from './cookingViewProps.js';
import { CookingIngredientsColumn } from './ingredients/CookingIngredientsColumn.native.js';
import { CookingIngredientsSheet } from './ingredients/CookingIngredientsSheet.js';
import { CookingScaleNote } from './ingredients/CookingScaleNote.native.js';
import { useCookingIngredientsPanel } from './ingredients/useCookingIngredientsPanel.js';
import { cookingMessages } from './messages.js';
import { stepSwipeResponderOf } from './stepSwipeResponder.native.js';
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
    /** Under 640 tall, in text: the Next preview is the last item of the scrolling step, not the foot's. */
    readonly previewInBody: boolean;
    /** The window's width, for the swipe's far edge zone. */
    readonly width: number;
}

/** The native cooking session. */
export const CookingSessionScreen: FC<CookingSessionScreenProps> = ({
    recipe,
    onLeave,
    narrow,
    short,
    previewInBody,
    width,
}) => {
    const model = useCookingSessionScreen({ recipe, onLeave });
    const panel = useCookingIngredientsPanel({
        recipe,
        copy: useMessages(cookingMessages),
        locale: useLocale(),
        wide: isTwoColumn(width),
    });
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

    const { nav, preview } = model;
    const previewNode =
        preview === undefined ? null : <CookingNextPreview preview={preview} short={short && !previewInBody} />;

    return (
        <>
            <CookingFrame
                busy={false}
                {...(panel.column === undefined ? {} : { column: <CookingIngredientsColumn {...panel.column} /> })}
                topBar={
                    <CookingTopBar
                        exit={model.exit}
                        place={{ text: model.place, tone: 'ink' }}
                        narrow={narrow}
                        {...(panel.topAction === undefined ? {} : { ingredients: panel.topAction })}
                    />
                }
                bodySwipe={stepSwipeResponderOf({ width, hasPrevious, hasNext, onNext: goForward, onBack: goBack })}
                body={
                    <>
                        <CookingStep
                            {...model.step}
                            focusRequested={focus.target === 'focusLine'}
                            onFocusHandled={focus.handled}
                        />
                        {panel.scaleNote === undefined ? null : (
                            <YStack paddingHorizontal="$4" paddingBottom="$4">
                                <CookingScaleNote {...panel.scaleNote} />
                            </YStack>
                        )}
                        <LiveRegion politeness="polite" visuallyHidden announceOnMount occurrence={model.moves}>
                            {model.announcement}
                        </LiveRegion>
                        {previewInBody ? previewNode : null}
                    </>
                }
                foot={{
                    ...(previewInBody || previewNode === null ? {} : { preview: previewNode }),
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
            {panel.sheet === undefined ? null : <CookingIngredientsSheet {...panel.sheet} />}
        </>
    );
};
