'use client';

/**
 * @module CookingLineRow — one line of a cooking step, as the web checkbox the cook ticks.
 *
 * The whole row is the control: a `button` with `role="checkbox"`, named by the line's text, at least 44 px tall, as
 * the recipe page's ingredient row is. The focus line is set in the focus-line type seam; every other line in `readingBody`. A ticked line dims to `inkMuted`, never struck through.
 *
 * Presentational: props → JSX.
 */
import { CheckBoxGlyph } from '@commise/ui/check-box-glyph';
import { FOCUS_RING_CLASS } from '@commise/ui/focus-ring';
import { PRESS_FILL_CLASS } from '@commise/ui/surface-tone';
import type { FC } from 'react';

import type { CookingLineRowProps } from './cookingViewProps.js';
import { LINE_TYPE } from './focusLineType.js';

/** The id of the focus line's row, so focus can be sent to it when the row it was on goes away. */
export const COOKING_FOCUS_LINE_ID = 'cooking-focus-line';

/** The web cooking line row. */
export const CookingLineRow: FC<CookingLineRowProps> = ({ line, emphasis }) => (
    <button
        type="button"
        id={emphasis === 'focus' ? COOKING_FOCUS_LINE_ID : undefined}
        role="checkbox"
        aria-checked={line.checked}
        aria-label={line.text}
        onClick={line.onToggle}
        className={`flex min-h-11 w-full items-start gap-3 rounded-md px-2 py-2 text-start ${PRESS_FILL_CLASS.pointer} ${FOCUS_RING_CLASS.inset}`}
    >
        <CheckBoxGlyph checked={line.checked} textRole={LINE_TYPE[emphasis].nativeTypeRole} />
        <span
            className={`min-w-0 flex-1 break-words font-body ${LINE_TYPE[emphasis].webClassName} ${line.checked ? 'text-ink-muted' : 'text-ink'}`}
        >
            {line.text}
        </span>
    </button>
);
