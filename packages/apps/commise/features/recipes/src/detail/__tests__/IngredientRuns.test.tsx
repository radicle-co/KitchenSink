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
});
