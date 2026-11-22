import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RadioList } from '../RadioList.native.js';
import type { RadioListOption, RadioListProps } from '../props.js';
import { dimmedOpacity } from '../../tokens/scale.js';
import { touchFloor } from '../../layout/touchFloor.native.js';
import { withPlatformOs } from '../../testing/platformOs.native.js';
import { render, renderWithTamagui, resolvedStyle } from '../../testing/tamaguiTesting.native.js';

/**
 * RadioList (native) — a `radiogroup` of whole-row `radio`s with `aria-checked`, rendered through react-native-web:
 * controlled, able to hold NO choice, every row at the native touch floor.
 */

afterEach(cleanup);

const OPTIONS: readonly RadioListOption[] = [
    { id: 'whole', label: 'Whole milk' },
    { id: 'twoPercent', label: 'Milk, 2% fat' },
    { id: 'asWritten', label: 'Keep “2 cups milk” as written', hint: 'No nutrition for this line' },
];

function renderList(overrides: Partial<RadioListProps> = {}) {
    const onChange = vi.fn();
    render(
        <RadioList
            label="Food for 2 cups milk"
            options={OPTIONS}
            value={undefined}
            onChange={onChange}
            {...overrides}
        />,
    );

    return { onChange, group: screen.getByRole('radiogroup', { name: 'Food for 2 cups milk' }) };
}

// REWRITTEN (U13, 2026-10-25): the `look` prop and its unused `rows` look are gone; every case draws the one card list.
describe('RadioList (native)', () => {
    it('is a radiogroup named by its label, one radio per option in the given order', () => {
        const { group } = renderList();

        const radios = within(group).getAllByRole('radio');

        expect(radios.map((radio) => radio.getAttribute('aria-checked'))).toEqual(['false', 'false', 'false']);
        expect(radios[0]?.textContent).toContain('Whole milk');
        expect(radios[2]?.textContent).toContain('No nutrition for this line');
    });

    it('disabled: every radio reports it, and a press changes nothing', () => {
        const { onChange, group } = renderList({ disabled: true });

        const radios = within(group).getAllByRole('radio');

        expect(radios.every((radio) => radio.getAttribute('aria-disabled') === 'true')).toBe(true);
        fireEvent.click(radios[0] as HTMLElement);
        expect(onChange).not.toHaveBeenCalled();
    });

    // The designer's approval fixes: a list that cannot be used LOOKS it, at the one dim every unavailable native control takes.
    it('disabled: every row dims to the design system’s one disabled opacity, and an enabled list does not', () => {
        const { group } = renderList({ disabled: true });

        expect(
            within(group)
                .getAllByRole('radio')
                .map((radio) => getComputedStyle(radio).opacity),
        ).toEqual([String(dimmedOpacity), String(dimmedOpacity), String(dimmedOpacity)]);

        cleanup();
        const enabled = renderList();

        expect(
            within(enabled.group)
                .getAllByRole('radio')
                .some((radio) => getComputedStyle(radio).opacity === String(dimmedOpacity)),
        ).toBe(false);
    });

    it('is not disabled by default', () => {
        const { group } = renderList();

        expect(
            within(group)
                .getAllByRole('radio')
                .some((radio) => radio.getAttribute('aria-disabled') === 'true'),
        ).toBe(false);
    });

    it('⛔ checks nothing with no value', () => {
        const { group } = renderList();

        expect(within(group).queryByRole('radio', { checked: true })).toBeNull();
    });

    it('checks exactly the row whose id is the value', () => {
        renderList({ value: 'twoPercent' });

        expect(screen.getByRole('radio', { checked: true }).textContent).toContain('Milk, 2% fat');
        expect(screen.getAllByRole('radio', { checked: false })).toHaveLength(2);
    });

    it('reports a press with the row’s id and does not check the row itself (controlled)', () => {
        const { onChange } = renderList();

        fireEvent.click(screen.getAllByRole('radio')[1] as HTMLElement);

        expect(onChange).toHaveBeenCalledWith('twoPercent');
        expect(screen.queryByRole('radio', { checked: true })).toBeNull();
    });

    it.each(['ios', 'android'] as const)('every row stands at least the touch floor tall on %s', (os) => {
        withPlatformOs(os, () => {
            const { group } = renderList();

            for (const radio of within(group).getAllByRole('radio')) {
                expect(getComputedStyle(radio).minHeight).toBe(`${String(touchFloor())}px`);
            }
        });
    });
});

/**
 * U2 (plan largeTextSheet, #398): the answer rows draw on the design-system `Text`, so the label (cardTitle 16 / 20) and
 * the hint (meta 14 / 20) honour the 2x cap, and the radio circle sits on the label's first line at every scale. These
 * cases fail at 6b88df26a, where the rows draw on React Native's `Text` at the raw token size.
 */
