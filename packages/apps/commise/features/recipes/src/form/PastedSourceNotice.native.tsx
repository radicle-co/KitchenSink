/**
 * @module @commise/features-recipes/form — `PastedSourceNotice` (native): the presentational React Native leaf of
 * `./PastedSourceNotice.tsx`, on the same props and words. Styled with Tamagui only (ADR-0080). The Remove hugs its label
 * at the start of the row rather than stretching across it. It holds a ref only so a refusal the cook must read can take the
 * screen reader's focus and be scrolled into view. With no text it shows nothing, so a host can keep it mounted and the
 * first refusal still counts as a change of its signal.
 *
 * @pattern Adapter over `useScreenReaderFocusOnSignal` — the accessibility focus event the host's signal asks for
 * @pattern Adapter over `useFieldStartReveal` — the scroll the same signal asks of the screen's `ScrollHost`
 */
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { useFieldStartReveal } from '@commise/ui/field-reveal';
import { useOptionalScrollHost } from '@commise/ui/scroll-host';
import { useScreenReaderFocusOnSignal } from '@commise/ui/screen-reader-focus';
import { Text } from '@commise/ui/text';
import { useEffect, useEffectEvent, useState, type FC } from 'react';
import { View } from 'react-native';
import { YStack } from 'tamagui';

import { editorMessages } from '../editor/messages.js';
import type { PastedSourceNoticeProps } from './pastedSourceNoticeProps.js';

/** The id the screen's scroller counts this notice under; no field shares it. */
const NOTICE_ID = 'sourceNotice';

/** What a paste did to the Source, under the paste control. */
export const PastedSourceNotice: FC<PastedSourceNoticeProps> = ({ text, onRemove, focusSignal = 0 }) => {
    const { source: m } = useMessages(editorMessages);
    const notice = useScreenReaderFocusOnSignal<View>(focusSignal);
    const host = useOptionalScrollHost();
    const [mountedAt] = useState(focusSignal);
    // Reads the host as it is when the signal rises: the host's API changes with every scroll, and only a rise may ask.
    const show = useEffectEvent((): void => {
        host?.showIfHidden(NOTICE_ID);
    });

    useFieldStartReveal(NOTICE_ID, notice);
    useEffect(() => {
        if (focusSignal > mountedAt) {
            show();
        }
    }, [focusSignal, mountedAt]);

    if (text === '') {
        return null;
    }

    return (
        // An unstyled `View` holds the ref: the scroller measures a React Native node, and Tamagui's ref type is not one.
        <View ref={notice}>
            <YStack gap="$1" alignItems="flex-start">
                <Text typeRole="meta" color="$inkMuted">
                    {text}
                </Text>
                {onRemove === undefined ? null : (
                    <Button variant="ghost" onPress={onRemove}>
                        {m.snackRemove}
                    </Button>
                )}
            </YStack>
        </View>
    );
};
