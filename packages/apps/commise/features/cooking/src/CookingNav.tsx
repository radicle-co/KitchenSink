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

import type { CookingAction, CookingNavProps } from './cookingViewProps.js';
import { NARROW_ROW } from './cookingLayout.js';

/** The accessible-name prop of a Button, only when the action has a fuller name than its label. */
const nameOf = (action: CookingAction): { accessibilityLabel?: string } =>
    action.accessibilityLabel === undefined ? {} : { accessibilityLabel: action.accessibilityLabel };

/** The web Back / forward pair. */
export const CookingNav: FC<CookingNavProps> = ({ back, forward, disabled }) => (
    <nav className="px-4 pb-4 pt-2">
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
