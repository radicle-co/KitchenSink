/**
 * @module @commise/features-recipes/form — `AmountRun` (native): the React Native leaf of `./AmountRun.tsx`. The amount in
 * the strong face (`figureInline` has none of its own size and takes its parent's), an ordinary space, then the words, as
 * one text run. Styled with Tamagui only.
 *
 * Presentational: `props → JSX`.
 */
import { Text } from '@commise/ui/text';
import type { FC } from 'react';

import type { AmountRunProps } from './AmountRun.js';

/** An ingredient line's text run. */
export const AmountRun: FC<AmountRunProps> = ({ amount, children }) => (
    <Text typeRole="body" color="$ink">
        {amount === '' ? null : (
            <>
                <Text typeRole="figureInline" color="$ink">
                    {amount}
                </Text>{' '}
            </>
        )}
        {children}
    </Text>
);
