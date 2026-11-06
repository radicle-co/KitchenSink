/**
 * @module @commise/features-recipes/format — a text that shows recipe amounts, on the web (UI Designer ruling Q5).
 *
 * The eye reads "1½ cups"; a screen reader hears "1 and a half cups". The visible text is hidden from assistive
 * technology and the words sit beside it, visually hidden. A text with nothing to say differently renders as it is.
 *
 * Web only. A native leaf puts the same words in its own `accessibilityLabel`, because React Native reads a nested
 * `Text` as part of its parent and would ignore a label on the inner one.
 */
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

import { recipeMessages } from '../messages.js';
import { spokenAmountsLabel } from './cookAmount.js';

/** The text, as a surface formatted it. */
export interface AmountTextProps {
    readonly text: string;
}

export const AmountText: FC<AmountTextProps> = ({ text }) => {
    const { amountWords } = useMessages(recipeMessages);
    // No second copy when the text already says itself: a duplicate of every amount would make each line's text appear
    // twice to anything that searches the page by text.
    const spoken = spokenAmountsLabel(text, amountWords);

    if (spoken === undefined) {
        return text;
    }

    return (
        <>
            <span aria-hidden="true">{text}</span>
            <span className="sr-only">{spoken}</span>
        </>
    );
};
