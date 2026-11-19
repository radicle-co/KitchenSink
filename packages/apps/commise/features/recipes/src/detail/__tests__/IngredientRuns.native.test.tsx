/**
 * `IngredientRuns` (native): the mirror of `IngredientRuns.test.tsx`. Rows are marked and toggled by POSITION in the
 * stored lines, because two lines can share a food and a tick keyed by the food's id would tick both (#155).
 */
import { cleanup, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithTamagui } from '@commise/ui/testing/tamagui';

import { makeIngredientView } from '../../__fixtures__/index.js';
// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native` leaf.
import { IngredientRuns } from '../IngredientRuns.native.js';

afterEach(cleanup);

const butter = (displayText: string) =>
    makeIngredientView({ ingredientId: 'ing_butter', name: 'butter', displayText, quantity: { kind: 'absent' } });
const LINES = [butter('crust butter'), butter('filling butter')];

describe('IngredientRuns (native)', () => {
    it('marks only the line at a ticked position, even when two lines share a food (mutant: checked.has(ingredientId))', () => {
        renderWithTamagui(
            <IngredientRuns ingredients={LINES} checked={new Set([0])} allRemoved={false} onToggle={vi.fn()} />,
            'light',
            1,
        );

        expect(screen.getByRole('checkbox', { name: /crust butter/u }).getAttribute('aria-checked')).toBe('true');
        expect(screen.getByRole('checkbox', { name: /filling butter/u }).getAttribute('aria-checked')).toBe('false');
    });

    it('reports the position of the row that was pressed', () => {
        const onToggle = vi.fn();
        renderWithTamagui(
            <IngredientRuns ingredients={LINES} checked={new Set()} allRemoved={false} onToggle={onToggle} />,
            'light',
            1,
        );

        fireEvent.click(screen.getByRole('checkbox', { name: /filling butter/u }));

        expect(onToggle).toHaveBeenCalledTimes(1);
        expect(onToggle).toHaveBeenCalledWith(1);
    });
});
