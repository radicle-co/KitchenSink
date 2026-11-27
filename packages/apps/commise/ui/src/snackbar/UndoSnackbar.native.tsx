/**
 * @module @commise/ui/snackbar — the native {@link UndoSnackbar}: what the host draws for the snackbar on screen (spec
 * §1.11).
 *
 * `inverse` with an `inverseInk` message (12.68:1) that always wraps by words and is never clamped or cut, and its
 * action in `inverseAction` (4.56:1 on `inverse`) at a 44 pt target (48 dp on Android) that never wraps; all three from
 * the inverse tone's theme keys, so the bar inverts in either theme. The row wraps: the message asks for room
 * (`snackbarMessageBasis`, scaled with the system text size up to the cap), so when it has no room beside the action
 * the action drops to its own row under it, at the end (the web bar's rule, owner ruling for issue 409). At most
 * `snackbarMaxWidth` wide. Native has no hover and cannot see the screen-reader cursor, so `onPause`/`onResume` are not
 * wired here: the host pauses while a screen reader runs. Styled with Tamagui only (ADR-0080).
 *
 * @pattern Command (invoker) — its action is the `{ label, onAction }` command the queue carries; pressing it invokes
 *     that command and nothing else.
 */
import type { FC } from 'react';
import { Pressable, useWindowDimensions } from 'react-native';
import { styled, View } from 'tamagui';

import { Elevated } from '../elevation/Elevated.native.js';
import { touchFloor } from '../layout/touchFloor.native.js';
import { ToneScope } from '../surfaceTone/ToneScope.native.js';
import { Text } from '../text/Text.native.js';
import { cappedFontScale } from '../text/fontScaleCap.js';
import { snackbarMaxWidth, snackbarMessageBasis } from '../tokens/layout.js';
import type { SnackbarAction, UndoSnackbarProps } from './props.js';

/** The bar: the inverse fill, the level-lg shadow, and a row that wraps so Undo can drop under a long message. */
const Bar = styled(Elevated, {
    name: 'UndoSnackbarBar',
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: '$3',
    width: '100%',
    maxWidth: snackbarMaxWidth,
    borderRadius: '$md',
    paddingHorizontal: '$4',
    paddingVertical: '$2',
    backgroundColor: '$background',
    // Kept in the native tree, so the bar's own box is what a device inspection sees.
    collapsable: false,
});

/**
 * The message's box: it grows, wraps by words, and never shrinks or passes the bar. Its basis is set per text size.
 * Yoga is not CSS: a box that may shrink stays on the line beside Undo and is squeezed, so the line breaks only when
 * the box cannot shrink, on its basis held to the bar's width. The web twin shrinks, because CSS breaks the line on
 * the basis whatever the shrink is: do not align the two.
 */
const MessageBox = styled(View, {
    name: 'UndoSnackbarMessage',
    flexGrow: 1,
    flexShrink: 0,
    minWidth: 0,
    maxWidth: '100%',
});

/** Undo's slot: at the end of its row, so under a wrapped message it sits at the end. */
const ActionSlot = styled(View, {
    name: 'UndoSnackbarActionSlot',
    marginLeft: 'auto',
});

/** Undo's touch target, which fills with the inverse press row while held. */
const ActionFrame = styled(View, {
    name: 'UndoSnackbarAction',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: '$2',

    variants: {
        // The surface's press row: the inverse tone's sub-theme carries it as `backgroundPress`.
        pressed: { true: { backgroundColor: '$backgroundPress' } },
    } as const,
});

/** The Undo action. */
const UndoAction: FC<{ readonly action: SnackbarAction }> = ({ action }) => (
    <ActionSlot>
        <Pressable role="button" aria-label={action.label} onPress={action.onAction}>
            {({ pressed }) => (
                <ActionFrame pressed={pressed} minHeight={touchFloor()} minWidth={touchFloor()}>
                    <Text typeRole="label" color="$inverseAction">
                        {action.label}
                    </Text>
                </ActionFrame>
            )}
        </Pressable>
    </ActionSlot>
);

/** The native snackbar. */
export const UndoSnackbar: FC<UndoSnackbarProps> = ({ message, action }) => {
    const basis = snackbarMessageBasis * cappedFontScale(useWindowDimensions().fontScale);

    return (
        <ToneScope tone="inverse">
            <Bar level="lg">
                <MessageBox flexBasis={basis}>
                    <Text typeRole="body">{message}</Text>
                </MessageBox>
                {action === undefined ? null : <UndoAction action={action} />}
            </Bar>
        </ToneScope>
    );
};
