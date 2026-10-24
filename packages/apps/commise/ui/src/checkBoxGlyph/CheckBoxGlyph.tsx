/**
 * @module @commise/ui/check-box-glyph — the web design-system {@link CheckBoxGlyph}.
 *
 * A 24 px box: a 2 px `lineControl` outline when unchecked (a 3:1 graphic under SC 1.4.11), the `action` fill with an
 * `onAction` check when checked. The check stays mounted and carries the signature motion (§1.9): 120 ms from scale 0.9
 * with an overshoot easing, which `motion-reduce:` turns off. Hidden from assistive technology — the row it sits in is
 * the checkbox.
 *
 * Presentational: props → JSX, with no data, no mutation and no effect of its own.
 *
 * @pattern Adapter over a CSS transition — the signature check motion, declared once for every whole-row checkbox
 */
import type { FC } from 'react';

import { Icon } from '../icon/Icon.js';
import type { CheckBoxGlyphProps } from './props.js';

/** The web whole-row checkbox's box. */
export const CheckBoxGlyph: FC<CheckBoxGlyphProps> = ({ checked }) => (
    <span
        aria-hidden="true"
        className={`flex size-6 shrink-0 items-center justify-center rounded-sm border-2 ${
            checked ? 'border-action bg-action text-on-action' : 'border-line-control bg-transparent'
        }`}
    >
        <span
            data-check
            className={`flex transition duration-[120ms] ease-[cubic-bezier(0.34,1.56,0.64,1)] motion-reduce:transition-none ${
                checked ? 'scale-100 opacity-100' : 'scale-90 opacity-0'
            }`}
        >
            <Icon name="check" size={16} />
        </span>
    </span>
);
