import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

import { RadioList } from '../RadioList.js';
import type { RadioListOption, RadioListProps } from '../props.js';

/**
 * RadioList (web) — a `radiogroup` of whole-row radios over Radix `RadioGroup`: controlled, able to hold NO choice, the
 * hint as each radio's description, arrow keys moving between rows. (The quiet tag went with the reconciliation: a
 * food's Default tag lives on a food-choice BUTTON, never a radio, and no radio group carries one.)
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
            look="rows"
            {...overrides}
        />,
    );

    return { onChange, group: screen.getByRole('radiogroup', { name: 'Food for 2 cups milk' }) };
}

describe('RadioList (web)', () => {
    it('is a radiogroup named by its label, one radio per option in the given order', () => {
        const { group } = renderList();

        const radios = within(group).getAllByRole('radio');

        expect(radios.map((radio) => radio.getAttribute('aria-checked'))).toEqual(['false', 'false', 'false']);
        expect(radios).toEqual([
            within(group).getByRole('radio', { name: 'Whole milk' }),
            within(group).getByRole('radio', { name: 'Milk, 2% fat' }),
            within(group).getByRole('radio', { name: 'Keep “2 cups milk” as written' }),
        ]);
    });

    it('⛔ checks nothing with no value', () => {
        const { group } = renderList();

        expect(within(group).queryByRole('radio', { checked: true })).toBeNull();
    });

    it('checks exactly the row whose id is the value', () => {
        renderList({ value: 'twoPercent' });

        expect(screen.getByRole('radio', { checked: true })).toBe(screen.getByRole('radio', { name: 'Milk, 2% fat' }));
        expect(screen.getAllByRole('radio', { checked: false })).toHaveLength(2);
    });

    it('describes a row by its hint, and gives a row without one no description', () => {
        renderList();

        expect(
            screen.getByRole('radio', {
                name: 'Keep “2 cups milk” as written',
                description: 'No nutrition for this line',
            }),
        ).toBeTruthy();
        expect(screen.getByRole('radio', { name: 'Milk, 2% fat', description: '' })).toBeTruthy();
    });

    it('reports a click with the row’s id and does not check the row itself (controlled)', async () => {
        const user = userEvent.setup();
        const { onChange } = renderList();

        await user.click(screen.getByRole('radio', { name: 'Milk, 2% fat' }));

        expect(onChange).toHaveBeenCalledWith('twoPercent');
        expect(screen.queryByRole('radio', { checked: true })).toBeNull();
    });

    it('moves between rows with the arrow keys, checking the row it lands on (WAI-ARIA radio group)', async () => {
        const user = userEvent.setup();

        const Host = () => {
            const [value, setValue] = useState<string | undefined>('whole');

            return <RadioList label="Food" options={OPTIONS} value={value} onChange={setValue} look="rows" />;
        };

        render(<Host />);

        await user.tab();
        expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Whole milk' }));

        // Radix checks the row it focuses while the arrow key is down (as `SegmentedControl.test.tsx` drives it).
        await user.keyboard('{ArrowDown>}');
        await waitFor(() =>
            expect(screen.getByRole('radio', { checked: true })).toBe(
                screen.getByRole('radio', { name: 'Milk, 2% fat' }),
            ),
        );
        await user.keyboard('{/ArrowDown}');
        expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Milk, 2% fat' }));
    });

    it.each(['rows', 'cards'] as const)('%s: draws every row at the 48 px floor', (look) => {
        const { group } = renderList({ look });

        for (const radio of within(group).getAllByRole('radio')) {
            expect(radio.className).toContain('min-h-12');
        }
    });

    it('cards: each row is its own bordered card; rows: the group is the one border', () => {
        const { group } = renderList({ look: 'cards' });

        expect(
            within(group)
                .getAllByRole('radio')
                .every((radio) => radio.className.includes('border')),
        ).toBe(true);
        cleanup();

        const rows = renderList({ look: 'rows' }).group;

        expect(rows.className).toContain('border');
        expect(
            within(rows)
                .getAllByRole('radio')
                .some((radio) => / border /u.test(` ${radio.className} `)),
        ).toBe(false);
    });

    it('lets a long label wrap instead of scrolling sideways', () => {
        renderList({ options: [{ id: 'long', label: 'Bread, white, commercially prepared, toasted, sliced thin' }] });

        expect(screen.getByText('Bread, white, commercially prepared, toasted, sliced thin').className).toContain(
            'break-words',
        );
    });
});
