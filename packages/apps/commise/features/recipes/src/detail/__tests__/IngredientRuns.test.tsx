/**
 * `IngredientRuns` (web): the rows of the recipe page, marked and toggled by POSITION in the stored lines. Two lines
 * can share a food (two butter lines, crust and filling), so a tick keyed by the food's id would tick both (#155).
 */
import { fireEvent } from '@testing-library/dom';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeIngredientView } from '../../__fixtures__/index.js';
import { IngredientRuns } from '../IngredientRuns.js';

afterEach(cleanup);

const butter = (displayText: string) =>
    makeIngredientView({ ingredientId: 'ing_butter', name: 'butter', displayText, quantity: { kind: 'absent' } });
const LINES = [butter('crust butter'), butter('filling butter')];

const GROUPED = [
    makeIngredientView({ displayText: 'crust flour', groupLabel: 'Crust', quantity: { kind: 'absent' } }),
    makeIngredientView({ displayText: 'crust butter', groupLabel: 'Crust', quantity: { kind: 'absent' } }),
    makeIngredientView({ displayText: 'filling flour', groupLabel: 'Filling', quantity: { kind: 'absent' } }),
];

describe('IngredientRuns (web)', () => {
    it('marks only the line at a ticked position, though two share a food (mutant: checked.has(ingredientId))', () => {
        render(<IngredientRuns ingredients={LINES} checked={new Set([0])} allRemoved={false} onToggle={vi.fn()} />);

        expect(screen.getByRole('checkbox', { name: /crust butter/u }).getAttribute('aria-checked')).toBe('true');
        expect(screen.getByRole('checkbox', { name: /filling butter/u }).getAttribute('aria-checked')).toBe('false');
    });

    it('reports the position of the row that was pressed', () => {
        const onToggle = vi.fn();
        render(<IngredientRuns ingredients={LINES} checked={new Set()} allRemoved={false} onToggle={onToggle} />);

        fireEvent.click(screen.getByRole('checkbox', { name: /filling butter/u }));

        expect(onToggle).toHaveBeenCalledTimes(1);
        expect(onToggle).toHaveBeenCalledWith(1);
    });

    it('marks nothing for a position no line has', () => {
        render(<IngredientRuns ingredients={LINES} checked={new Set([7])} allRemoved={false} onToggle={vi.fn()} />);

        expect(screen.getAllByRole('checkbox').map((box) => box.getAttribute('aria-checked'))).toEqual([
            'false',
            'false',
        ]);
    });

    it('marks a line in the second group by its stored position, not its place in its own group', () => {
        // Position 2 is the FIRST line of the second group: a group-local index would mark position 0 instead.
        render(<IngredientRuns ingredients={GROUPED} checked={new Set([2])} allRemoved={false} onToggle={vi.fn()} />);

        expect(screen.getAllByRole('checkbox').map((box) => box.getAttribute('aria-checked'))).toEqual([
            'false',
            'false',
            'true',
        ]);
    });

    it('reports the stored position of a line pressed in the second group', () => {
        const onToggle = vi.fn();
        render(<IngredientRuns ingredients={GROUPED} checked={new Set()} allRemoved={false} onToggle={onToggle} />);

        fireEvent.click(screen.getByRole('checkbox', { name: /filling flour/u }));

        expect(onToggle).toHaveBeenCalledExactlyOnceWith(2);
    });
});