describe('RadioList (native) at a system text scale', () => {
    const OPTION: readonly RadioListOption[] = [{ id: 'a', label: 'Written by me', hint: 'I wrote it myself' }];

    const renderAt = (textScale: number) =>
        renderWithTamagui(
            <RadioList label="Where is this recipe from?" options={OPTION} value={undefined} onChange={vi.fn()} />,
            'light',
            textScale,
        );

    const styleOf = (text: string) => getComputedStyle(screen.getByText(text));

    it('past the cap (3.571) the label draws at 32 and the hint at 28, not at the platform’s uncapped size', () => {
        renderAt(3.571);

        expect(styleOf('Written by me').fontSize).toBe('32px');
        expect(styleOf('I wrote it myself').fontSize).toBe('28px');
    });

    it('inside the cap (1.786) the label and hint draw at their role size times the scale, with no clamp', () => {
        renderAt(1.786);

        expect(Number.parseFloat(styleOf('Written by me').fontSize)).toBeCloseTo(16 * 1.786, 2);
        expect(Number.parseFloat(styleOf('I wrote it myself').fontSize)).toBeCloseTo(14 * 1.786, 2);
    });

    /** The 18 dp radio circle of the one row, and the slot one line of the label tall that holds it. */
    function markOfTheRow(): { readonly circle: HTMLElement; readonly slot: HTMLElement } {
        const circle = screen.getByRole('radio').querySelector('[aria-hidden="true"]');

        if (!(circle instanceof HTMLElement) || circle.parentElement === null) {
            throw new Error('radio circle not found');
        }

        return { circle, slot: circle.parentElement };
    }

    it.each([
        [1, 20],
        [2, 40],
        [3.571, 40],
    ] as const)(
        'at scale %s the circle sits centred in a slot one label line (%s dp) tall, so it centres on the first line',
        (textScale, line) => {
            withPlatformOs('android', () => {
                renderAt(textScale);

                const { circle, slot } = markOfTheRow();

                // The leading is capped at 2x, so past the cap the slot stays as tall as at 2x.
                expect(Number.parseFloat(styleOf('Written by me').lineHeight)).toBe(line);
                expect(getComputedStyle(slot).height).toBe(`${String(line)}px`);
                expect(getComputedStyle(slot).alignItems).toBe('center');
                expect(getComputedStyle(circle).width).toBe('18px');
                expect(getComputedStyle(circle).height).toBe('18px');
            });
        },
    );

    it('a row with no hint keeps the circle on the label: both sit in one top-aligned group the row centres', () => {
        // The Pressable centres its content. A lone label line is then centred in the 44 dp row, so a mark that
        // is only offset from the row top would sit off it. Mark and words share one flex-start group instead.
        withPlatformOs('android', () => {
            renderWithTamagui(
                <RadioList
                    label="Where is this recipe from?"
                    options={[{ id: 'a', label: 'Publish privately' }]}
                    value={undefined}
                    onChange={vi.fn()}
                />,
                'light',
                1,
            );

            const radio = screen.getByRole('radio');
            const { slot } = markOfTheRow();
            const group = slot.parentElement;

            if (group === null) {
                throw new Error('radio row group not found');
            }

            expect(radio.children).toHaveLength(1);
            expect(radio.firstElementChild).toBe(group);
            expect(group.contains(screen.getByText('Publish privately'))).toBe(true);
            expect(getComputedStyle(group).alignItems).toBe('flex-start');
            expect(getComputedStyle(radio).alignItems).toBe('center');
        });
    });

    // qse (PR #414): the group and the words take the row's width so a long label wraps instead of running past the card.
    it('the group takes the row width and the words take what the mark leaves, so a long label wraps', () => {
        withPlatformOs('android', () => {
            renderAt(1);

            const group = markOfTheRow().slot.parentElement;
            const words = screen.getByText('Written by me').parentElement;

            if (group === null || words === null) {
                throw new Error('radio row group not found');
            }

            expect(resolvedStyle(group, 'flexGrow')).toBe('1');
            expect(resolvedStyle(words, 'flexGrow')).toBe('1');
        });
    });

    // qse (PR #414): the checked mark is told from the unchecked one by its ring alone (a 5 dp ring against a 2 dp one).
    it('draws a 2 dp ring unchecked and a 5 dp ring checked', () => {
        withPlatformOs('android', () => {
            const list = (value: string | undefined) => (
                <RadioList label="Where" options={[{ id: 'a', label: 'One' }]} value={value} onChange={vi.fn()} />
            );

            renderWithTamagui(list(undefined), 'light', 1);
            expect(getComputedStyle(markOfTheRow().circle).borderTopWidth).toBe('2px');
            cleanup();

            renderWithTamagui(list('a'), 'light', 1);
            expect(getComputedStyle(markOfTheRow().circle).borderTopWidth).toBe('5px');
        });
    });

    it('on iOS the slot is as tall as the snapped leading the label draws with', () => {
        withPlatformOs('ios', () => {
            renderAt(2);

            const drawnLeading = Number.parseFloat(styleOf('Written by me').lineHeight);

            expect(Number.parseFloat(getComputedStyle(markOfTheRow().slot).height)).toBeCloseTo(drawnLeading, 5);
        });
    });
});
