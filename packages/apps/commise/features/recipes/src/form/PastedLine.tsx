/**
 * @module @commise/features-recipes/form — `PastedLine` (web): a pasted line as the cook wrote it, its measure set
 * heavier than its words, as the ingredient-matching boards draw it. One block of text, so it reads as one line and can sit inside a control, and it
 * wraps rather than truncating.
 *
 * Presentational: props in, markup out. The native leaf is `./PastedLine.native.tsx`.
 */
import type { FC } from 'react';

import type { PastedLineProps } from './pastedLineProps.js';

/** The line as the cook wrote it. */
export const PastedLine: FC<PastedLineProps> = ({ line }) => (
    <span className="block break-words text-body-md text-ink">
        {line.measure !== '' && <span className="font-semibold">{line.measure}</span>}
        {line.measure !== '' && ' '}
        {line.words}
    </span>
);
