/**
 * The owner's "Needs review" control (native). Designer ruling 2026-11-11: the tag is the control, so the pill and its
 * chevron are ONE pressable on ONE line, the chevron directly after the pill and centred on the pill's full height. The
 * pill's label may wrap at the largest text size; the chevron never drops below it.
 *
 * jsdom does no layout, so these tests read the flex contract that produces it: a row that never wraps, every child
 * centred on the cross axis (the design-system badge's own `alignSelf: flex-start` is what dropped the chevron), a pill
 * that may shrink and wrap, and a chevron that may not.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { render } from '@commise/ui/testing/tamagui';

import { recipeMessages } from '../../messages.js';
import { ReviewLineButton } from '../ReviewLineButton.native.js';

afterEach(cleanup);

const { detail } = recipeMessages.en;
const NAME = 'Needs review: flour';

/** The control's one row: the pressable's first element. */
const rowOf = (control: HTMLElement): HTMLElement => {
    const row = control.firstElementChild;

    if (!(row instanceof HTMLElement)) {
        throw new Error('the control draws no row');
    }

    return row;
};

/** How a flex child sits on the row's cross axis: its own `alignSelf`, else the row's `alignItems`. */
const crossAlignment = (row: HTMLElement, child: Element): string => {
    const own = getComputedStyle(child).alignSelf;

    return own === '' || own === 'auto' ? getComputedStyle(row).alignItems : own;
};

describe('ReviewLineButton (native)', () => {
    it('is one control named for the food, holding both the pill and the chevron', () => {
        const onPress = vi.fn();

        render(<ReviewLineButton food="flour" onPress={onPress} />);
        const control = screen.getByRole('button', { name: NAME });

        expect(control.textContent).toContain(detail.needsReviewBadge);
        expect(rowOf(control).children).toHaveLength(2);

        fireEvent.click(control);
        expect(onPress).toHaveBeenCalledTimes(1);
    });

    it('keeps the pill and the chevron on one line, both centred on the row', () => {
        render(<ReviewLineButton food="flour" onPress={() => undefined} />);
        const row = rowOf(screen.getByRole('button', { name: NAME }));

        expect(getComputedStyle(row).flexDirection).toBe('row');
        expect(getComputedStyle(row).flexWrap).not.toBe('wrap');

        for (const child of Array.from(row.children)) {
            expect(crossAlignment(row, child)).toBe('center');
        }
    });

    it('lets the pill wrap at a large text size while the chevron keeps its size beside it', () => {
        render(<ReviewLineButton food="flour" onPress={() => undefined} />);
        const [pill, chevron] = Array.from(rowOf(screen.getByRole('button', { name: NAME })).children);

        expect(getComputedStyle(pill as Element).flexShrink).toBe('1');
        expect(getComputedStyle(chevron as Element).flexShrink).toBe('0');
    });
});
