import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
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
 * is now the scroller's: 40 dp with the chevron while the row rests at its start, 24 dp once it has been scrolled.
 * The `hasMoreAhead` table moved to `horizontalScroller/__tests__/scrollHint.test.ts`.
 */

afterEach(cleanup);

const FADE = '[data-commise-stub="linear-gradient"]';

/** Report a laid-out size to a view, the way react-native-web's ResizeObserver does. */
function layOut(element: Element, width: number): void {
    const handler = (element as Element & { __reactLayoutHandler?: (event: unknown) => void }).__reactLayoutHandler;

    if (handler === undefined) {
        throw new Error('the view has no layout handler');
    }

    act(() => handler({ nativeEvent: { layout: { x: 0, y: 0, width, height: 36 } } }));
}

/** The views of a rendered scrolling row that report their size: the scroller, then the content inside it. */
function measured(container: HTMLElement): readonly Element[] {
    return [...container.querySelectorAll('*')].filter(
        (node) => (node as Element & { __reactLayoutHandler?: unknown }).__reactLayoutHandler !== undefined,
    );
}

function row(overflow: 'scroll' | 'wrap', surface?: 'canvas' | 'overlay') {
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

    it('draws a 40 dp band with the chevron at the start while the chips run past the box', () => {
        const { container } = row('scroll');
        const [scroller, content] = measured(container);

        layOut(scroller as Element, 300);
        layOut(content as Element, 640);

        const fade = container.querySelector<HTMLElement>(FADE);

        expect(fade).not.toBeNull();
        const box = fade?.parentElement as HTMLElement;

        expect(getComputedStyle(box).width).toBe('40px');
        // It decorates, and it must never take a touch meant for the chip under it.
        expect(box.getAttribute('aria-hidden')).toBe('true');
        expect(getComputedStyle(box).pointerEvents).toBe('none');
        expect(container.querySelector('[data-icon-name="chevron-right"]')).not.toBeNull();
    });

    it('narrows to the 24 dp fade, without the chevron, once the row has been scrolled', () => {
        const { container } = row('scroll');
        const [scroller, content] = measured(container);

        layOut(scroller as Element, 300);
        layOut(content as Element, 640);
        (scroller as HTMLElement).scrollLeft = 120;
        fireEvent.scroll(scroller as Element);

        const box = container.querySelector<HTMLElement>(FADE)?.parentElement as HTMLElement;

        expect(getComputedStyle(box).width).toBe('24px');
        expect(
            container.querySelector('[data-icon-name="chevron-right"]')?.closest<HTMLElement>('[style*="opacity"]')
                ?.style.opacity,
        ).toBe('0');
    });

    it('fades into the canvas by default, and into the sheet’s surface when the row sits on one', () => {
        const fadeColours = (surface?: 'canvas' | 'overlay'): string | undefined => {
            const { container, unmount } = row('scroll', surface);
            const [scroller, content] = measured(container);

            layOut(scroller as Element, 300);
            layOut(content as Element, 640);

            const colours = container.querySelector<HTMLElement>(FADE)?.dataset['colors'];
            unmount();

            return colours;
        };

        // The fade ends in the colour behind the row; a mismatch is a visible stripe across the surface.
        expect(fadeColours()?.endsWith(`|${role.canvas}`)).toBe(true);
        expect(fadeColours('overlay')?.endsWith(`|${role.paperOverlay}`)).toBe(true);
    });

    it('draws none when every chip fits', () => {
        const { container } = row('scroll');
        const [scroller, content] = measured(container);

        layOut(scroller as Element, 400);
        layOut(content as Element, 240);

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
