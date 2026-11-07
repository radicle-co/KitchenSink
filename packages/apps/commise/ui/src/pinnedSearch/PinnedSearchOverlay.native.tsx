/**
 * @module @commise/ui/pinned-search — the pinned field and its band, drawn once above a list (native).
 *
 * @pattern Overlay — the field is drawn once above the list over a spacer the list holds
 * @pattern Adapter over the host's `Animated.Value` scroll offset, hence the style exemptions below
 */
import type { FC } from 'react';
import { Animated } from 'react-native';
import { styled, View } from 'tamagui';

import { SearchField } from '../searchField/SearchField.native.js';
import type { SearchFieldProps } from '../searchField/props.js';
import { nativeTokens } from '../tokens/native.js';
import { PINNED_TOP_PX, type PinnedSearch } from './usePinnedSearch.native.js';

/** Presentational: the layer above a list for the pinned search field. It takes no touches itself; the field inside does. */
const SearchOverlay = styled(View, {
    name: 'PinnedSearchOverlay',
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    pointerEvents: 'box-none',
});

/**
 * Presentational: the band behind the pinned field, the canvas colour with a lineDivider hairline on its bottom edge only and no
 * shadow. It fills the animated box the overlay sizes and places, so card text that scrolls under a pinned field does not show
 * above or beside it.
 */
const SearchBand = styled(View, {
    name: 'PinnedSearchBand',
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '$canvas',
    borderBottomWidth: 1,
    borderBottomColor: '$lineDivider',
});

/** Props for {@link PinnedSearchOverlay}. */
export interface PinnedSearchOverlayProps {
    readonly pin: PinnedSearch;
    /** The field's props; focus is the pinned search's to wire. */
    readonly field: Omit<SearchFieldProps, 'onFocus' | 'onBlur' | 'focusSignal'>;
}

/**
 * The field and its band, a later sibling of the list so it draws above the cards, over the spacer the list holds for it. It slides
 * with the scroll on the native side and stops at the top; its parent never changes, so the field never remounts and keeps focus and
 * the keyboard. Hidden until the spacer has been measured.
 *
 * Orchestration: it owns the animated box that carries the slide and reports the field's height upward.
 *
 * @param props - The pinned search and the field's props.
 * @returns The overlay.
 */
export const PinnedSearchOverlay: FC<PinnedSearchOverlayProps> = ({ pin, field }) => (
    <SearchOverlay>
        <Animated.View
            aria-hidden={!pin.fieldReachable}
            onLayout={(event) => {
                const { height } = event.nativeEvent.layout;

                pin.onFieldHeight(height);
            }}
            // NATIVE-STYLE-ADAPTER: the slide is a native-driven Animated transform over the host's scroll offset
            style={{
                position: 'absolute',
                left: pin.spacer?.x ?? 0,
                width: pin.spacer?.width,
                opacity: pin.spacer === null ? 0 : 1,
                transform: [{ translateY: pin.searchPin.translateY }],
            }}
        >
            {/* The canvas band behind the pinned field: from the frame's top (8 above the pinned field) to 8 below it, the full width of
                the screen. It rides this box's own native translate, so it never lags the field, and it takes no touches. */}
            <Animated.View
                pointerEvents="none"
                // NATIVE-STYLE-ADAPTER: the band's opacity is a native-driven Animated value, and its box is measured
                style={{
                    position: 'absolute',
                    top: -PINNED_TOP_PX,
                    left: -(pin.spacer?.x ?? 0),
                    width: pin.windowWidth,
                    height: PINNED_TOP_PX + pin.fieldHeight + nativeTokens.spacing[2],
                    opacity: pin.searchPin.bandOpacity,
                }}
            >
                <SearchBand aria-hidden testID="searchBand" />
            </Animated.View>
            <SearchField {...field} onFocus={pin.onFieldFocus} onBlur={pin.onFieldBlur} focusSignal={pin.focusAsks} />
        </Animated.View>
    </SearchOverlay>
);
