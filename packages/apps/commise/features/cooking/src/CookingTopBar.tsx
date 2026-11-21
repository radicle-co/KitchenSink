'use client';

/**
 * @module CookingTopBar — the web cooking top bar.
 *
 * Exit, then the place, then, while the screen gives `ingredients`, the quiet Ingredients button with its `listChecks`
 * glyph and its label whole. Exit is ONE quiet `md` control, the × and the word together, with one accessible name.
 * The place is plain text. The bar is one tree in the order Exit, Ingredients, place: under 360 wide the place drops
 * to its own full-width row under Exit and Ingredients, which stay side by side while they fit, and the Exit label
 * stays. Wide, an `order` class moves Ingredients after the place, so the place takes the free space.
 *
 * Presentational: props → JSX.
 */
import { Button } from '@commise/ui/button';
import type { FC } from 'react';

import type { CookingTopBarProps } from './cookingViewProps.js';
import { nameOf } from './cookingCopy.js';
import { NARROW_ROW } from './cookingLayout.js';

/** The web cooking top bar. */
export const CookingTopBar: FC<CookingTopBarProps> = ({ exit, place, ingredients }) => (
    <header className="flex flex-wrap items-center gap-1 px-3 py-2">
        <Button variant="quiet" icon="x" onPress={exit.onPress} {...nameOf(exit)}>
            {exit.label}
        </Button>
        {ingredients === undefined ? null : (
            <div className={NARROW_ROW.ingredientsWebClassName}>
                <Button variant="quiet" icon="listChecks" onPress={ingredients.onPress} {...nameOf(ingredients)}>
                    {ingredients.label}
                </Button>
            </div>
        )}
        {place === undefined ? null : (
            <p
                className={`min-w-fit flex-1 px-2 text-body ${place.tone === 'muted' ? 'text-ink-muted' : 'text-ink'} ${NARROW_ROW.placeWebClassName}`}
            >
                {place.text}
            </p>
        )}
    </header>
);
