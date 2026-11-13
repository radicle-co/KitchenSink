/**
 * @module @commise/ui/check-box-glyph — the web design-system {@link CheckBoxGlyph}.
 *
 * A box with a rounded corner (owner decisions C5/T1: a rounded square, never the 8 px radius that reads as a radio; the
 * touch target is the ROW's, not the glyph's): a 1 px `lineControl` outline (thin: owner decision C6) when unchecked (a
 * 3:1 graphic under SC 1.4.11), the `action` fill with an `onAction` check when checked. The check stays mounted and
 * carries the signature motion (§1.9): 120 ms from scale 0.9 with an overshoot easing, which `motion-reduce:` turns off.
 * Hidden from assistive technology — the row it sits in is the checkbox.
 *
 * The box grows with its row's text: 18 px beside body sizes, 22 beside a 28 px role (`checkBoxSideOf`). Every size is
 * in `rem`, so browser text size moves the box and the text together. It sits centred in a slot one line of its text
 * role tall, so in a row that aligns its items to the top the box stays beside the FIRST line when the text wraps.
 *
 * Presentational: props → JSX, with no data, no mutation and no effect of its own.
 *
 * @pattern Adapter over a CSS transition — the signature check motion, declared once for every whole-row checkbox
 * @pattern Glyph — a mark sized by its row's text role that owns its corner (`GLYPH_CORNER`), which no radius step fits
 */
import type { FC } from 'react';

import { Icon } from '../icon/Icon.js';
import { typeRole } from '../tokens/typography.js';
import {
    CHECK_MARK_SHARE,
    DEFAULT_CHECK_BOX_TEXT_ROLE,
    GLYPH_CORNER_PERCENT,
    checkBoxSideOf,
    type CheckBoxGlyphProps,
} from './props.js';

/** A px length as `rem` against the 16 px root. Pure. */
const rem = (px: number): string => `${String(px / 16)}rem`;

/** The web whole-row checkbox's box. */
export const CheckBoxGlyph: FC<CheckBoxGlyphProps> = ({ checked, textRole = DEFAULT_CHECK_BOX_TEXT_ROLE }) => {
    const side = checkBoxSideOf(textRole);
    const { lineHeight } = typeRole[textRole];

    return (
        <span className="flex shrink-0 items-center" style={{ height: rem(lineHeight) }}>
            <span
                aria-hidden="true"
                style={{
                    width: rem(side),
                    height: rem(side),
                    borderRadius: GLYPH_CORNER_PERCENT,
                }}
                className={`flex shrink-0 items-center justify-center border ${
                    checked ? 'border-action bg-action text-on-action' : 'border-line-control bg-transparent'
                }`}
            >
                <span
                    data-check
                    style={{ width: rem(side * CHECK_MARK_SHARE), height: rem(side * CHECK_MARK_SHARE) }}
                    className={`flex transition duration-[120ms] ease-[cubic-bezier(0.34,1.56,0.64,1)] motion-reduce:transition-none [&>svg]:size-full ${
                        checked ? 'scale-100 opacity-100' : 'scale-90 opacity-0'
                    }`}
                >
                    <Icon name="check" size={16} />
                </span>
            </span>
        </span>
    );
};
