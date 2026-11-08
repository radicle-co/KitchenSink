import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { scrollViewSizes, stubBoundingRects } from '../../testing/boundingRects.js';
import { fireScrollAndSettle, render, resolvedStyle } from '../../testing/tamaguiTesting.native.js';
import { Chip } from '../Chip.native.js';
import { role } from '../../tokens/colors.js';
import { ChipRow } from '../ChipRow.native.js';
import type { ChipRowProps } from '../props.js';

/**
 * ChipRow (native) — the scroll hint of a scrolling row (`docs/design/uiOverhaul/horizontalScrollHint.md`). The row sits
 * in the design-system `HorizontalScroller`, which owns the platform scroll indicator, the gradient into the surface
 * colour and the chevron; its own suite owns their behaviour, and this one pins that the row is wired to it.
 *
 * ⚠️ REWRITTEN. This suite pinned a 24 dp fade built in the row, shown by `hasMoreAhead` and with no chevron. The fade
 * is now the scroller's: a 16 dp ramp at the scroller's own edge, with the chevron in a 24 dp column beside it while the
 * row rests at its start (`horizontalScrollHint.md` §3.6; it was a 40 dp band over the chips, which hid the last chip's
 * characters).
 * The `hasMoreAhead` table moved to `horizontalScroller/__tests__/scrollHint.test.ts`.
 */

let restoreRects: (() => void) | undefined;

afterEach(() => {
    cleanup();
    restoreRects?.();
    restoreRects = undefined;
});

const FADE = '[data-commise-stub="linear-gradient"]';

/** Render the row; `sizes` are the scroller's and the content's widths, stated before the mount that measures them. */
function row(overflow: 'scroll' | 'wrap', surface?: 'canvas' | 'overlay', sizes?: readonly [number, number]) {
    if (sizes !== undefined) {
        restoreRects = stubBoundingRects(scrollViewSizes({ scroller: sizes[0], content: sizes[1] }));
    }

    return render(
        <ChipRow
            mode="filter"
            label="Quick filters"
            overflow={overflow}
            {...(surface === undefined ? {} : ({ surface } satisfies Partial<ChipRowProps>))}
        >
            <Chip kind="filter" label="All" selected onPress={() => undefined} />
            <Chip kind="filter" label="Vegan" selected={false} onPress={() => undefined} />
        </ChipRow>,
    );
}

describe('ChipRow (native) — the scroll hint of a scrolling row', () => {
    it('draws no hint before it knows the row is wider than its box', () => {
        const { container } = row('scroll');

        expect(container.querySelector(FADE)).toBeNull();
    });

    it('draws a 16 dp fade with the chevron beside it at the start while the chips run past the box', () => {
        const { container } = row('scroll', undefined, [300, 640]);

        const fade = container.querySelector<HTMLElement>(FADE);

        expect(fade).not.toBeNull();
        const box = fade?.parentElement as HTMLElement;

        expect(resolvedStyle(box, 'width')).toBe('16px');
        // It decorates, and it must never take a touch meant for the chip under it.
        expect(box.getAttribute('aria-hidden')).toBe('true');
        expect(resolvedStyle(box, 'pointerEvents')).toBe('none');
        expect(container.querySelector('[data-icon-name="chevron-right"]')).not.toBeNull();
    });

    it('keeps the 16 dp fade, without the chevron, once the row has been scrolled', () => {
        const { container } = row('scroll', undefined, [300, 640]);
        const scroller = container.querySelector<HTMLElement>('[style*="overflow-x"]') as HTMLElement;

        scroller.scrollLeft = 120;
        fireScrollAndSettle(scroller);

        const box = container.querySelector<HTMLElement>(FADE)?.parentElement as HTMLElement;

        expect(resolvedStyle(box, 'width')).toBe('16px');
        expect(
            container.querySelector('[data-icon-name="chevron-right"]')?.closest<HTMLElement>('[style*="opacity"]')
                ?.style.opacity,
        ).toBe('0');
    });

    it('fades into the canvas by default, and into the sheet’s surface when the row sits on one', () => {
        const fadeColours = (surface?: 'canvas' | 'overlay'): string | undefined => {
            const { container, unmount } = row('scroll', surface, [300, 640]);

            const colours = container.querySelector<HTMLElement>(FADE)?.dataset['colors'];
            unmount();
            restoreRects?.();

            return colours;
        };

        // The fade ends in the colour behind the row; a mismatch is a visible stripe across the surface.
        expect(fadeColours()?.endsWith(`|${role.canvas}`)).toBe(true);
        expect(fadeColours('overlay')?.endsWith(`|${role.paperOverlay}`)).toBe(true);
    });

    it('draws none when every chip fits', () => {
        const { container } = row('scroll', undefined, [400, 240]);

        expect(container.querySelector(FADE)).toBeNull();
    });

    it('draws none on a wrapped row, which never scrolls', () => {
        const { container } = row('wrap');

        expect(container.querySelector(FADE)).toBeNull();
        expect(container.querySelector('[data-icon-name="chevron-right"]')).toBeNull();
    });
});

/**
 * The boxes from the row's group or radiogroup down to the box that holds the chips, outermost first. Pure over the
 * rendered tree.
 */
function boxesDownToChips(container: HTMLElement, groupRole: 'group' | 'radiogroup', chip: string): HTMLElement[] {
    const group = container.querySelector<HTMLElement>(`[role="${groupRole}"]`);
    const firstChip = container.querySelector(chip);

    if (group === null || firstChip?.parentElement == null) {
        throw new Error('the row rendered no group, or no chip inside it');
    }

    const chain: HTMLElement[] = [];

    for (
        let box: HTMLElement | null = firstChip.parentElement;
        box !== null && box !== group;
        box = box.parentElement
    ) {
        chain.unshift(box);
    }

    return [group, ...chain];
}

/**
 * A wrapped row wraps only when the box that wraps is as wide as the row. In React Native a child of a row-direction
 * box sizes to its content (it does not shrink by default), so a wrapping line nested inside another row line is as
 * wide as all its chips and never wraps. The contract is therefore structural: exactly one box between the group and
 * its chips lays out as a row, and it wraps. jsdom computes no layout, so this asserts the styles that decide it.
 */
describe('ChipRow (native) — a wrapped row is free to wrap', () => {
    it.each([
        ['a choice row', 'radiogroup', '[role="radio"]'] as const,
        ['a group of chips', 'group', '[role="button"], [role="checkbox"]'] as const,
    ])('%s has one row box between its group and its chips, and that box wraps', (_case, groupRole, chip) => {
        const { container } =
            groupRole === 'radiogroup'
                ? render(
                      <ChipRow
                          mode="choice"
                          label="Cuisine"
                          overflow="wrap"
                          value="thai"
                          onChange={() => undefined}
                          options={[
                              { value: 'thai', label: 'Thai' },
                              { value: 'greek', label: 'Greek' },
                          ]}
                      />,
                  )
                : row('wrap');
        const rows = boxesDownToChips(container, groupRole, chip).filter(
            (box) => getComputedStyle(box).flexDirection === 'row',
        );

        const [line] = rows;

        expect(rows).toHaveLength(1);
        expect(line === undefined ? undefined : getComputedStyle(line).flexWrap).toBe('wrap');
    });
});
