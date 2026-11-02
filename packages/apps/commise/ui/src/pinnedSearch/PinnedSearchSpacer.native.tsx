/**
 * @module @commise/ui/pinned-search — the header's slot for the pinned field, and its screen-reader stand-in (native).
 *
 * @pattern Overlay — the slot the list holds so the field can be drawn once above it
 */
import type { FC } from 'react';
import { Pressable } from 'react-native';

import { nativeTokens } from '../tokens/native.js';
import type { PinnedSearch } from './usePinnedSearch.native.js';

/** Props for {@link PinnedSearchSpacer}. */
export interface PinnedSearchSpacerProps {
    readonly pin: PinnedSearch;
    /** The field's accessible name, which the stand-in takes. */
    readonly label: string;
    /** In compact height the spacer shares a wrapping row with the heading. */
    readonly compact: boolean;
}

/**
 * The header's slot for the pinned field, and the field's STAND-IN for a screen reader: the drawn field sits after the list, so a
 * swipe would reach it behind every card, while this sits where the field shows. A press hands the cook to the real field.
 *
 * Orchestration: it reports its own layout upward and presses through to the hook's focus request.
 *
 * @param props - The pinned search, the field's name and whether the header is compact.
 * @returns A blank pressable the field's size.
 */
export const PinnedSearchSpacer: FC<PinnedSearchSpacerProps> = ({ pin, label, compact }) => (
    // A plain React Native Pressable, not a Tamagui one: its `onLayout` is what places the field, and the test lane can drive only
    // React Native's.
    <Pressable
        accessibilityRole="search"
        aria-label={label}
        aria-hidden={pin.fieldReachable}
        onPress={pin.askFocus}
        // NATIVE-STYLE-ADAPTER: the spacer is as tall as the measured field, a number no token holds
        style={{
            height: pin.fieldHeight,
            ...(compact ? { flexGrow: 1, flexBasis: 240, minWidth: 0 } : { marginHorizontal: nativeTokens.spacing[4] }),
        }}
        onLayout={(event) => {
            // Read NOW: the renderer releases the event when this handler returns, and the updater that records it runs later, in
            // render, when `event.nativeEvent` is null.
            const { layout } = event.nativeEvent;

            pin.onSpacerLayout(layout);
        }}
    />
);
