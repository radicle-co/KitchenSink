import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RadioList } from '../RadioList.native.js';
import type { RadioListOption, RadioListProps } from '../props.js';
import { touchFloor } from '../../layout/touchFloor.native.js';
import { withPlatformOs } from '../../testing/platformOs.native.js';

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
