'use client';

/**
 * @module CookingTimerOffer — the "Time 20 min" offer under a step: one house button.
 *
 * Presentational: props → JSX.
 */
import { Button } from '@commise/ui/button';
import type { FC } from 'react';

import type { DockControl } from './timer/useCookingTimerDock.js';

/** Props for {@link CookingTimerOffer}. */
export interface CookingTimerOfferProps {
    readonly offer: DockControl;
}

/** The web offer. */
export const CookingTimerOffer: FC<CookingTimerOfferProps> = ({ offer }) => (
    <div className="px-2">
        <Button
            variant="secondary"
            onPress={offer.onPress}
            focusRequested={offer.focusRequested}
            onFocusRequestHandled={offer.onFocusRequestHandled}
        >
            {offer.label}
        </Button>
    </div>
);
