'use client';

/**
 * @module CookingNav — the web Back / forward pair at the foot of the cooking column.
 *
 * Two equal halves of one row, both the house `Button size="lg"` (52). Back is first and forward is last in reading
 * order, so forward sits on the reach side. Forward is quiet (the neutral secondary surface) until it is the action
 * now ("Start step n", "Finish" once every line is ticked); the screen says which with `tone`. Under 360
 * wide the chevrons hide and the labels stay whole.
 *
 * Presentational: props → JSX.
 */
import { Button } from '@commise/ui/button';
import type { FC } from 'react';

import { nameOf } from './cookingCopy.js';
import { NARROW_ROW } from './cookingLayout.js';
import type { CookingNavProps } from './cookingViewProps.js';

/** The id of the pair's `nav`: the forward control is its last button, so focus can be sent to it. */
export const COOKING_NAV_ID = 'cooking-nav';

/** The web Back / forward pair. */
export const CookingNav: FC<CookingNavProps> = ({ back, forward, disabled }) => (
    <nav id={COOKING_NAV_ID} className="px-4 pb-4 pt-2">
        <div className={`grid grid-cols-2 gap-3 ${NARROW_ROW.navWebClassName}`}>
            <Button
                variant="secondary"
                size="lg"
                width="fill"
                icon="chevronLeft"
                disabled={disabled}
                onPress={back.onPress}
                {...nameOf(back)}
            >
                {back.label}
            </Button>
            <Button
                variant={forward.tone === 'filled' ? 'primary' : 'secondary'}
                size="lg"
                width="fill"
                icon="chevronRight"
                iconPlacement="end"
                disabled={disabled}
                onPress={forward.onPress}
                {...nameOf(forward)}
            >
                {forward.label}
            </Button>
        </div>
    </nav>
);
