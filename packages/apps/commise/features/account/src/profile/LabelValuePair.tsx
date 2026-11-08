/**
 * @module @commise/features-account/profile/LabelValuePair — a label with its value (web): beside it, the value at the
 * end of the line, or under it at the start, 4 px below, when the group's column (its `rows` container, `ProfileGroup`)
 * has less than 17.5 rem of room (designer rulings 2026-11-01, `nativeBoards/designAnswers.md`). 17.5 rem is native's
 * 280 at the default text size, and a rem follows the browser's text size. `ProfileFactRow` and `ProfileRow` draw their
 * label and value through it. A pair with no `rows` container above it never stacks.
 *
 * The label is the caller's own element and a direct flex child, so its minimum width is its longest word and it never
 * breaks inside one. The value wraps anywhere and never truncates. Each variant is written out whole, because Tailwind
 * generates only the class names it finds.
 *
 * Presentational: props → JSX.
 */
import type { FC } from 'react';

import type { LabelValuePairProps } from './props.js';

/** The pair's box: a row with room, a column below 17.5 rem of it. */
const PAIR =
    'flex min-w-0 flex-1 items-center justify-between gap-3 @max-[17.5rem]/rows:flex-col ' +
    '@max-[17.5rem]/rows:items-start @max-[17.5rem]/rows:justify-center @max-[17.5rem]/rows:gap-1';

/** The value: at the end with room, at the start stacked; it wraps anywhere. */
const VALUE = 'min-w-0 text-end text-body text-ink-muted [overflow-wrap:anywhere] @max-[17.5rem]/rows:text-start';

/** The label and its value. */
export const LabelValuePair: FC<LabelValuePairProps> = ({ label, value, valueId }) => (
    <span className={PAIR}>
        {label}
        <span {...(valueId === undefined ? {} : { id: valueId })} className={VALUE}>
            {value}
        </span>
    </span>
);
