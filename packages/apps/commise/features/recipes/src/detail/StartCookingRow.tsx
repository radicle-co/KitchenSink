/**
 * @module @commise/features-recipes — the Start cooking row: the page's ONE filled
 * action, the house `lg` Button across the full width with the cooking pot glyph, on its own row under the fact tiles.
 * The body draws it only when the recipe can be cooked and the app bound the cooking route. One file serves both
 * platforms: `@commise/ui/button` resolves to each platform's Button, so a native twin would be this file again.
 *
 * Presentational: props → JSX.
 */
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import type { FC } from 'react';

import { recipeActionMessages } from '../actions/messages.js';
import { START_COOKING_GLYPH } from './startCookingGlyph.js';

/** Props for {@link StartCookingRow}. */
export interface StartCookingRowProps {
    /** Open cooking mode. The label is the row's own (`detailActions.startCooking`). */
    readonly onPress: () => void;
}

/** The Start cooking row. */
export const StartCookingRow: FC<StartCookingRowProps> = ({ onPress }) => {
    const { detailActions } = useMessages(recipeActionMessages);

    return (
        <Button size="lg" width="fill" icon={START_COOKING_GLYPH} onPress={onPress}>
            {detailActions.startCooking}
        </Button>
    );
};
