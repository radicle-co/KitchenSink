/**
 * @module CookingTimerOffer — the "Time 20 min" offer under a step: one house button.
 *
 * Presentational: props → JSX.
 */
import { Button } from '@commise/ui/button';
import type { FC } from 'react';
import { View } from 'tamagui';

import type { CookingTimerOfferProps } from './CookingTimerOffer.js';

/** The native offer. */
export const CookingTimerOffer: FC<CookingTimerOfferProps> = ({ offer }) => (
    <View paddingHorizontal="$2">
        <Button
            variant="secondary"
            onPress={offer.onPress}
            focusRequested={offer.focusRequested}
            onFocusRequestHandled={offer.onFocusRequestHandled}
        >
            {offer.label}
        </Button>
    </View>
);
