'use client';

/**
 * @module CookingTopBar — the web cooking top bar.
 *
 * Exit, then the place. Exit is ONE quiet `md` control, the × and the word together, with one accessible name. The
 * place is plain text.
 * Under 360 wide the place drops to its own full-width row; the Exit label stays.
 *
 * Presentational: props → JSX.
 */
import { Button } from '@commise/ui/button';
import type { FC } from 'react';

import type { CookingTopBarProps } from './cookingViewProps.js';
import { nameOf } from './cookingCopy.js';
import { NARROW_ROW } from './cookingLayout.js';

/** The web cooking top bar. */
export const CookingTopBar: FC<CookingTopBarProps> = ({ exit, place }) => (
    <header className="flex flex-wrap items-center gap-1 px-3 py-2">
        <Button variant="quiet" icon="x" onPress={exit.onPress} {...nameOf(exit)}>
            {exit.label}
        </Button>
        {place === undefined ? null : (
            <p
                className={`min-w-fit flex-1 px-2 text-body ${place.tone === 'muted' ? 'text-ink-muted' : 'text-ink'} ${NARROW_ROW.placeWebClassName}`}
            >
                {place.text}
            </p>
        )}
    </header>
);
